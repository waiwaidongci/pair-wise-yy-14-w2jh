import { useStore } from "../store";
import { batchReserve, consistencyReport, findTask, findTimber, stockStats } from "../rules";
import { fmtQty, fmtTime, Notice } from "./Shared";

// 木料库存统计 + 领退流水 + 构件清单/派工队列/库存三方一致性。

export function InventoryView() {
  const { state, refreshStock, resetAll } = useStore();
  const stats = stockStats(state);
  const problems = consistencyReport(state);

  const queuedCount = state.tasks.filter((t) => t.status === "QUEUED").length;
  const activeCount = state.tasks.filter((t) => t.status === "ACTIVE").length;
  const pendingCount = state.tasks.filter((t) => t.status === "PENDING").length;
  const occupiedSeats = state.tasks
    .filter((t) => (t.status === "ACTIVE" || t.status === "QUEUED") && t.workstationId)
    .length;

  return (
    <div className="view-grid">
      <section className="panel">
        <div className="heading">
          <div>
            <p>库存统计</p>
            <h2>木料台账</h2>
          </div>
          <div className="head-actions">
            <small className="dim">最近刷新 {fmtTime(state.stockRefreshedAt)}</small>
            <button className="primary" onClick={refreshStock}>刷新库存统计</button>
            <button
              onClick={() => {
                if (confirm("恢复演示种子数据？当前修改将清空。")) resetAll();
              }}
            >
              重置数据
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>批次</th>
                <th>材种规格</th>
                <th>当前库存</th>
                <th>累计入库</th>
                <th>累计领用</th>
                <th>累计回补</th>
                <th>流水结余</th>
                <th>截面留量</th>
                <th>核对</th>
              </tr>
            </thead>
            <tbody>
              {state.timbers.map((t) => {
                const s = stats[t.id];
                return (
                  <tr key={t.id}>
                    <td>{t.id}</td>
                    <td>
                      <b>{t.species}</b>
                      <small>{t.spec}</small>
                    </td>
                    <td><b>{fmtQty(t.stock)}</b></td>
                    <td>{fmtQty(s.inQty)}</td>
                    <td>{fmtQty(s.issueQty)}</td>
                    <td className="text-ok">+{fmtQty(s.returnQty)}</td>
                    <td>{fmtQty(s.expected)}</td>
                    <td>
                      {fmtQty(batchReserve(state, t))}
                      <small className="dim">留量率 {(t.reserveRate * 100).toFixed(0)}%</small>
                    </td>
                    <td>{s.matches ? <span className="text-ok">✓ 一致</span> : <span className="text-danger">✗ 不一致</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Notice kind="info">
          领料超过<strong>可用库存</strong>或扣减后低于<strong>截面留量</strong>一律拒绝；退料按实退数量回补，统计始终由流水重新计算。
        </Notice>
      </section>

      <section className="panel">
        <p>一致性核对</p>
        <h2>构件清单 · 派工队列 · 库存统计</h2>
        <div className="summary-grid">
          <article><small>构件清单</small><strong>{state.components.length}</strong></article>
          <article><small>待派工 / 排队中 / 已开工</small><strong>{pendingCount} / {queuedCount} / {activeCount}</strong></article>
          <article><small>工位占用（含预留）</small><strong>{occupiedSeats} / {state.workstations.length}</strong></article>
          <article><small>台账差异</small><strong className={problems.length ? "text-danger" : "text-ok"}>{problems.length}</strong></article>
        </div>
        {problems.length === 0 ? (
          <Notice kind="ok">三方数据一致：构件清单、派工队列、刷新后的库存统计互相对得上。</Notice>
        ) : (
          <div className="problem-list">
            {problems.map((p, i) => (
              <Notice key={i} kind="error">{p}</Notice>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <p>领退流水</p>
        <h2>木料出入库记录</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>时间</th><th>类型</th><th>批次</th><th>关联任务</th><th>数量</th><th>备注</th></tr>
            </thead>
            <tbody>
              {[...state.ledger].reverse().map((l) => {
                const timber = findTimber(state, l.batchId);
                const task = l.taskId ? findTask(state, l.taskId) : undefined;
                return (
                  <tr key={l.id}>
                    <td>{fmtTime(l.time)}</td>
                    <td>
                      <span className={`ledger-tag ledger-${l.type}`}>
                        {l.type === "INIT" ? "入库" : l.type === "ISSUE" ? "领料" : "退料"}
                      </span>
                    </td>
                    <td>{timber?.spec ?? l.batchId}</td>
                    <td>{task ? `${l.taskId}` : "—"}</td>
                    <td className={l.qty < 0 ? "text-ok" : ""}>
                      {l.qty > 0 ? "+" : ""}{fmtQty(l.qty)}
                    </td>
                    <td className="dim">{l.note}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
