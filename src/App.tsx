import { useMemo, useState } from "react";
import "./styles.css";
import { StoreProvider, useStore } from "./store/store";
import ComponentInventory from "./components/ComponentInventory";
import DispatchBoard from "./components/DispatchBoard";
import MaterialDesk from "./components/MaterialDesk";
import { blockReason, availableQty, occupiedByStock } from "./domain/rules";

type Tab = "inventory" | "dispatch" | "material";

const TABS: { key: Tab; label: string }[] = [
  { key: "inventory", label: "测绘构件清单" },
  { key: "dispatch", label: "修缮派工队列" },
  { key: "material", label: "木料领退台" },
];

function Metrics() {
  const { state } = useStore();
  const blocked = state.components.filter((c) => blockReason(c)).length;
  const active = state.tasks.filter((t) => t.status === "active").length;
  const reschedule = state.tasks.filter((t) => t.status === "reschedule").length;
  const avail = state.stock.reduce((s, i) => s + availableQty(i, state.ledger), 0);
  const occupied = state.stock.reduce((s, i) => s + occupiedByStock(state.ledger, i.id), 0);

  const items: [string, string][] = [
    ["测绘构件", String(state.components.length)],
    ["阻塞待派工", String(blocked)],
    ["工位占用 / 待重排", `${active} / ${reschedule}`],
    ["木料可用（占用）", `${avail}（${occupied}）`],
  ];
  return (
    <section className="metrics">
      {items.map(([label, value]) => (
        <article key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function Workbench() {
  const { state, reset } = useStore();
  const [tab, setTab] = useState<Tab>("dispatch");

  const badge = useMemo<Record<Tab, number>>(
    () => ({
      inventory: state.components.length,
      dispatch: state.tasks.filter((t) => t.status !== "done").length,
      material: state.ledger.length,
    }),
    [state],
  );

  return (
    <>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
            <span className="badge">{badge[t.key]}</span>
          </button>
        ))}
        <button className="reset" onClick={() => confirm("恢复为演示数据？本地改动将清除。") && reset()}>
          重置演示数据
        </button>
      </nav>

      {tab === "inventory" && <ComponentInventory />}
      {tab === "dispatch" && <DispatchBoard />}
      {tab === "material" && <MaterialDesk />}

      <footer className="consistency-foot">
        构件清单 {state.components.length} · 未完工任务{" "}
        {state.tasks.filter((t) => t.status !== "done").length} · 领退流水 {state.ledger.length} ·
        可用木料 {state.stock.reduce((s, i) => s + availableQty(i, state.ledger), 0)} 根 —— 数据同源，刷新后库存统计一致
      </footer>
    </>
  );
}

function App() {
  return (
    <StoreProvider>
      <main className="app">
        <section className="hero">
          <p>hxyfront-62013 · 源提示词8 · Port 62013</p>
          <h1>木结构榫卯构件测绘 · 修缮派工与木料领退</h1>
          <span>
            业务规则（派工准入、工位排队、领退校验）、存储（任务/库存/台账单一数据源、本地持久化）与操作（清单/队列/领退台三区分载）分层承载。
          </span>
        </section>
        <Metrics />
        <Workbench />
      </main>
    </StoreProvider>
  );
}

export default App;
