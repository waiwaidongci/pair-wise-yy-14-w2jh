import { useState } from "react";
import { useStore } from "../store";
import {
  batchReserve,
  checkDispatchable,
  findComponent,
  findTimber,
  levelRank,
  occupiedWorkstationIds,
  orderedQueue,
} from "../rules";
import type { RepairTask, Timber } from "../types";
import { fmtQty, fmtTime, LevelBadge, Notice, StatusBadge } from "./Shared";

// 修缮派工 + 木料领退台：派工队列、工位占用、开工领料、追退料、重测入口。

function TaskMaterialRows({ task }: { task: RepairTask }) {
  const { state } = useStore();
  if (task.allocs.length === 0) return <small className="dim">尚未领料</small>;
  return (
    <div className="alloc-list">
      {task.allocs.map((a) => {
        const timber = findTimber(state, a.batchId);
        return (
          <div key={a.batchId} className="alloc-row">
            <span>{timber?.spec ?? a.batchId}</span>
            <small>
              领 {fmtQty(a.issued)} · 退 {fmtQty(a.returned)} · 净用 {fmtQty(a.issued - a.returned)}
            </small>
          </div>
        );
      })}
    </div>
  );
}

function IssueForm({ task, onClose }: { task: RepairTask; onClose: () => void }) {
  const { state, startTask } = useStore();
  const [lines, setLines] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  // 开工时提示每个批次的可领上限（库存 - 截面留量）
  const available = (timber: Timber) =>
    Math.max(0, timber.stock - batchReserve(state, timber));

  const submit = () => {
    const rows = Object.entries(lines)
      .filter(([, v]) => v.trim() !== "")
      .map(([batchId, qty]) => ({ batchId, qty: Number(qty) }));
    const r = startTask(task.id, rows);
    if (!r.ok) setError(r.error);
    else onClose();
  };

  return (
    <div className="modal-card">
      <h4>{task.id} 开工领料</h4>
      <p className="dim">领料超过可用库存或截面留量不足时将拒绝开工。</p>
      <table className="mini-table">
        <thead>
          <tr><th>木料批次</th><th>库存</th><th>留量</th><th>可领</th><th>本次领料(m³)</th></tr>
        </thead>
        <tbody>
          {state.timbers.map((t) => (
            <tr key={t.id}>
              <td>{t.spec}</td>
              <td>{fmtQty(t.stock)}</td>
              <td>{fmtQty(batchReserve(state, t))}</td>
              <td>{fmtQty(available(t))}</td>
              <td>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={lines[t.id] ?? ""}
                  onChange={(e) => setLines((l) => ({ ...l, [t.id]: e.target.value }))}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {error && <Notice kind="error">{error}</Notice>}
      <div className="form-actions">
        <button onClick={onClose}>取消</button>
        <button className="primary" onClick={submit}>确认领料并开工</button>
      </div>
    </div>
  );
}

function ActiveTaskPanel({ task }: { task: RepairTask }) {
  const { state, addIssue, returnMaterial, finishTask, remeasure } = useStore();
  const [batchId, setBatchId] = useState(state.timbers[0]?.id ?? "");
  const [qty, setQty] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [reason, setReason] = useState("");

  const flash = (r: { ok: boolean; error?: string }, ok: string) => {
    setMsg(r.ok ? { kind: "ok", text: ok } : { kind: "error", text: r.error! });
    if (r.ok) setQty("");
  };

  const alloc = task.allocs.find((a) => a.batchId === batchId);
  const refundable = alloc ? alloc.issued - alloc.returned : 0;

  return (
    <div className="active-box">
      <TaskMaterialRows task={task} />
      <div className="move-grid">
        <select value={batchId} onChange={(e) => setBatchId(e.target.value)}>
          {state.timbers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.spec}（库存 {fmtQty(t.stock)}，留量 {fmtQty(batchReserve(state, t))}）
            </option>
          ))}
        </select>
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="数量 m³"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
        <button
          onClick={() => flash(addIssue(task.id, batchId, Number(qty)), "追料成功，已扣减库存")}
        >
          追领
        </button>
        <button
          onClick={() => flash(returnMaterial(task.id, batchId, Number(qty)), `已按实退 ${Number(qty)}m³ 回补库存`)}
          disabled={Number(qty) <= 0 || Number(qty) > refundable + 1e-9}
          title={`该批次本任务可退 ${fmtQty(refundable)}`}
        >
          退料
        </button>
      </div>
      <small className="dim">当前批次本任务可退数量：{fmtQty(refundable)}，退料按实退数量回补库存。</small>

      <div className="move-grid">
        <input
          placeholder="重测原因，如：复测截面变更为170x235mm"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          className="warn-btn"
          onClick={() => {
            const r = remeasure(task.id, reason);
            if (!r.ok) setMsg({ kind: "error", text: r.error });
          }}
        >
          重测转待重排
        </button>
        <button
          className="primary"
          onClick={() => {
            const r = finishTask(task.id);
            if (!r.ok) setMsg({ kind: "error", text: r.error });
          }}
        >
          完工
        </button>
      </div>
      {msg && <Notice kind={msg.kind}>{msg.text}</Notice>}
    </div>
  );
}

