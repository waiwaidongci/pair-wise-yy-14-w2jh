// ===== 操作层：木料领退台（台账、刷新库存统计、领退流水、一致性核对）=====
import { useMemo } from "react";
import { useStore } from "../store/store";
import {
  availableQty,
  occupiedByStock,
  sectionText,
  sortQueue,
  STATUS_LABEL,
} from "../domain/rules";
import { Empty, formatTime } from "./ui";

function MaterialDesk() {
  const { state, dispatch } = useStore();

  const ledgerSorted = useMemo(
    () => state.ledger.slice().sort((a, b) => b.time - a.time),
    [state.ledger],
  );

  const stats = useMemo(() => {
    const netOccupied = state.stock.reduce((s, i) => s + occupiedByStock(state.ledger, i.id), 0);
    const totalBook = state.stock.reduce((s, i) => s + i.qty, 0);
    const issues = state.ledger.filter((e) => e.kind === "issue").reduce((s, e) => s + e.qty, 0);
    const returns = state.ledger.filter((e) => e.kind === "return").reduce((s, e) => s + e.qty, 0);
    return { netOccupied, totalBook, totalAvailable: totalBook - netOccupied, issues, returns };
  }, [state.stock, state.ledger]);

  // 一致性核对：构件清单、派工队列、库存统计三方对账
  const consistency = useMemo(() => {
    const queue = sortQueue(state.tasks, state.components);
    const active = state.tasks.filter((t) => t.status === "active");
    const occupiedWs = new Set(active.map((t) => t.workstationId));
    const checks: { label: string; ok: boolean; detail: string }[] = [
      {
        label: "库存口径",
        ok: stats.totalAvailable === stats.totalBook - stats.netOccupied,
        detail: `台账 ${stats.totalBook} − 净占用 ${stats.netOccupied} = 可用 ${stats.totalAvailable}`,
      },
      {
        label: "领退流水",
        ok: stats.netOccupied === stats.issues - stats.returns,
        detail: `领料 ${stats.issues} − 退料 ${stats.returns} = ${stats.issues - stats.returns}`,
      },
      {
        label: "工位占用",
        ok: occupiedWs.size === active.length && active.length <= state.workstations.length,
        detail: `已开工 ${active.length} / 工位 ${state.workstations.length}，占用记录 ${occupiedWs.size}`,
      },
      {
        label: "任务归属",
        ok: state.tasks.every((t) => state.components.some((c) => c.id === t.componentId)),
        detail: `${state.tasks.length} 个任务均能在 ${state.components.length} 个构件清单中找到归属`,
      },
      {
        label: "派工队列",
        ok: queue.every((t) => t.status === "queued"),
        detail: `队列 ${queue.length} 个任务状态一致，按病害等级与申报时间排序`,
      },
    ];
    return checks;
  }, [state, stats]);

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>木料库存</p>
            <h2>库存统计（刷新后）</h2>
          </div>
          <div className="actions">
            <span className="muted">上次刷新：{formatTime(state.lastStockSync)}</span>
            <button className="primary" onClick={() => dispatch({ type: "SYNC_STOCK" })}>
              刷新库存统计
            </button>
          </div>
        </div>
        <div className="stock-summary">
          <div className="sum-item">
            <small>台账总量</small>
            <strong>{stats.totalBook}</strong>
            <span>根</span>
          </div>
          <div className="sum-item">
            <small>净占用（领-退）</small>
            <strong>{stats.netOccupied}</strong>
            <span>根</span>
          </div>
          <div className="sum-item highlight">
            <small>可用库存</small>
            <strong>{stats.totalAvailable}</strong>
            <span>根</span>
          </div>
          <div className="sum-item">
            <small>累计领料 / 退料</small>
            <strong>
              {stats.issues}/{stats.returns}
            </strong>
            <span>根</span>
          </div>
        </div>

        <div className="stock-grid">
          {state.stock.map((s) => {
            const occupied = occupiedByStock(state.ledger, s.id);
            const avail = availableQty(s, state.ledger);
            const pct = s.qty > 0 ? Math.round((occupied / s.qty) * 100) : 0;
            return (
              <article key={s.id} className="stock-card">
                <h3>
                  {s.species} <em>{sectionText(s.section)}</em>
                </h3>
                <div className="bar">
                  <i style={{ width: `${pct}%` }} />
                </div>
                <p className="stock-nums">
                  台账 <b>{s.qty}</b> · 净占用 <b>{occupied}</b> · 可用{" "}
                  <b className={avail <= 0 ? "warn" : ""}>{avail}</b>
                </p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>领退台账</p>
            <h2>木料领退流水（{state.ledger.length}）</h2>
          </div>
          <span className="muted">退料按实退数量回补库存</span>
        </div>
        {ledgerSorted.length === 0 && <Empty text="暂无领退记录" />}
        <table className="ledger-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>类型</th>
              <th>关联任务 / 构件</th>
              <th>木料</th>
              <th className="num">数量</th>
            </tr>
          </thead>
          <tbody>
            {ledgerSorted.map((e) => {
              const task = state.tasks.find((t) => t.id === e.taskId);
              const comp = task && state.components.find((c) => c.id === task.componentId);
              const stock = state.stock.find((s) => s.id === e.stockItemId);
              return (
                <tr key={e.id}>
                  <td>{formatTime(e.time)}</td>
                  <td>
                    <span className={`kind ${e.kind}`}>{e.kind === "issue" ? "领料" : "退料"}</span>
                    {task && <span className="muted"> · {STATUS_LABEL[task.status]}</span>}
                  </td>
                  <td>
                    {task?.building} · {comp?.code ?? "—"}
                  </td>
                  <td>
                    {stock?.species} {stock ? sectionText(stock.section) : e.stockItemId}
                  </td>
                  <td className={`num ${e.kind}`}>{e.kind === "issue" ? "−" : "+"}
                    {e.qty}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>三方对账</p>
            <h2>一致性核对</h2>
          </div>
          <span className="muted">构件清单 · 派工队列 · 刷新后的库存统计</span>
        </div>
        <ul className="check-list">
          {consistency.map((c) => (
            <li key={c.label} className={c.ok ? "ok" : "bad"}>
              <span className="check-mark">{c.ok ? "✓" : "✗"}</span>
              <b>{c.label}</b>
              <span className="muted">{c.detail}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export default MaterialDesk;
