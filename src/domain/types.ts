// ===== 领域模型：修缮派工与木料领退 =====

export type DefectLevel = "severe" | "medium" | "light";

export type JoineryType = "燕尾榫" | "透榫" | "半榫" | "箍头榫";

/** 派工任务状态：待派工 / 排队中 / 已开工 / 待重排 / 已完工 */
export type TaskStatus = "pending" | "queued" | "active" | "reschedule" | "done";

export type LedgerKind = "issue" | "return";

export interface Section {
  width: number;
  height: number;
}

export interface Defect {
  id: string;
  location: string; // 病害位置
  detail: string; // 变形/病害情况
  level: DefectLevel;
  reviewed: boolean; // 是否已复核
}

export interface Component {
  id: string;
  code: string; // 构件编号
  building: string; // 建筑名称
  woodSpecies: string; // 木材种类
  joineryType: JoineryType; // 榫卯类型
  section: Section; // 净截面尺寸 mm
  moisture: number | null; // 含水率 %，缺失时为 null
  defects: Defect[];
  suggestion: string; // 修缮建议
  revision: number; // 测绘修订版次（重测递增）
  updatedAt: number;
}

export interface StockItem {
  id: string;
  species: string; // 木材种类
  section: Section; // 毛料截面
  qty: number; // 台账存量（根）
}

export interface Workstation {
  id: string;
  name: string;
}

export interface LedgerEntry {
  id: string;
  taskId: string;
  stockItemId: string;
  kind: LedgerKind; // issue=领料 / return=退料
  qty: number; // 数量（根）
  time: number;
}

export interface TaskEvent {
  time: number;
  type: "declare" | "queue" | "start" | "reject" | "return" | "complete" | "resurvey" | "requeue";
  text: string;
}

export interface DispatchTask {
  id: string;
  building: string;
  componentId: string;
  revision: number; // 申报时的构件修订版次
  status: TaskStatus;
  declaredAt: number; // 申报时间
  startedAt: number | null;
  workstationId: string | null;
  rejectReason: string | null; // 最近一次被拒绝开工的原因
  history: TaskEvent[]; // 旧记录全程保留
}

export interface State {
  components: Component[];
  tasks: DispatchTask[];
  stock: StockItem[];
  ledger: LedgerEntry[];
  workstations: Workstation[];
  seq: number;
  lastStockSync: number;
}

export interface NewComponentInput {
  building: string;
  code: string;
  woodSpecies: string;
  joineryType: JoineryType;
  section: Section;
  moisture: number | null;
  defect: { location: string; detail: string; level: DefectLevel } | null;
  suggestion: string;
}

export interface ResurveyPatch {
  moisture: number;
  section: Section;
  newDefect: { location: string; detail: string; level: DefectLevel } | null;
}
