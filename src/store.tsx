import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import { clearState, loadState, saveState, seedState } from "./storage";
import {
  checkAddIssue,
  checkDeclare,
  checkDispatchable,
  checkReturn,
  checkRemeasure,
  checkStart,
  findComponent,
  planAssignments,
} from "./rules";
import type {
  Component,
  DefectLevel,
  MaterialLedger,
  RepairTask,
  RuleResult,
  State,
} from "./types";

// 操作层：UI 只通过这里的动作修改状态；每个动作先过业务规则层，再落存储层。

interface LedgerDelta {
  batchId: string;
  qty: number; // 领为正、退为负
}

interface AllocDelta {
  batchId: string;
  qty: number;
  mode: "issue" | "return";
}

type Action =
  | {
      type: "ADD_COMPONENT";
      component: Component;
      task?: RepairTask;
      ledger: MaterialLedger[];
      idsUsed: number;
    }
  | { type: "UPDATE_COMPONENT"; id: string; patch: Partial<Component> }
  | { type: "DECLARE_TASK"; task: RepairTask; idsUsed: number }
  | {
      type: "RUN_DISPATCH";
      queued: { id: string; queuedAt: number }[];
      assignments: { taskId: string; workstationId: string }[];
      demote: string[];
    }
  | {
      type: "START_TASK";
      taskId: string;
      ledger: MaterialLedger[];
      deltas: LedgerDelta[];
      idsUsed: number;
    }
  | {
      type: "MATERIAL_MOVE";
      taskId: string;
      ledger: MaterialLedger[];
      allocs: RepairTask["allocs"];
      deltas: LedgerDelta[];
      idsUsed: number;
    }
  | { type: "FINISH_TASK"; taskId: string }
  | { type: "REMEASURE"; oldTaskId: string; oldPatch: Partial<RepairTask>; newTask: RepairTask; idsUsed: number }
  | { type: "REFRESH_STOCK"; at: number }
  | { type: "RESET" };

function mergeAllocs(base: RepairTask["allocs"], delta: AllocDelta[]) {
  const map = new Map(base.map((a) => [a.batchId, { ...a }]));
  for (const d of delta) {
    const cur = map.get(d.batchId) ?? { batchId: d.batchId, issued: 0, returned: 0 };
    if (d.mode === "issue") cur.issued += d.qty;
    else cur.returned += d.qty;
    map.set(d.batchId, cur);
  }
  return [...map.values()];
}

function applyStock(timbers: State["timbers"], deltas: LedgerDelta[]) {
  const byBatch = new Map<string, number>();
  for (const d of deltas) byBatch.set(d.batchId, (byBatch.get(d.batchId) ?? 0) + d.qty);
  return timbers.map((timber) => {
    const out = byBatch.get(timber.id);
    return out ? { ...timber, stock: timber.stock - out } : timber;
  });
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "ADD_COMPONENT":
      return {
        ...state,
        components: [...state.components, action.component],
        tasks: action.task ? [...state.tasks, action.task] : state.tasks,
        ledger: action.ledger.length ? [...state.ledger, ...action.ledger] : state.ledger,
        seq: state.seq + action.idsUsed,
      };

    case "UPDATE_COMPONENT":
      return {
        ...state,
        components: state.components.map((c) =>
          c.id === action.id ? { ...c, ...action.patch } : c
        ),
      };

    case "DECLARE_TASK":
      return { ...state, tasks: [...state.tasks, action.task], seq: state.seq + action.idsUsed };

    case "RUN_DISPATCH":
      return {
        ...state,
        tasks: state.tasks.map((t) => {
          if (action.demote.includes(t.id)) {
            return { ...t, status: "PENDING", queuedAt: undefined, workstationId: undefined };
          }
          const queued = action.queued.find((q) => q.id === t.id);
          const plan = action.assignments.find((a) => a.taskId === t.id);
          if (!queued && !plan) return t;
          return {
            ...t,
            status: queued ? "QUEUED" : t.status,
            queuedAt: queued ? queued.queuedAt : t.queuedAt,
            workstationId: plan ? plan.workstationId : t.workstationId,
          };
        }),
      };

    case "START_TASK": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task) return state;
      const allocs = mergeAllocs(
        task.allocs,
        action.deltas.map((d) => ({ batchId: d.batchId, qty: d.qty, mode: "issue" as const }))
      );
      return {
        ...state,
        seq: state.seq + action.idsUsed,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId
            ? { ...t, status: "ACTIVE", startedAt: Date.now(), allocs }
            : t
        ),
        ledger: [...state.ledger, ...action.ledger],
        timbers: applyStock(state.timbers, action.deltas),
      };
    }

    case "MATERIAL_MOVE":
      return {
        ...state,
        seq: state.seq + action.idsUsed,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, allocs: action.allocs } : t
        ),
        ledger: [...state.ledger, ...action.ledger],
        timbers: applyStock(state.timbers, action.deltas),
      };

    case "FINISH_TASK":
      return {
        ...state,
        tasks: state.tasks.map((t) =>
          t.id === action.taskId ? { ...t, status: "DONE", finishedAt: Date.now() } : t
        ),
      };

    case "REMEASURE":
      return {
        ...state,
        seq: state.seq + action.idsUsed,
        tasks: [
          ...state.tasks.map((t) =>
            t.id === action.oldTaskId ? { ...t, ...action.oldPatch } : t
          ),
          action.newTask,
        ],
      };

    case "REFRESH_STOCK":
      return { ...state, stockRefreshedAt: action.at };

    case "RESET":
      return seedState();

    default:
      return state;
  }
}

