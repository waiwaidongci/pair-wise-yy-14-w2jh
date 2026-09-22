import type {
  Component,
  DefectLevel,
  RepairTask,
  RuleResult,
  State,
  TaskStatus,
  Timber,
} from "./types";

// 业务规则层：所有派工、排队、领退料约束都在这里，纯函数，便于核对。

const LEVEL_RANK: Record<Exclude<DefectLevel, "">, number> = {
  严重: 3,
  中等: 2,
  轻微: 1,
};

export function levelRank(level: DefectLevel): number {
  return level ? LEVEL_RANK[level] : 0;
}

/** 任务是否尚未完工（REWORK 为已替换的旧记录，DONE 为已完工，均不占名额） */
const OPEN_STATUS: TaskStatus[] = ["PENDING", "QUEUED", "ACTIVE"];

export function isOpenTask(task: RepairTask): boolean {
  return OPEN_STATUS.includes(task.status);
}

export const STATUS_LABEL: Record<TaskStatus, string> = {
  PENDING: "待派工",
  QUEUED: "排队中",
  ACTIVE: "已开工",
  DONE: "已完工",
  REWORK: "待重排旧单",
};

export function findComponent(state: State, id: string): Component | undefined {
  return state.components.find((c) => c.id === id);
}

export function findTask(state: State, id: string): RepairTask | undefined {
  return state.tasks.find((t) => t.id === id);
}

export function findTimber(state: State, id: string): Timber | undefined {
  return state.timbers.find((t) => t.id === id);
}

/** 同一建筑同一构件的未完工任务（唯一任务约束） */
export function openTaskFor(state: State, component: Component): RepairTask | undefined {
  return state.tasks.find(
    (t) =>
      isOpenTask(t) &&
      state.components.some(
        (c) =>
          c.id === t.componentId && c.building === component.building && c.code === component.code
      )
  );
}

/**
 * 派工准入：
 * 1. 存在未复核病害 → 只能待派工；
 * 2. 含水率缺失 → 只能待派工。
 * 不满足时返回阻断原因，满足才允许进入派工队列（占用工位）。
 */
export function checkDispatchable(component: Component): RuleResult {
  if (component.defectLevel && component.reviewed !== "reviewed") {
    return { ok: false, error: `病害（${component.defectLevel}）尚未复核，只能待派工` };
  }
  if (component.moisture === null || Number.isNaN(component.moisture)) {
    return { ok: false, error: "含水率缺失，只能待派工" };
  }
  return { ok: true };
}

/** 申报派工前的完整校验（准入 + 唯一未完工任务） */
export function checkDeclare(state: State, component: Component): RuleResult {
  const gate = checkDispatchable(component);
  if (!gate.ok) return gate;
  const occupied = openTaskFor(state, component);
  if (occupied) {
    return {
      ok: false,
      error: `该构件已存在未完工任务 ${occupied.id}（${STATUS_LABEL[occupied.status]}）`,
    };
  }
  return { ok: true };
}

/** 当前被占用的工位（已开工占用 + 队列中已预分配工位的预留） */
export function occupiedWorkstationIds(state: State): Set<string> {
  return new Set(
    state.tasks
      .filter(
        (t) =>
          (t.status === "ACTIVE" || t.status === "QUEUED") && t.workstationId
      )
      .map((t) => t.workstationId!)
  );
}

/**
 * 派工队列排序：病害等级高者优先，同级按申报（入队）时间先到先得。
 */
export function orderedQueue(state: State): RepairTask[] {
  return state.tasks
    .filter((t) => t.status === "QUEUED")
    .slice()
    .sort((a, b) => {
      const byLevel = levelRank(b.severity) - levelRank(a.severity);
      if (byLevel !== 0) return byLevel;
      return (a.queuedAt ?? a.declaredAt) - (b.queuedAt ?? b.declaredAt);
    });
}

/**
 * 工位自动分配：按队列顺序把队首任务落到空闲工位。
 * 入队后测绘数据若重新变为不可派工状态，则跳过并给出原因。
 */
