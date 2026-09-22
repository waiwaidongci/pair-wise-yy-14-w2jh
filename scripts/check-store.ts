import assert from "node:assert";
import { reducer } from "../src/store/reducer";
import type { State } from "../src/domain/types";
import { seedState } from "../src/data/seed";
import { availableQty, returnableQty } from "../src/domain/rules";

let s: State = JSON.parse(JSON.stringify(seedState)) as State;

// c-3 含水率缺失：申报 -> pending 待派工
s = reducer(s, { type: "DECLARE", componentId: "c-3" });
let t3 = s.tasks.find((t) => t.componentId === "c-3")!;
assert.strictEqual(t3.status, "pending");
assert.strictEqual(t3.workstationId, null);
console.log("✓ 含水率缺失申报后待派工，不占工位");

// 补齐含水率 -> 自动晋升 queued
s = reducer(s, { type: "SET_MOISTURE", componentId: "c-3", moisture: 11.0 });
t3 = s.tasks.find((t) => t.componentId === "c-3")!;
assert.strictEqual(t3.status, "queued");
console.log("✓ 阻塞解除自动晋升排队");

// c-4 未复核：申报 -> pending；复核后自动晋升
s = reducer(s, { type: "DECLARE", componentId: "c-4" });
let t4 = s.tasks.find((t) => t.componentId === "c-4")!;
assert.strictEqual(t4.status, "pending");
const d4 = s.components.find((c) => c.id === "c-4")!.defects[0];
s = reducer(s, { type: "REVIEW_DEFECT", componentId: "c-4", defectId: d4.id });
t4 = s.tasks.find((t) => t.componentId === "c-4")!;
assert.strictEqual(t4.status, "queued");
console.log("✓ 未复核病害复核后自动晋升排队");

// 队列：t-2(中等,10:10种子时间) 早于 t-3(中等,测试运行当下)、t-4(严重,测试运行当下)
// 严重 t-4 排首位；验证非队首让位：用排在后面的 t-3 尝试开工
{
  const t3id = s.tasks.find((t) => t.componentId === "c-3")!.id;
  const s2 = reducer(s, { type: "START", taskId: t3id, stockItemId: "s-5", qty: 1 });
  const t3q = s2.tasks.find((t) => t.id === t3id)!;
  assert.strictEqual(t3q.status, "queued");
  assert.ok(t3q.rejectReason!.includes("工位冲突"), t3q.rejectReason!);
  console.log("✓ 非队首任务开工让位:", t3q.rejectReason);
}

// 重复申报被忽略（同建筑同构件一个未完工任务）
const taskCount = s.tasks.length;
s = reducer(s, { type: "DECLARE", componentId: "c-4" });
assert.strictEqual(s.tasks.length, taskCount);
console.log("✓ 重复申报被拒绝");

// 严重任务 t-4 作为队首（松木 160x200，s-3 180x220 刚好满足每边10mm留量）开工占用 ws-2
const s3 = s.stock.find((x) => x.id === "s-3")!;
assert.strictEqual(availableQty(s3, s.ledger), 5);
s = reducer(s, { type: "START", taskId: t4.id, stockItemId: "s-3", qty: 2 });
t4 = s.tasks.find((t) => t.id === t4.id)!;
assert.strictEqual(t4.status, "active", "t4 start: " + t4.rejectReason);
assert.strictEqual(t4.workstationId, "ws-2");
assert.strictEqual(availableQty(s3, s.ledger), 3);
console.log("✓ 严重队首领料2根占用ws-2开工，库存扣减");

// 此时工位满，t-2 尝试开工 -> 拒绝并写入旧记录
const t2Before = s.tasks.find((t) => t.id === "t-2")!;
s = reducer(s, { type: "START", taskId: "t-2", stockItemId: "s-2", qty: 1 });
let t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "queued");
assert.ok(t2.rejectReason!.includes("工位已占满"), t2.rejectReason!);
assert.ok(t2.history[t2.history.length - 1].type === "reject");
console.log("✓ 工位全满拒绝开工，拒绝原因入旧记录:", t2.rejectReason);