export function DispatchView() {
  const { state, runDispatch } = useStore();
  const [issueTask, setIssueTask] = useState<RepairTask | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const queue = orderedQueue(state);
  const occupied = occupiedWorkstationIds(state);
  const pending = state.tasks.filter((t) => t.status === "PENDING");
  const active = state.tasks.filter((t) => t.status === "ACTIVE");
  const reworkOld = state.tasks.filter((t) => t.status === "REWORK");

  const componentOf = (task: RepairTask) => findComponent(state, task.componentId);

  const doDispatch = () => {
    const r = runDispatch();
    setMsg(`本轮 ${r.queued} 个待派工任务入队，${r.assigned} 个分配到工位`);
  };

  return (
    <div className="view-grid">
      <section className="panel">
        <div className="heading">
          <div>
            <p>工位与队列</p>
            <h2>修缮派工台</h2>
          </div>
          <button className="primary" onClick={doDispatch}>刷新自动派工</button>
        </div>
        {msg && <Notice kind="ok">{msg}</Notice>}

        <div className="station-grid">
          {state.workstations.map((w) => {
            const holder = state.tasks.find(
              (t) => (t.status === "ACTIVE" || t.status === "QUEUED") && t.workstationId === w.id
            );
            const holderComponent = holder ? componentOf(holder) : undefined;
            return (
              <article key={w.id} className={`station ${holder ? "station-busy" : "station-free"}`}>
                <h3>{w.name}</h3>
                {holder ? (
                  <>
                    <StatusBadge status={holder.status} />
                    <b>{holderComponent?.code}</b>
                    <small>{holderComponent?.building}</small>
                    <small>{holder.id} · <LevelBadge level={holder.severity} /></small>
                  </>
                ) : (
                  <span className="dim">空闲</span>
                )}
              </article>
            );
          })}
        </div>

        <h3 className="sub-h">待派工（不占工位）</h3>
        <div className="task-strip">
          {pending.length === 0 && <small className="dim">暂无</small>}
          {pending.map((t) => {
            const c = componentOf(t);
            const gate = c ? checkDispatchable(c) : { ok: false as const, error: "构件缺失" };
            return (
              <div key={t.id} className="mini-card blocked">
                <b>{c?.code}</b>
                <small>{c?.building} · {t.id}</small>
                <LevelBadge level={t.severity} />
                {!gate.ok && <small className="text-danger">⛔ {gate.error}</small>}
              </div>
            );
          })}
        </div>

        <h3 className="sub-h">派工队列（病害等级 → 申报时间）</h3>
        <div className="queue-list">
          {queue.length === 0 && <small className="dim">队列空，点击"刷新自动派工"把合格的待派工任务入队</small>}
          {queue.map((t, i) => {
            const c = componentOf(t);
            const seat = state.workstations.find((w) => w.id === t.workstationId);
            return (
              <article key={t.id} className="queue-card">
                <div className="queue-rank">#{i + 1}</div>
                <div className="queue-main">
                  <b>{c?.code} <small>{t.id}</small></b>
                  <small>{c?.building} · 申报 {fmtTime(t.declaredAt)}</small>
                  <div className="tagline">
                    <LevelBadge level={t.severity} />
                    <span className="dim">等级权重 {levelRank(t.severity)}</span>
                  </div>
                </div>
                <div className="queue-side">
                  {seat ? (
                    <>
                      <small>已预留 {seat.name}</small>
                      <button className="primary" onClick={() => setIssueTask(t)}>领料开工</button>
                    </>
                  ) : (
                    <small className="text-danger">等待空闲工位</small>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <p>木料领退台 · 已开工任务（{active.length}）</p>
        {active.length === 0 && <Notice kind="info">暂无已开工构件，从队列领料开工后显示在此。</Notice>}
        {active.map((t) => {
          const c = componentOf(t);
          const seat = state.workstations.find((w) => w.id === t.workstationId);
          return (
            <article key={t.id} className="active-card">
              <div className="heading">
                <div>
                  <b>{c?.building} · {c?.code}</b>
                  <small className="dim"> {t.id} · {seat?.name} · 开工 {fmtTime(t.startedAt)}</small>
                </div>
                <StatusBadge status={t.status} />
              </div>
              <ActiveTaskPanel task={t} />
            </article>
          );
        })}

        {reworkOld.length > 0 && (
          <>
            <h3 className="sub-h">待重排旧记录（保留留痕，不再占工位）</h3>
            {reworkOld.map((t) => {
              const c = componentOf(t);
              return (
                <div key={t.id} className="mini-card rework">
                  <b>{c?.code}</b>
                  <small>{t.id} → 新任务 {t.replacedBy}</small>
                  <small className="dim">重测：{t.remeasureReason}（{fmtTime(t.remeasuredAt)}）</small>
                </div>
              );
            })}
          </>
        )}
      </section>

      {issueTask && (
        <div className="modal-mask" onClick={() => setIssueTask(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <IssueForm task={issueTask} onClose={() => setIssueTask(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