export function planAssignments(
  state: State
): { task: RepairTask; workstationId: string }[] {
  const occupied = occupiedWorkstationIds(state);
  const plans: { task: RepairTask; workstationId: string }[] = [];
  for (const task of orderedQueue(state)) {
    const component = findComponent(state, task.componentId);
    if (!component || !checkDispatchable(component).ok) continue;
    const free = state.workstations.find((w) => !occupied.has(w.id) &&
      !plans.some((p) => p.workstationId === w.id));
    if (!free) break;
    plans.push({ task, workstationId: free.id });
  }
  return plans;
}

export interface IssueLine {
  batchId: string;
  qty: number;
}

/** 批次截面留量（固定值）：累计入库量 × 留量比例 */
export function batchReserve(state: State, timber: Timber): number {
  const inQty = state.ledger
    .filter((l) => l.batchId === timber.id && l.type === "INIT")
    .reduce((sum, l) => sum + l.qty, 0);
  return inQty * timber.reserveRate;
}

/** 单条领料校验：数量为正、不超可用库存、扣料后截面留量达标 */
export function checkIssueLine(
  state: State,
  line: IssueLine,
  extra = 0
): RuleResult<{ timber: Timber }> {
  const timber = findTimber(state, line.batchId);
  if (!timber) return { ok: false, error: "木料批次不存在" };
  if (!(line.qty > 0)) return { ok: false, error: `${timber.spec}：领料数量必须大于 0` };
  const total = line.qty + extra;
  if (total > timber.stock + 1e-9) {
    return {
      ok: false,
      error: `${timber.spec}：领料 ${total.toFixed(3)}m³ 超过可用库存 ${timber.stock.toFixed(3)}m³`,
    };
  }
  // 截面留量：出库后剩余库存不得低于批次固定留量
  const reserve = batchReserve(state, timber);
  if (timber.stock - total < reserve - 1e-9) {
    return {
      ok: false,
      error: `${timber.spec}：领料 ${total.toFixed(3)}m³ 后截面留量不足（须保留 ≥ ${reserve.toFixed(3)}m³）`,
    };
  }
  return { ok: true, data: { timber } };
}

/** 开工校验：任务排队中且已预分配工位 + 全部领料行通过（整单原子校验） */
export function checkStart(
  state: State,
  task: RepairTask,
  lines: IssueLine[]
): RuleResult {
  if (task.status !== "QUEUED") {
    return { ok: false, error: `任务 ${task.id} 当前为「${STATUS_LABEL[task.status]}」，不在队列中` };
  }
  if (!task.workstationId) {
    return { ok: false, error: `任务 ${task.id} 尚未分配工位，请等待自动派工` };
  }
  const workstation = state.workstations.find((w) => w.id === task.workstationId);
  if (!workstation) return { ok: false, error: "工位不存在" };
  const component = findComponent(state, task.componentId);
  if (!component) return { ok: false, error: "构件不存在" };
  const gate = checkDispatchable(component);
  if (!gate.ok) return { ok: false, error: gate.error };
  if (lines.length === 0) return { ok: false, error: "开工至少要领用一批木料" };

  // 同一批次多行合并后再校验
  const merged = new Map<string, number>();
  for (const line of lines) merged.set(line.batchId, (merged.get(line.batchId) ?? 0) + line.qty);
  for (const [batchId, qty] of merged) {
    const result = checkIssueLine(state, { batchId, qty });
    if (!result.ok) return result;
  }
  return { ok: true };
}

/** 已开工任务追料校验（当前库存已反映历史出库，按当前余量校验） */
export function checkAddIssue(
  state: State,
  task: RepairTask,
  line: IssueLine
): RuleResult<{ timber: Timber }> {
  if (task.status !== "ACTIVE") {
    return { ok: false, error: `任务 ${task.id} 未开工，不能追料` };
  }
  return checkIssueLine(state, line);
}

