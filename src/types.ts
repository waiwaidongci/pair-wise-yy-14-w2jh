// 领域类型：测绘构件、修缮派工任务、木料库存与领退流水

export type DefectLevel = "" | "轻微" | "中等" | "严重";

export type ReviewStatus = "none" | "unreviewed" | "reviewed";

/** 测绘构件（构件清单的载体） */
export interface Component {
  id: string;
  building: string; // 建筑名称
  code: string; // 构件编号
  species: string; // 木材种类
  joint: string; // 榫卯类型
  sectionCm: number; // 截面面积 cm²
  sectionText: string; // 截面尺寸原文，如 180x240mm
  defectLoc: string; // 病害位置
  deformation: string; // 变形情况
  suggestion: string; // 修缮建议
  moisture: number | null; // 含水率(%)，缺失为 null
  defectLevel: DefectLevel; // 病害等级，无病害为 ""
  reviewed: ReviewStatus; // 病害复核状态
  createdAt: number;
}

/** 任务状态：待派工 → 排队中 → 已开工 → 已完工 / 待重排 */
export type TaskStatus = "PENDING" | "QUEUED" | "ACTIVE" | "DONE" | "REWORK";

/** 任务在某批次木料上的领退留存 */
export interface MaterialAlloc {
  batchId: string;
  issued: number; // 累计领料 m³
  returned: number; // 累计退料 m³
}

/** 修缮派工任务（派工队列的载体） */
export interface RepairTask {
  id: string;
  componentId: string;
  status: TaskStatus;
  severity: DefectLevel; // 入队时的病害等级快照
  declaredAt: number; // 申报时间
  queuedAt?: number;
  startedAt?: number;
  finishedAt?: number;
  workstationId?: string;
  allocs: MaterialAlloc[];
  remeasureReason?: string;
  remeasuredAt?: number;
  reworkOf?: string; // 由哪个旧任务重测而来
  replacedBy?: string; // 被哪个新任务替换
}

/** 木料批次库存 */
export interface Timber {
  id: string;
  species: string; // 木材种类
  spec: string; // 规格/截面
  sectionCm: number; // 截面面积 cm²
  stock: number; // 库存量 m³
  reserveRate: number; // 截面留量比例 0~1
  stockedAt: number;
}

export type LedgerType = "INIT" | "ISSUE" | "RETURN";

/** 木料领退流水 */
export interface MaterialLedger {
  id: string;
  type: LedgerType;
  batchId: string;
  taskId?: string;
  qty: number; // 领为正、退为负
  time: number;
  note: string;
}

export interface Workstation {
  id: string;
  name: string;
}

export interface State {
  components: Component[];
  tasks: RepairTask[];
  timbers: Timber[];
  ledger: MaterialLedger[];
  workstations: Workstation[];
  seq: number;
  stockRefreshedAt: number; // 库存统计最近刷新时间
}

/** 规则校验结果 */
export type RuleResult<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; error: string };
