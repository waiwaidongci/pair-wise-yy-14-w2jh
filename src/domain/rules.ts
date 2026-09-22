// ===== 业务规则层：纯函数，不依赖 React / 存储 =====
// 所有派工与领退的判定规则集中在此，UI 与存储均不得绕过。

import type {
  Component,
  DispatchTask,
  DefectLevel,
  LedgerEntry,
  Section,
  StockItem,
  TaskStatus,
  Workstation,
} from "./types";

/** 每边加工留量（mm），单方向需求增量为 2 倍 */
export const SECTION_MARGIN_PER_SIDE = 10;

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: "待派工",
  queued: "排队中",
  active: "已开工",
  reschedule: "待重排",
  done: "已完工",
};

export const LEVEL_LABEL: Record<DefectLevel, string> = {
  severe: "严重",
  medium: "中等",
  light: "轻微",
};

/** 病害等级权重：严重 > 中等 > 轻微 */
export const LEVEL_WEIGHT: Record<DefectLevel, number> = {
  severe: 3,
  medium: 2,
  light: 1,
};

export const sectionText = (s: Section): string => `${s.width} × ${s.height} mm`;

/**
 * 构件最高病害等级（排队依据）：
 * 优先取未复核病害；无未复核时取全部病害的最高等级；无病害返回 null。
 * 注意：是否阻塞（未复核/含水率缺失）与排队等级是两个独立维度。
 */
export function topDefectLevel(c: Component): DefectLevel | null {
  if (c.defects.length === 0) return null;
  return c.defects.reduce<DefectLevel>(
    (top, d) => (LEVEL_WEIGHT[d.level] > LEVEL_WEIGHT[top] ? d.level : top),
    "light",
  );
}

/** 规则1：存在未复核病害或含水率缺失 -> 阻塞，只能待派工，不得占用工位 */
export function blockReason(c: Component): string | null {
  const unreviewed = c.defects.filter((d) => !d.reviewed);
  if (unreviewed.length > 0) return `存在 ${unreviewed.length} 处未复核病害`;
  if (c.moisture === null) return "含水率缺失";
  return null;
}

export const isBlocked = (c: Component): boolean => blockReason(c) !== null;

/** 规则2：同一建筑同一构件仅保留一个未完工任务 */
export function findOpenTask(
  tasks: DispatchTask[],
  building: string,
  componentId: string,
): DispatchTask | null {
  return (
    tasks.find(
      (t) =>
        t.building === building &&
        t.componentId === componentId &&
        t.status !== "done",
    ) ?? null
  );
}

/** 规则3：工位冲突按病害等级（高→低）、申报时间（早→晚）排队 */
export function sortQueue(tasks: DispatchTask[], comps: Component[]): DispatchTask[] {
  const compOf = (t: DispatchTask) => comps.find((c) => c.id === t.componentId);
  return tasks
    .filter((t) => t.status === "queued")
    .slice()
    .sort((a, b) => {
      const ca = compOf(a);
      const cb = compOf(b);
      const la = ca ? LEVEL_WEIGHT[topDefectLevel(ca) ?? "light"] : 0;
      const lb = cb ? LEVEL_WEIGHT[topDefectLevel(cb) ?? "light"] : 0;
      if (lb !== la) return lb - la;
      if (a.declaredAt !== b.declaredAt) return a.declaredAt - b.declaredAt;
      return a.id.localeCompare(b.id);
    });
}

export function freeWorkstations(
  workstations: Workstation[],
  tasks: DispatchTask[],
): Workstation[] {
  const used = new Set(
    tasks.filter((t) => t.status === "active").map((t) => t.workstationId),
  );
  return workstations.filter((w) => !used.has(w.id));
}

/** 领退台账中某木料的净占用（领料未退部分） */
export function occupiedByStock(ledger: LedgerEntry[], stockId: string): number {
  return ledger
    .filter((e) => e.stockItemId === stockId)
    .reduce((sum, e) => sum + (e.kind === "issue" ? e.qty : -e.qty), 0);
}

/** 刷新后的库存统计：台账存量 - 净占用 = 可用 */
export function availableQty(item: StockItem, ledger: LedgerEntry[]): number {
  return item.qty - occupiedByStock(ledger, item.id);
}

export function issuedByTask(ledger: LedgerEntry[], taskId: string): number {
  return ledger
    .filter((e) => e.taskId === taskId && e.kind === "issue")
    .reduce((s, e) => s + e.qty, 0);
}

export function returnedByTask(ledger: LedgerEntry[], taskId: string): number {
  return ledger
    .filter((e) => e.taskId === taskId && e.kind === "return")
    .reduce((s, e) => s + e.qty, 0);
}

/** 任务可退余量（实退不得超过已领） */
export const returnableQty = (ledger: LedgerEntry[], taskId: string): number =>
  issuedByTask(ledger, taskId) - returnedByTask(ledger, taskId);

/**
 * 规则4：开工校验。
 * - 阻塞构件不得占用工位
 * - 排队顺序：无空工位时，只允许队列首位开工（其余按等级/申报时间排队）
 * - 领料不得超过可用库存
 * - 截面留量：毛料各边 ≥ 净截面 + 2×单边留量（允许长宽互换）
 * - 木种必须一致
 */
export interface StartCheckInput {
  task: DispatchTask;
  component: Component;
  stock: StockItem;
  qty: number;
  queue: DispatchTask[]; // 已排序队列
  freeStations: Workstation[];
  ledger: LedgerEntry[];
}

export interface StartCheckResult {
  ok: boolean;
  reason: string | null;
}

export function checkCanStart(input: StartCheckInput): StartCheckResult {
  const { task, component, stock, qty, queue, freeStations, ledger } = input;

  if (task.status !== "queued") return { ok: false, reason: "任务不在排队队列中" };

  const block = blockReason(component);
  if (block) return { ok: false, reason: block };

  if (!Number.isInteger(qty) || qty <= 0)
    return { ok: false, reason: "领料数量须为正整数" };

  if (stock.species !== component.woodSpecies)
    return { ok: false, reason: `木种不一致：库存为${stock.species}，构件需${component.woodSpecies}` };

  const need: Section = {
    width: component.section.width + SECTION_MARGIN_PER_SIDE * 2,
    height: component.section.height + SECTION_MARGIN_PER_SIDE * 2,
  };
  const fits =
    (stock.section.width >= need.width && stock.section.height >= need.height) ||
    (stock.section.width >= need.height && stock.section.height >= need.width);
  if (!fits)
    return {
      ok: false,
      reason: `截面留量不足：毛料 ${sectionText(stock.section)} 不足净截面 + 每边${SECTION_MARGIN_PER_SIDE}mm（需 ≥ ${sectionText(need)}，允许互换）`,
    };

  const avail = availableQty(stock, ledger);
  if (qty > avail)
    return { ok: false, reason: `领料超出可用库存：申请 ${qty} 根，可用 ${avail} 根` };

  if (freeStations.length === 0)
    return { ok: false, reason: "工位已占满：请等待完工释放或完工后由队列首位补位（按病害等级与申报时间排队）" };

  // 工位冲突：仍有空工位时，非队首任务抢占须让位给等级更高/申报更早的队首
  const head = queue[0];
  if (head && head.id !== task.id)
    return {
      ok: false,
      reason: "工位冲突：队列首位优先（病害等级高者、同等级申报早者先派工）",
    };

  return { ok: true, reason: null };
}