export interface ComponentDraft {
  building: string;
  code: string;
  species: string;
  joint: string;
  sectionText: string;
  sectionCm: number | null;
  defectLoc: string;
  deformation: string;
  suggestion: string;
  moisture: number | null;
  defectLevel: DefectLevel;
  reviewed: Component["reviewed"];
}

interface StartLine {
  batchId: string;
  qty: number;
}

interface StoreApi {
  state: State;
  addComponent: (draft: ComponentDraft, declare: boolean) => RuleResult<{ id: string }>;
  updateComponent: (id: string, patch: Partial<Component>) => void;
  declareTask: (componentId: string) => RuleResult<{ id: string }>;
  runDispatch: () => { queued: number; assigned: number };
  startTask: (taskId: string, lines: StartLine[]) => RuleResult;
  addIssue: (taskId: string, batchId: string, qty: number) => RuleResult;
  returnMaterial: (taskId: string, batchId: string, qty: number) => RuleResult;
  finishTask: (taskId: string) => RuleResult;
  remeasure: (taskId: string, reason: string) => RuleResult<{ id: string }>;
  refreshStock: () => void;
  resetAll: () => void;
}

const StoreContext = createContext<StoreApi | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  useEffect(() => {
    saveState(state);
  }, [state]);

  const api = useMemo<StoreApi>(
    () => ({
      state,

      addComponent(draft, declare) {
        if (!draft.building.trim() || !draft.code.trim()) {
          return { ok: false, error: "建筑名称和构件编号不能为空" };
        }
        if (
          state.components.some(
            (c) => c.building === draft.building.trim() && c.code === draft.code.trim()
          )
        ) {
          return { ok: false, error: "同一建筑下构件编号已存在" };
        }
        const ts = Date.now();
        let seq = state.seq;
        const componentId = `C${++seq}`;
        const component: Component = {
          id: componentId,
          building: draft.building.trim(),
          code: draft.code.trim(),
          species: draft.species || "未填",
          joint: draft.joint || "未填",
          sectionCm: draft.sectionCm ?? 0,
          sectionText: draft.sectionText || "未记录",
          defectLoc: draft.defectLoc,
          deformation: draft.deformation,
          suggestion: draft.suggestion,
          moisture: draft.moisture,
          defectLevel: draft.defectLevel,
          reviewed: draft.reviewed,
          createdAt: ts,
        };
        let task: RepairTask | undefined;
        if (declare) {
          // 新建即申报：准入规则同样生效，不满足时仍只建构件不申报
          const gate = checkDeclare({ ...state, components: [...state.components, component] }, component);
          if (gate.ok) {
            task = {
              id: `T${++seq}`,
              componentId,
              status: "PENDING",
              severity: component.defectLevel,
              declaredAt: ts,
              allocs: [],
            };
          }
        }
        dispatch({
          type: "ADD_COMPONENT",
          component,
          task,
          ledger: [],
          idsUsed: seq - state.seq,
        });
        return { ok: true, data: { id: componentId } };
      },

      updateComponent(id, patch) {
        dispatch({ type: "UPDATE_COMPONENT", id, patch });
      },

      declareTask(componentId) {
        const component = findComponent(state, componentId);
        if (!component) return { ok: false, error: "构件不存在" };
        const check = checkDeclare(state, component);
        if (!check.ok) return check;
        const id = `T${state.seq + 1}`;
        const task: RepairTask = {
          id,
          componentId,
          status: "PENDING", // 未复核病害 / 缺含水率的构件只能停在待派工，不占工位
          severity: component.defectLevel,
          declaredAt: Date.now(),
          allocs: [],
        };
        dispatch({ type: "DECLARE_TASK", task, idsUsed: 1 });
        return { ok: true, data: { id } };
      },

      runDispatch() {
        const ts = Date.now();
        // 0) 队列中若测绘数据变为不合格（如撤回复核、补测前），退回待派工并释放工位
        const demote = state.tasks
          .filter((t) => t.status === "QUEUED")
          .filter((t) => {
            const component = findComponent(state, t.componentId);
            return !component || !checkDispatchable(component).ok;
          })
          .map((t) => t.id);
        // 1) 可派工的待派工任务入队（仍不满足条件的继续等待，绝不占工位）
        const queued = state.tasks
          .filter((t) => t.status === "PENDING")
          .filter((t) => {
            const component = findComponent(state, t.componentId);
            return component ? checkDispatchable(component).ok : false;
          })
          .map((t) => ({ id: t.id, queuedAt: ts }));

        // 2) 在"入队后"的状态上按病害等级、申报时间统一排队分配工位
        const staged: State = {
          ...state,
          tasks: state.tasks.map((t) => {
            if (demote.includes(t.id)) {
              return { ...t, status: "PENDING", queuedAt: undefined, workstationId: undefined };
            }
            if (queued.some((q) => q.id === t.id)) {
              return { ...t, status: "QUEUED", queuedAt: ts };
            }
            return t;
          }),
        };
        const assignments = planAssignments(staged).map((p) => ({
          taskId: p.task.id,
          workstationId: p.workstationId,
        }));
        dispatch({ type: "RUN_DISPATCH", queued, assignments, demote });
        return { queued: queued.length, assigned: assignments.length };
      },

      startTask(taskId, rawLines) {
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return { ok: false, error: "任务不存在" };
        const lines: StartLine[] = rawLines
          .map((l) => ({ batchId: l.batchId, qty: Number(l.qty) }))
          .filter((l) => Number.isFinite(l.qty) && l.qty > 0);
        const check = checkStart(state, task, lines);
        if (!check.ok) return check;

        const ts = Date.now();
        let seq = state.seq;
        const ledger: MaterialLedger[] = lines.map((l) => ({
          id: `L${++seq}`,
          type: "ISSUE",
          batchId: l.batchId,
          taskId,
          qty: l.qty,
          time: ts,
          note: `${taskId} 领料开工`,
        }));
        const deltas: LedgerDelta[] = lines.map((l) => ({ batchId: l.batchId, qty: l.qty }));
        dispatch({ type: "START_TASK", taskId, ledger, deltas, idsUsed: seq - state.seq });
        return { ok: true };
      },

      addIssue(taskId, batchId, qty) {
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return { ok: false, error: "任务不存在" };
        const check = checkAddIssue(state, task, { batchId, qty });
        if (!check.ok) return check;
        const allocs = mergeAllocs(task.allocs, [{ batchId, qty, mode: "issue" }]);
        const id = `L${state.seq + 1}`;
        const ledger: MaterialLedger[] = [
          { id, type: "ISSUE", batchId, taskId, qty, time: Date.now(), note: `${taskId} 追料` },
        ];
        dispatch({
          type: "MATERIAL_MOVE",
          taskId,
          ledger,
          allocs,
          deltas: [{ batchId, qty }],
          idsUsed: 1,
        });
        return { ok: true };
      },

      returnMaterial(taskId, batchId, qty) {
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return { ok: false, error: "任务不存在" };
        const check = checkReturn(task, batchId, qty);
        if (!check.ok) return check;
        const allocs = mergeAllocs(task.allocs, [{ batchId, qty, mode: "return" }]);
        const id = `L${state.seq + 1}`;
        const ledger: MaterialLedger[] = [
          {
            id,
            type: "RETURN",
            batchId,
            taskId,
            qty: -qty,
            time: Date.now(),
            note: `${taskId} 实退回补 ${qty.toFixed(3)}m³`,
          },
        ];
        dispatch({
          type: "MATERIAL_MOVE",
          taskId,
          ledger,
          allocs,
          deltas: [{ batchId, qty: -qty }],
          idsUsed: 1,
        });
        return { ok: true };
      },

      finishTask(taskId) {
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return { ok: false, error: "任务不存在" };
        if (task.status !== "ACTIVE") return { ok: false, error: "只有已开工任务可以完工" };
        dispatch({ type: "FINISH_TASK", taskId });
        return { ok: true };
      },

      remeasure(taskId, reason) {
        const task = state.tasks.find((t) => t.id === taskId);
        if (!task) return { ok: false, error: "任务不存在" };
        const check = checkRemeasure(task);
        if (!check.ok) return check;

        const newId = `T${state.seq + 1}`;
        const component = findComponent(state, task.componentId);
        // 旧记录保留：转待重排、释放工位，并与新任务互链
        const oldPatch: Partial<RepairTask> = {
          status: "REWORK",
          workstationId: undefined,
          remeasureReason: reason || "重测后截面尺寸变化",
          remeasuredAt: Date.now(),
          replacedBy: newId,
        };
        const newTask: RepairTask = {
          id: newId,
          componentId: task.componentId,
          status: "PENDING", // 重测后重新待派工（待重排）
          severity: component?.defectLevel ?? task.severity,
          declaredAt: Date.now(),
          allocs: [],
          reworkOf: task.id,
        };
        dispatch({ type: "REMEASURE", oldTaskId: taskId, oldPatch, newTask, idsUsed: 1 });
        return { ok: true, data: { id: newId } };
      },

      refreshStock() {
        dispatch({ type: "REFRESH_STOCK", at: Date.now() });
      },

      resetAll() {
        clearState();
        dispatch({ type: "RESET" });
      },
    }),
    [state]
  );

  return <StoreContext.Provider value={api}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreApi {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error("useStore 必须在 StoreProvider 内使用");
  return ctx;
}