/** 退料校验：只能退本任务在该批次已领未退的数量 */
export function checkReturn(
  task: RepairTask,
  batchId: string,
  qty: number
): RuleResult<{ issued: number; returned: number }> {
  if (task.status !== "ACTIVE") {
    return { ok: false, error: `任务 ${task.id} 未开工，不能退料` };
  }
  const alloc = task.allocs.find((a) => a.batchId === batchId);
  const issued = alloc?.issued ?? 0;
  const returned = alloc?.returned ?? 0;
  const refundable = issued - returned;
  if (!(qty > 0)) return { ok: false, error: "退料数量必须大于 0" };
  if (qty > refundable + 1e-9) {
    return {
      ok: false,
      error: `实退 ${qty.toFixed(3)}m³ 超过可退数量 ${refundable.toFixed(3)}m³`,
    };
  }
  return { ok: true, data: { issued, returned } };
}

/** 重测校验：只有已开工构件才能重测转待重排 */
export function checkRemeasure(task: RepairTask): RuleResult {
  if (task.status !== "ACTIVE") {
    return { ok: false, error: "只有已开工构件重测后才转为待重排" };
  }
  return { ok: true };
}

/** 批次实时库存统计（始终由流水与状态派生，不另存副本） */
export function stockStats(state: State): Record<
  string,
  { inQty: number; issueQty: number; returnQty: number; expected: number; matches: boolean }
> {
  const stats: Record<string, { inQty: number; issueQty: number; returnQty: number; expected: number; matches: boolean }> = {};
  for (const t of state.timbers) {
    stats[t.id] = { inQty: 0, issueQty: 0, returnQty: 0, expected: 0, matches: true };
  }
  for (const entry of state.ledger) {
    const row = stats[entry.batchId];
    if (!row) continue;
    if (entry.type === "INIT") row.inQty += entry.qty;
    if (entry.type === "ISSUE") row.issueQty += entry.qty;
    if (entry.type === "RETURN") row.returnQty += -entry.qty;
  }
  for (const t of state.timbers) {
    const row = stats[t.id];
    row.expected = row.inQty - row.issueQty + row.returnQty;
    row.matches = Math.abs(row.expected - t.stock) < 1e-6;
  }
  return stats;
}

/** 三方一致性诊断：构件清单、派工队列、库存统计 */
export function consistencyReport(state: State): string[] {
  const problems: string[] = [];

  // 1. 队列中不得有不可派工构件占用排队名额（队列允许暂存，但必须给出提示）
  for (const task of state.tasks) {
    const component = findComponent(state, task.componentId);
    if (!component) {
      problems.push(`任务 ${task.id} 引用的构件已不存在`);
      continue;
    }
    if (task.status === "ACTIVE") {
      if (!task.workstationId) problems.push(`任务 ${task.id} 已开工但无工位`);
      if (!checkDispatchable(component).ok) {
        problems.push(`任务 ${task.id} 已开工但构件 ${component.code} 当前不满足派工条件`);
      }
    }
  }

  // 2. 同一建筑同一构件至多一个未完工任务
  const keys = new Set<string>();
  for (const task of state.tasks) {
    if (!isOpenTask(task)) continue;
    const component = findComponent(state, task.componentId);
    if (!component) continue;
    const key = `${component.building}@@${component.code}`;
    if (keys.has(key)) problems.push(`${component.building}/${component.code} 存在多个未完工任务`);
    keys.add(key);
  }

  // 3. 工位互斥
  const seats = new Map<string, string>();
  for (const task of state.tasks) {
    if (task.status !== "ACTIVE" || !task.workstationId) continue;
    const prev = seats.get(task.workstationId);
    if (prev) problems.push(`工位 ${task.workstationId} 被任务 ${prev} 与 ${task.id} 同时占用`);
    seats.set(task.workstationId, task.id);
  }

  // 4. 库存账面与流水一致
  for (const [id, row] of Object.entries(stockStats(state))) {
    if (!row.matches) {
      const timber = findTimber(state, id);
      problems.push(
        `${timber?.spec ?? id} 库存 ${timber?.stock.toFixed(3)} 与流水结余 ${row.expected.toFixed(3)} 不一致`
      );
    }
  }

  // 5. 领退数量不超领
  for (const task of state.tasks) {
    for (const alloc of task.allocs) {
      if (alloc.returned > alloc.issued + 1e-9) {
        problems.push(`任务 ${task.id} 在批次 ${alloc.batchId} 退料超过领料`);
      }
    }
  }
  return problems;
}
