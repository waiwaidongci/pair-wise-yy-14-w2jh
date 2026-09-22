import type { State } from "./types";

// 存储层：只管状态的持久化与种子数据，不承载任何业务规则。

const STORAGE_KEY = "hxyfront-62013-restore-state-v1";
const MINUTE = 60_000;
const now = Date.now();

/** 初始种子数据：构件 / 派工任务 / 木料批次 / 工位 */
export function seedState(): State {
  const workstations = [
    { id: "W1", name: "一号修缮工位" },
    { id: "W2", name: "二号修缮工位" },
    { id: "W3", name: "三号修缮工位" },
  ];

  const components: State["components"] = [
    {
      id: "C1",
      building: "大雄宝殿",
      code: "梁架A-03",
      species: "楠木",
      joint: "透榫",
      sectionCm: 432,
      sectionText: "180x240mm",
      defectLoc: "东端榫头",
      deformation: "端部开裂，长约320mm",
      suggestion: "剔补裂缝加铁箍",
      moisture: 13.2,
      defectLevel: "严重",
      reviewed: "reviewed",
      createdAt: now - 180 * MINUTE,
    },
    {
      id: "C2",
      building: "大雄宝殿",
      code: "柱网C-12",
      species: "楠木",
      joint: "半榫",
      sectionCm: 490,
      sectionText: "Φ250mm",
      defectLoc: "柱脚",
      deformation: "柱脚糟朽深40mm",
      suggestion: "局部墩接",
      moisture: 15.6,
      defectLevel: "中等",
      reviewed: "reviewed",
      createdAt: now - 150 * MINUTE,
    },
    {
      id: "C3",
      building: "观音阁",
      code: "斗拱D-07",
      species: "榆木",
      joint: "燕尾榫",
      sectionCm: 120,
      sectionText: "100x120mm",
      defectLoc: "栱臂",
      deformation: "轻微变形",
      suggestion: "继续监测",
      moisture: null, // 含水率缺失 → 只能待派工
      defectLevel: "轻微",
      reviewed: "reviewed",
      createdAt: now - 120 * MINUTE,
    },
    {
      id: "C4",
      building: "观音阁",
      code: "阑额L-02",
      species: "松木",
      joint: "箍头榫",
      sectionCm: 300,
      sectionText: "150x200mm",
      defectLoc: "下皮中段",
      deformation: "糟朽凹损",
      suggestion: "局部更换",
      moisture: 14.1,
      defectLevel: "中等",
      reviewed: "unreviewed", // 病害未复核 → 只能待派工
      createdAt: now - 90 * MINUTE,
    },
    {
      id: "C5",
      building: "大雄宝殿",
      code: "梁架A-05",
      species: "楠木",
      joint: "透榫",
      sectionCm: 432,
      sectionText: "180x240mm",
      defectLoc: "西端榫肩",
      deformation: "榫肩压溃",
      suggestion: "配新榫重做",
      moisture: 12.8,
      defectLevel: "轻微",
      reviewed: "reviewed",
      createdAt: now - 60 * MINUTE,
    },
  ];

  const tasks: State["tasks"] = [
    {
      id: "T1",
      componentId: "C2",
      status: "ACTIVE",
      severity: "中等",
      declaredAt: now - 140 * MINUTE,
      queuedAt: now - 138 * MINUTE,
      startedAt: now - 100 * MINUTE,
      workstationId: "W1",
      allocs: [{ batchId: "B1", issued: 0.02, returned: 0 }],
    },
    {
      id: "T2",
      componentId: "C1",
      status: "QUEUED",
      severity: "严重",
      declaredAt: now - 110 * MINUTE,
      queuedAt: now - 108 * MINUTE,
      allocs: [],
    },
  ];

  const timbers: State["timbers"] = [
    {
      id: "B1",
      species: "楠木",
      spec: "200x240mm 方料",
      sectionCm: 480,
      stock: 0.48,
      reserveRate: 0.1,
      stockedAt: now - 30 * 24 * 60 * MINUTE,
    },
    {
      id: "B2",
      species: "松木",
      spec: "150x200mm 方料",
      sectionCm: 300,
      stock: 0.0,
      reserveRate: 0.12,
      stockedAt: now - 20 * 24 * 60 * MINUTE,
    },
    {
      id: "B3",
      species: "榆木",
      spec: "100x120mm 小料",
      sectionCm: 120,
      stock: 0.25,
      reserveRate: 0.08,
      stockedAt: now - 10 * 24 * 60 * MINUTE,
    },
  ];

  const ledger: State["ledger"] = [
    { id: "L1", type: "INIT", batchId: "B1", qty: 0.5, time: timbers[0].stockedAt, note: "期初入库 0.50m³" },
    { id: "L2", type: "INIT", batchId: "B2", qty: 0, time: timbers[1].stockedAt, note: "期初入库 0.00m³" },
    { id: "L3", type: "INIT", batchId: "B3", qty: 0.25, time: timbers[2].stockedAt, note: "期初入库 0.25m³" },
    { id: "L4", type: "ISSUE", batchId: "B1", taskId: "T1", qty: 0.02, time: now - 100 * MINUTE, note: "T1 领料开工" },
  ];

  return {
    components,
    tasks,
    timbers,
    ledger,
    workstations,
    seq: 100,
    stockRefreshedAt: now,
  };
}

export function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    // 数据损坏时回退到种子数据
  }
  return seedState();
}

export function saveState(state: State): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时仅保留内存态
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
