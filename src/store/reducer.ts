// ===== 存储层：纯 reducer（不含 React，可独立测试）=====
// 所有状态变更只在此发生；能否变更一律调用 domain/rules 判定。
import type {
  Component,
  DispatchTask,
  LedgerEntry,
  NewComponentInput,
  ResurveyPatch,
  State,
} from "../domain/types";
import {
  blockReason,
  checkCanStart,
  findOpenTask,
  freeWorkstations,
  returnableQty,
  sortQueue,
} from "../domain/rules";
import { seedState } from "../data/seed";

export type Action =
  | { type: "ADD_COMPONENT"; input: NewComponentInput }
  | { type: "REVIEW_DEFECT"; componentId: string; defectId: string }
  | { type: "SET_MOISTURE"; componentId: string; moisture: number }
  | { type: "DECLARE"; componentId: string }
  | {
      type: "START";
      taskId: string;
      stockItemId: string;
      qty: number;
    }
  | { type: "RETURN"; taskId: string; stockItemId: string; qty: number }
  | { type: "COMPLETE"; taskId: string }
  | { type: "RESURVEY"; componentId: string; patch: ResurveyPatch }
  | { type: "REQUEUE"; taskId: string }
  | { type: "SYNC_STOCK" }
  | { type: "RESET" };

const now = (): number => Date.now();

const push = (task: DispatchTask, ev: DispatchTask["history"][number]): void => {
  task.history.push(ev);
};

function patchTask(state: State, taskId: string, fn: (t: DispatchTask) => void): void {
  const t = state.tasks.find((x) => x.id === taskId);
  if (t) fn(t);
}

/** 阻塞解除后：待派工自动晋升排队 */
function promotePending(state: State, componentId: string): void {
  const comp = state.components.find((c) => c.id === componentId);
  if (!comp || blockReason(comp)) return;
  const task = state.tasks.find((t) => t.componentId === componentId && t.status === "pending");
  if (!task) return;
  task.status = "queued";
  push(task, { time: now(), type: "queue", text: "复核/含水率补齐，解除阻塞，进入排队队列" });
}

