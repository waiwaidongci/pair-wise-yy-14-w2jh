import { useState } from "react";
import "./styles.css";
import { StoreProvider, useStore } from "./store";
import { ComponentsView } from "./components/ComponentsView";
import { DispatchView } from "./components/DispatchView";
import { InventoryView } from "./components/InventoryView";
import { consistencyReport } from "./rules";

type Tab = "components" | "dispatch" | "inventory";

const TABS: { key: Tab; label: string }[] = [
  { key: "components", label: "测绘构件清单" },
  { key: "dispatch", label: "修缮派工 · 木料领退台" },
  { key: "inventory", label: "库存统计 · 一致性" },
];

function Metrics() {
  const { state } = useStore();
  const defectCount = state.components.filter((c) => c.defectLevel).length;
  const openCount = state.tasks.filter(
    (t) => t.status === "PENDING" || t.status === "QUEUED" || t.status === "ACTIVE"
  ).length;
  const problems = consistencyReport(state).length;
  const metrics: [string, string, boolean][] = [
    ["构件数量", String(state.components.length), false],
    ["病害构件", String(defectCount), false],
    ["未完工任务", String(openCount), false],
    ["台账差异", problems === 0 ? "0 一致" : String(problems), problems > 0],
  ];
  return (
    <section className="metrics">
      {metrics.map(([label, value, danger]) => (
        <article key={label}>
          <small>{label}</small>
          <strong className={danger ? "text-danger" : ""}>{value}</strong>
        </article>
      ))}
    </section>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("components");
  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62013 · 木结构榫卯构件测绘 · 修缮派工扩展</p>
        <h1>测绘 · 派工 · 木料领退</h1>
        <span>
          业务规则、存储与操作分层承载：未复核病害或含水率缺失只能待派工；同一建筑同一构件唯一未完工任务；
          工位冲突按病害等级与申报时间排队；领料受可用库存与截面留量约束，退料按实退回补，重测转待重排并保留旧记录。
        </span>
      </section>

      <Metrics />

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "tab-on" : ""} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "components" && <ComponentsView />}
      {tab === "dispatch" && <DispatchView />}
      {tab === "inventory" && <InventoryView />}
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
