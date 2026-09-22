// ===== 操作层：修缮派工队列（工位占用、排队、领料开工、待重排、完工）=====
import { useMemo, useState } from "react";
import { useStore } from "../store/store";
import type { DispatchTask, StockItem } from "../domain/types";
import {
  availableQty,
  blockReason,
  freeWorkstations,
  issuedByTask,
  returnableQty,
  returnedByTask,
  sectionText,
  sortQueue,
  STATUS_LABEL,
  topDefectLevel,
  LEVEL_LABEL,
} from "../domain/rules";
import { Empty, formatTime, StatusPill } from "./ui";

function DispatchBoard() {
  const { state } = useStore();
  const queue = useMemo(
    () => sortQueue(state.tasks, state.components),
    [state.tasks, state.components],
  );
  const free = useMemo(
    () => freeWorkstations(state.workstations, state.tasks),
    [state.workstations, state.tasks],
  );
  const active = state.tasks.filter((t) => t.status === "active");
  const pending = state.tasks.filter((t) => t.status === "pending");
  const reschedule = state.tasks.filter((t) => t.status === "reschedule");
  const done = state.tasks.filter((t) => t.status === "done");

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>工位总览</p>
            <h2>修缮工位</h2>
          </div>
          <span className="muted">
            空闲 {free.length}/{state.workstations.length}
          </span>
        </div>
        <div className="station-grid">
          {state.workstations.map((w) => {
            const occupant = active.find((t) => t.workstationId === w.id);
            const comp = occupant && state.components.find((c) => c.id === occupant.componentId);
            return (
              <article key={w.id} className={`station ${occupant ? "busy" : "idle"}`}>
                <h3>{w.name}</h3>
                {occupant && comp ? (
                  <p>
                    <b>占用中</b>
                    <br />
                    {occupant.building} · {comp.code}
                    <br />
                    开工 {occupant.startedAt ? formatTime(occupant.startedAt) : "—"}
                  </p>
                ) : (
                  <p className="muted">空闲，等待队列首位</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>待派工</p>
            <h2>阻塞任务（{pending.length}）</h2>
          </div>
          <span className="muted">未复核病害 / 含水率缺失，不得占用工位</span>
        </div>
        {pending.length === 0 && <Empty text="无阻塞任务" />}
        <div className="task-list">
          {pending.map((t) => (
            <TaskCard key={t.id} task={t} mode="blocked" />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>派工队列</p>
            <h2>排队任务（{queue.length}）</h2>
          </div>
          <span className="muted">冲突时按病害等级 → 申报时间排序，仅队首可在无空工位时开工</span>
        </div>
        {queue.length === 0 && <Empty text="队列已空" />}
        <div className="task-list">
          {queue.map((t, i) => (
            <TaskCard key={t.id} task={t} mode="queue" rank={i + 1} />
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>施工与重排</p>
            <h2>已开工 / 待重排（{active.length + reschedule.length}）</h2>
          </div>
        </div>
        <div className="task-list">
          {[...active, ...reschedule].map((t) => (
            <TaskCard key={t.id} task={t} mode={t.status === "active" ? "active" : "reschedule"} />
          ))}
          {active.length + reschedule.length === 0 && <Empty text="暂无在制任务" />}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>旧记录归档</p>
            <h2>已完工任务（{done.length}）</h2>
          </div>
        </div>
        <div className="task-list">
          {done.map((t) => (
            <TaskCard key={t.id} task={t} mode="done" />
          ))}
          {done.length === 0 && <Empty text="暂无完工任务" />}
        </div>
      </section>
    </div>
  );
}

type CardMode = "blocked" | "queue" | "active" | "reschedule" | "done";

function TaskCard({ task, mode, rank }: { task: DispatchTask; mode: CardMode; rank?: number }) {
  const { state, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const comp = state.components.find((c) => c.id === task.componentId);
  const top = comp ? topDefectLevel(comp) : null;
  const block = comp ? blockReason(comp) : "构件已删除";
  const issued = issuedByTask(state.ledger, task.id);
  const returned = returnedByTask(state.ledger, task.id);
  const outstanding = issued - returned;
  const station = state.workstations.find((w) => w.id === task.workstationId);

  return (
    <article className={`task-card ${mode}`}>
      <div className="task-head">
        <div>
          <h3>
            {rank !== undefined && <span className="rank">#{rank}</span>}
            {task.building} · {comp?.code ?? task.componentId}
            <em className="rev">测绘第{task.revision}版</em>
          </h3>
          <p className="meta">
            <StatusPill status={task.status} />
            {top && <span className="tag lvl">最高病害：{LEVEL_LABEL[top]}</span>}
            {station && <span className="tag">工位：{station.name}</span>}
            <span className="tag">申报 {formatTime(task.declaredAt)}</span>
            {issued > 0 && (
              <span className="tag">
                已领 {issued} / 已退 {returned} / 未退 {outstanding}
              </span>
            )}
          </p>
        </div>
        <div className="actions">
          {mode === "queue" && <IssueStartForm task={task} block={block} />}
          {mode === "active" && (
            <>
              <ReturnForm taskId={task.id} />
              <button
                className="primary"
                onClick={() => dispatch({ type: "COMPLETE", taskId: task.id })}
              >
                完工释放工位
              </button>
            </>
          )}
          {mode === "reschedule" && (
            <>
              <ReturnForm taskId={task.id} />
              <button
                className="primary"
                disabled={outstanding > 0}
                title={outstanding > 0 ? "已领旧料须先退料回补" : undefined}
                onClick={() => dispatch({ type: "REQUEUE", taskId: task.id })}
              >
                退料结清，重新排队
              </button>
            </>
          )}
          <button onClick={() => setOpen(!open)}>{open ? "收起记录" : "旧记录"}</button>
        </div>
      </div>
      {mode === "blocked" && block && <p className="block-note">⛔ {block}，只能待派工</p>}
      {task.rejectReason && mode === "queue" && (
        <p className="reject-note">最近拒绝原因：{task.rejectReason}</p>
      )}
      {open && (
        <ul className="history">
          {task.history.map((e, i) => (
            <li key={i}>
              <time>{formatTime(e.time)}</time>
              <span className={`ev ev-${e.type}`}>{e.text}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

/** 领料 + 开工一体表单：超库存 / 截面留量不足 / 木种不符均会被规则拒绝 */
function IssueStartForm({ task, block }: { task: DispatchTask; block: string | null }) {
  const { state, dispatch } = useStore();
  const [stockId, setStockId] = useState(state.stock[0]?.id ?? "");
  const [qty, setQty] = useState("1");
  const stock = state.stock.find((s) => s.id === stockId);

  return (
    <span className="inline-form issue-form">
      <select value={stockId} onChange={(e) => setStockId(e.target.value)}>
        {state.stock.map((s: StockItem) => (
          <option key={s.id} value={s.id}>
            {s.species} {sectionText(s.section)}（可用 {availableQty(s, state.ledger)}/{s.qty}）
          </option>
        ))}
      </select>
      <input
        value={qty}
        style={{ width: 64 }}
        onChange={(e) => setQty(e.target.value)}
        aria-label="领料数量"
      />
      根
      <button
        className="primary"
        disabled={block !== null}
        title={block ?? undefined}
        onClick={() => {
          const n = Number(qty);
          dispatch({ type: "START", taskId: task.id, stockItemId: stockId, qty: n });
        }}
      >
        领料开工
      </button>
      {stock && <StockHint stock={stock} />}
    </span>
  );
}

function StockHint({ stock }: { stock: StockItem }) {
  const { state } = useStore();
  const avail = availableQty(stock, state.ledger);
  return (
    <span className={`stock-hint ${avail <= 0 ? "bad" : "ok"}`}>
      台账 {stock.qty} · 净占用 {stock.qty - avail} · 可用 {avail}
    </span>
  );
}

function ReturnForm({ taskId }: { taskId: string }) {
  const { state, dispatch } = useStore();
  const issuedRows = useMemo(() => {
    const map = new Map<string, number>();
    state.ledger
      .filter((e) => e.taskId === taskId)
      .forEach((e) =>
        map.set(e.stockItemId, (map.get(e.stockItemId) ?? 0) + (e.kind === "issue" ? e.qty : -e.qty)),
      );
    return [...map.entries()].filter(([, n]) => n > 0);
  }, [state.ledger, taskId]);
  const [stockId, setStockId] = useState(issuedRows[0]?.[0] ?? "");
  const [qty, setQty] = useState("1");

  if (issuedRows.length === 0) return null;
  const current = issuedRows.find(([id]) => id === stockId) ?? issuedRows[0];

  return (
    <span className="inline-form return-form">
      <select value={current[0]} onChange={(e) => setStockId(e.target.value)}>
        {issuedRows.map(([id, n]) => {
          const s = state.stock.find((x) => x.id === id);
          return (
            <option key={id} value={id}>
              {s?.species} {s ? sectionText(s.section) : id}（未退 {n}）
            </option>
          );
        })}
      </select>
      <input value={qty} style={{ width: 64 }} onChange={(e) => setQty(e.target.value)} aria-label="退料数量" />
      根
      <button
        onClick={() => {
          const n = Number(qty);
          if (n > 0 && n <= current[1]) {
            dispatch({ type: "RETURN", taskId, stockItemId: current[0], qty: n });
            setQty("1");
          }
        }}
      >
        退料回补
      </button>
      <span className="muted">（未退 {returnableQty(state.ledger, taskId)} 根）</span>
    </span>
  );
}

export default DispatchBoard;