// t-4 完工释放 ws-2
s = reducer(s, { type: "COMPLETE", taskId: t4.id });
t4 = s.tasks.find((t) => t.id === t4.id)!;
assert.strictEqual(t4.status, "done");
assert.strictEqual(t4.workstationId, null);
console.log("✓ 完工释放工位");

// 超库存开工 t-2：s-2 可用4，申请99 -> 拒绝
s = reducer(s, { type: "START", taskId: "t-2", stockItemId: "s-2", qty: 99 });
t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "queued");
assert.ok(t2.rejectReason!.includes("超出可用库存"));
console.log("✓ 超库存拒绝:", t2.rejectReason);

// 正常开工 t-2 松木 s-2 250x250 对 220x220 留量足够
s = reducer(s, { type: "START", taskId: "t-2", stockItemId: "s-2", qty: 1 });
t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "active");
assert.strictEqual(t2.workstationId, "ws-2");
console.log("✓ t-2 正常领料开工");

// 退料 1 根（t-1 的 s-1）回补
const s1 = s.stock.find((x) => x.id === "s-1")!;
const availBefore = availableQty(s1, s.ledger);
s = reducer(s, { type: "RETURN", taskId: "t-1", stockItemId: "s-1", qty: 1 });
assert.strictEqual(availableQty(s1, s.ledger), availBefore + 1);
assert.strictEqual(returnableQty(s.ledger, "t-1"), 0);
console.log("✓ 退料按实退数量回补");

// 超退被忽略
const ledgerCount = s.ledger.length;
s = reducer(s, { type: "RETURN", taskId: "t-1", stockItemId: "s-1", qty: 5 });
assert.strictEqual(s.ledger.length, ledgerCount);
console.log("✓ 超过已领数量的退料被拒绝");

// 已开工构件 c-2 重测（变更截面）-> reschedule，释放 ws-2，旧记录保留
const histLen = t2.history.length;
s = reducer(s, {
  type: "RESURVEY",
  componentId: "c-2",
  patch: { moisture: 13.5, section: { width: 230, height: 230 }, newDefect: null },
});
t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "reschedule");
assert.strictEqual(t2.workstationId, null);
assert.ok(t2.history.length > histLen);
const c2 = s.components.find((c) => c.id === "c-2")!;
assert.strictEqual(c2.revision, 2);
assert.strictEqual(c2.section.width, 230);
console.log("✓ 已开工构件重测 -> 待重排、释放工位、版次+1、旧记录保留");

// 未退清旧料前不能重排
s = reducer(s, { type: "REQUEUE", taskId: "t-2" });
t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "reschedule");
console.log("✓ 旧料未退清不允许重排");

// 退清 s-2 的 1 根后重排 -> queued
s = reducer(s, { type: "RETURN", taskId: "t-2", stockItemId: "s-2", qty: 1 });
s = reducer(s, { type: "REQUEUE", taskId: "t-2" });
t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "queued");
assert.strictEqual(t2.revision, 2);
assert.strictEqual(t2.startedAt, null);
console.log("✓ 退料结清后按新版数据重新排队");

// 新截面 230x230 需 250x250，s-2 恰好满足，可再次开工（ws-2 空闲）
s = reducer(s, { type: "START", taskId: "t-2", stockItemId: "s-2", qty: 1 });
t2 = s.tasks.find((t) => t.id === "t-2")!;
assert.strictEqual(t2.status, "active");
console.log("✓ 按新版截面重新领料开工");

// SYNC_STOCK 不改变数量，仅刷新时间戳
const availSnapshot = s.stock.map((i) => availableQty(i, s.ledger));
const syncTime = s.lastStockSync;
s = reducer(s, { type: "SYNC_STOCK" });
assert.deepStrictEqual(s.stock.map((i) => availableQty(i, s.ledger)), availSnapshot);
assert.ok(s.lastStockSync >= syncTime);
console.log("✓ 刷新库存统计：统计由台账+流水推导，结果一致");

console.log("\n存储层端到端流程全部通过");
