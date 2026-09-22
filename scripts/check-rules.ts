import assert from "node:assert";
import type { State } from "../src/domain/types";
import { seedState } from "../src/data/seed";
import {
  availableQty,
  blockReason,
  checkCanStart,
  findOpenTask,
  freeWorkstations,
  returnableQty,
  sectionText,
  sortQueue,
} from "../src/domain/rules";

let s: State = JSON.parse(JSON.stringify(seedState)) as State;
const byId = (id: string) => s.components.find((c) => c.id === id)!;

// 1. 阻塞：c-3 含水率缺失、c-4 未复核病害
assert.strictEqual(blockReason(byId("c-3")), "含水率缺失");
assert.ok(blockReason(byId("c-4"))?.includes("未复核病害"));
assert.strictEqual(blockReason(byId("c-1")), null);
console.log("✓ 规则1 未复核病害/含水率缺失 -> 阻塞待派工");

// 2. 同建筑同构件唯一未完工任务
assert.ok(findOpenTask(s.tasks, "大雄宝殿", "c-1")?.status === "active");
assert.strictEqual(findOpenTask(s.tasks, "大雄宝殿", "c-5"), null);
console.log("✓ 规则2 同一建筑同一构件仅一个未完工任务");

// 3. 队列排序：严重且申报早者在前（t-2 中等已在队）；构造一个严重晚申报任务对比
const q1 = sortQueue(s.tasks, s.components);
// c-5 与 c-2 同为 medium -> 申报时间早的 t-2 排前
assert.strictEqual(q1[0].id, "t-2", "同等级申报早者优先");
console.log("✓ 规则3 队列按病害等级、申报时间排序:", q1.map((t) => t.id).join(","));

// 严重病害任务即使申报更晚也排到队首（用 c-4 严重构件构造排队态）
const severeTask = {
  id: "t-sev",
  building: "观音阁",
  componentId: "c-4",
  revision: 1,
  status: "queued" as const,
  declaredAt: s.tasks[1].declaredAt + 100000,
  startedAt: null,
  workstationId: null,
  rejectReason: null,
  history: [],
};
const qSevere = sortQueue([...s.tasks, severeTask], s.components);
assert.strictEqual(qSevere[0].id, "t-sev", "严重等级插队");
console.log("✓ 规则3 严重病害申报更晚仍排首位");

// 4. 库存统计一致：s-1 台账6，t-1 领1未退 -> 可用5
assert.strictEqual(availableQty(s.stock[0], s.ledger), 5);
assert.strictEqual(returnableQty(s.ledger, "t-1"), 1);
console.log("✓ 规则4/库存 台账-净占用=可用；可退=已领-已退");

// 5. 开工校验：当前 t-1 占用 ws-1，ws-2 空闲，队首 t-2 可开工（松木 s-2 足够）
const free = freeWorkstations(s.workstations, s.tasks);
assert.strictEqual(free.length, 1);
const c2 = byId("c-2");
const ok = checkCanStart({
  task: s.tasks.find((t) => t.id === "t-2")!,
  component: c2,
  stock: s.stock.find((x) => x.id === "s-2")!,
  qty: 1,
  queue: sortQueue(s.tasks, s.components),
  freeStations: free,
  ledger: s.ledger,
});
assert.strictEqual(ok.ok, true, JSON.stringify(ok));
console.log("✓ 队首、料足、有空工位 -> 允许开工");

// 6. 截面留量不足：c-5 140x180 需 160x200；构造杉木 150x210（宽不足且互换仍不足）-> 拒绝
//    以 t-2 为载体仅做料项校验，构件换成 c-5 并把它置于队首避免工位顺序干扰
const badSection = checkCanStart({
  task: { ...s.tasks.find((t) => t.id === "t-2")!, componentId: "c-5" },
  component: byId("c-5"),
  stock: { id: "z1", species: "杉木", section: { width: 150, height: 210 }, qty: 3 },
  qty: 1,
  queue: [{ ...s.tasks.find((t) => t.id === "t-2")!, componentId: "c-5" }],
  freeStations: free,
  ledger: s.ledger,
});
assert.strictEqual(badSection.ok, false);
assert.ok(badSection.reason!.includes("截面留量不足"), badSection.reason!);
console.log("✓ 截面留量不足拒绝:", badSection.reason);

// 7. 超库存拒绝
const over = checkCanStart({
  task: s.tasks.find((t) => t.id === "t-2")!,
  component: c2,
  stock: s.stock.find((x) => x.id === "s-2")!,
  qty: 99,
  queue: sortQueue(s.tasks, s.components),
  freeStations: free,
  ledger: s.ledger,
});
assert.strictEqual(over.ok, false);
assert.ok(over.reason!.includes("超出可用库存"));
console.log("✓ 领料超可用库存拒绝:", over.reason);

// 8. 木种不符
const wrongWood = checkCanStart({
  task: s.tasks.find((t) => t.id === "t-2")!,
  component: c2,
  stock: s.stock.find((x) => x.id === "s-1")!,
  qty: 1,
  queue: sortQueue(s.tasks, s.components),
  freeStations: free,
  ledger: s.ledger,
});
assert.strictEqual(wrongWood.ok, false);
assert.ok(wrongWood.reason!.includes("木种不一致"));
console.log("✓ 木种不一致拒绝:", wrongWood.reason);

// 9. 阻塞构件不得开工
const blockedStart = checkCanStart({
  task: { ...s.tasks[0], id: "t-b", status: "queued", componentId: "c-3" },
  component: byId("c-3"),
  stock: s.stock.find((x) => x.id === "s-5")!,
  qty: 1,
  queue: [{ ...s.tasks[0], id: "t-b", status: "queued", componentId: "c-3" }],
  freeStations: free,
  ledger: s.ledger,
});
assert.strictEqual(blockedStart.ok, false);
assert.ok(blockedStart.reason!.includes("含水率缺失"));
console.log("✓ 阻塞构件不得占用工位:", blockedStart.reason);

// 10. 留量互换可通过：c-1 净180x240 需200x260；s-1 210x270 正向满足
assert.strictEqual(
  checkCanStart({
    task: { ...s.tasks[0], status: "queued" },
    component: byId("c-1"),
    stock: s.stock[0],
    qty: 1,
    queue: [{ ...s.tasks[0], status: "queued" }],
    freeStations: free,
    ledger: s.ledger,
  }).ok,
  true,
);
// 互换情形：库存 260x210 对需求 200x260 -> 260>=260 且 210>=200 互换通过
const swapped = checkCanStart({
  task: { ...s.tasks[0], status: "queued" },
  component: byId("c-1"),
  stock: { id: "z", species: "楠木", section: { width: 260, height: 210 }, qty: 2 },
  qty: 1,
  queue: [{ ...s.tasks[0], status: "queued" }],
  freeStations: free,
  ledger: s.ledger,
});
assert.strictEqual(swapped.ok, true, swapped.reason ?? "swap should pass");
console.log("✓ 截面长宽互换匹配通过", sectionText({ width: 260, height: 210 }));

// 11. 退料回补：给 t-1 退1后 s-1 可用恢复6
s.ledger.push({ id: "l-9", taskId: "t-1", stockItemId: "s-1", kind: "return", qty: 1, time: Date.now() });
assert.strictEqual(availableQty(s.stock[0], s.ledger), 6);
assert.strictEqual(returnableQty(s.ledger, "t-1"), 0);
console.log("✓ 退料按实退回补库存");

console.log("\n全部业务规则断言通过");