export function reducer(prev: State, action: Action): State {
  const state: State = {
    ...prev,
    components: prev.components.map((c) => ({ ...c, defects: c.defects.map((d) => ({ ...d })) })),
    tasks: prev.tasks.map((t) => ({ ...t, history: [...t.history] })),
    stock: prev.stock.map((s) => ({ ...s, section: { ...s.section } })),
    ledger: prev.ledger.map((e) => ({ ...e })),
    workstations: prev.workstations,
  };
  const nextId = (prefix: string): string => {
    state.seq += 1;
    return `${prefix}-${state.seq}`;
  };

  switch (action.type) {
    case "ADD_COMPONENT": {
      const dup = state.components.some(
        (c) => c.building === action.input.building && c.code === action.input.code,
      );
      if (dup) return prev;
      const comp: Component = {
        id: nextId("c"),
        code: action.input.code,
        building: action.input.building,
        woodSpecies: action.input.woodSpecies,
        joineryType: action.input.joineryType,
        section: { ...action.input.section },
        moisture: action.input.moisture,
        defects: action.input.defect
          ? [{ id: nextId("d"), ...action.input.defect, reviewed: false }]
          : [],
        suggestion: action.input.suggestion,
        revision: 1,
        updatedAt: now(),
      };
      state.components.push(comp);
      return state;
    }

    case "REVIEW_DEFECT": {
      const comp = state.components.find((c) => c.id === action.componentId);
      const defect = comp?.defects.find((d) => d.id === action.defectId);
      if (!comp || !defect || defect.reviewed) return prev;
      defect.reviewed = true;
      comp.updatedAt = now();
      promotePending(state, comp.id);
      return state;
    }

    case "SET_MOISTURE": {
      const comp = state.components.find((c) => c.id === action.componentId);
      if (!comp || !(action.moisture > 0)) return prev;
      comp.moisture = action.moisture;
      comp.updatedAt = now();
      promotePending(state, comp.id);
      return state;
    }

    case "DECLARE": {
      const comp = state.components.find((c) => c.id === action.componentId);
      if (!comp) return prev;
      if (findOpenTask(state.tasks, comp.building, comp.id)) return prev;
      const blocked = blockReason(comp);
      const t: DispatchTask = {
        id: nextId("t"),
        building: comp.building,
        componentId: comp.id,
        revision: comp.revision,
        status: blocked ? "pending" : "queued",
        declaredAt: now(),
        startedAt: null,
        workstationId: null,
        rejectReason: null,
        history: [
          {
            time: now(),
            type: "declare",
            text: blocked
              ? `申报派工，因「${blocked}」只能待派工，不得占用工位`
              : "申报派工，进入排队队列",
          },
        ],
      };
      state.tasks.push(t);
      return state;
    }

    case "START": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      const comp = task && state.components.find((c) => c.id === task.componentId);
      const stock = state.stock.find((s) => s.id === action.stockItemId);
      if (!task || !comp || !stock) return prev;

      const check = checkCanStart({
        task,
        component: comp,
        stock,
        qty: action.qty,
        queue: sortQueue(state.tasks, state.components),
        freeStations: freeWorkstations(state.workstations, state.tasks),
        ledger: state.ledger,
      });
      if (!check.ok) {
        // 被拒绝的尝试也保留在任务旧记录中
        patchTask(state, task.id, (t) => {
          t.rejectReason = check.reason;
          push(t, { time: now(), type: "reject", text: `拒绝开工：${check.reason}` });
        });
        return state;
      }

      const station = freeWorkstations(state.workstations, state.tasks)[0];
      const entry: LedgerEntry = {
        id: nextId("l"),
        taskId: task.id,
        stockItemId: stock.id,
        kind: "issue",
        qty: action.qty,
        time: now(),
      };
      state.ledger.push(entry);
      patchTask(state, task.id, (t) => {
        t.status = "active";
        t.startedAt = entry.time;
        t.workstationId = station.id;
        t.rejectReason = null;
        push(t, {
          time: entry.time,
          type: "start",
          text: `领料${stock.species} ${stock.section.width}×${stock.section.height}mm ×${action.qty} 根，占用${station.name}开工`,
        });
      });
      return state;
    }

    case "RETURN": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || !Number.isInteger(action.qty) || action.qty <= 0) return prev;
      const byStock = state.ledger
        .filter((e) => e.taskId === task.id && e.stockItemId === action.stockItemId)
        .reduce((s, e) => s + (e.kind === "issue" ? e.qty : -e.qty), 0);
      if (action.qty > byStock) return prev; // 实退不得超过该料未退数量
      const stock = state.stock.find((s) => s.id === action.stockItemId);
      const entry: LedgerEntry = {
        id: nextId("l"),
        taskId: task.id,
        stockItemId: action.stockItemId,
        kind: "return",
        qty: action.qty,
        time: now(),
      };
      state.ledger.push(entry);
      patchTask(state, task.id, (t) => {
        push(t, {
          time: entry.time,
          type: "return",
          text: `退料${stock?.species ?? ""} ${stock ? stock.section.width + "×" + stock.section.height : ""}mm ×${action.qty} 根，库存按实退数量回补`,
        });
      });
      return state;
    }

    case "COMPLETE": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "active") return prev;
      const ws = state.workstations.find((w) => w.id === task.workstationId)?.name;
      patchTask(state, task.id, (t) => {
        t.status = "done";
        t.workstationId = null;
        push(t, { time: now(), type: "complete", text: `修缮完工，释放${ws ?? "工位"}` });
      });
      return state;
    }

    case "RESURVEY": {
      // 已开工构件重测 -> 待重排、释放工位，旧记录保留
      const comp = state.components.find((c) => c.id === action.componentId);
      if (!comp) return prev;
      comp.moisture = action.patch.moisture;
      comp.section = { ...action.patch.section };
      comp.revision += 1;
      comp.updatedAt = now();
      if (action.patch.newDefect) {
        comp.defects.push({ id: nextId("d"), ...action.patch.newDefect, reviewed: false });
      }
      const task = state.tasks.find(
        (t) => t.componentId === comp.id && (t.status === "active" || t.status === "reschedule"),
      );
      if (task) {
        const ws = state.workstations.find((w) => w.id === task.workstationId)?.name;
        patchTask(state, task.id, (t) => {
          const wasActive = t.status === "active";
          t.status = "reschedule";
          t.workstationId = null;
          t.rejectReason = null;
          push(t, {
            time: now(),
            type: "resurvey",
            text: `构件重测至第 ${comp.revision} 版${wasActive ? `，停工释放${ws ?? "工位"}` : ""}，转为待重排，已领木料需退料后重排（旧记录保留）`,
          });
        });
      }
      return state;
    }

    case "REQUEUE": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      const comp = task && state.components.find((c) => c.id === task.componentId);
      if (!task || !comp || task.status !== "reschedule") return prev;
      const open = returnableQty(state.ledger, task.id);
      if (open > 0) return prev; // 旧料未退清，不得重排
      const blocked = blockReason(comp);
      patchTask(state, task.id, (t) => {
        t.status = blocked ? "pending" : "queued";
        t.revision = comp.revision;
        t.startedAt = null;
        t.declaredAt = now(); // 重新申报，按新时间参与排队
        push(t, {
          time: now(),
          type: "requeue",
          text: blocked
            ? `退料已回补，但「${blocked}」，保持待派工`
            : `按第 ${comp.revision} 版测绘数据重新排队`,
        });
      });
      return state;
    }

    case "SYNC_STOCK": {
      state.lastStockSync = now();
      return state;
    }

    case "RESET":
      return { ...seedState };

    default:
      return prev;
  }
}
