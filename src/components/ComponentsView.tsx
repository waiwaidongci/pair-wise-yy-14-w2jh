import { useMemo, useState } from "react";
import { useStore, type ComponentDraft } from "../store";
import { checkDispatchable, openTaskFor } from "../rules";
import type { DefectLevel, ReviewStatus } from "../types";
import { LevelBadge, Notice, StatusBadge } from "./Shared";

// 测绘构件清单 + 新增/复核操作。任务只读引用，任务操作在派工页完成。

const JOINTS = ["燕尾榫", "透榫", "半榫", "箍头榫", "管脚榫"];

const emptyDraft: ComponentDraft = {
  building: "",
  code: "",
  species: "",
  joint: "燕尾榫",
  sectionText: "",
  sectionCm: null,
  defectLoc: "",
  deformation: "",
  suggestion: "",
  moisture: null,
  defectLevel: "",
  reviewed: "none",
};

export function ComponentsView() {
  const { state, addComponent, updateComponent, declareTask } = useStore();
  const [draft, setDraft] = useState<ComponentDraft>(emptyDraft);
  const [jointFilter, setJointFilter] = useState<string>("全部");
  const [buildingFilter, setBuildingFilter] = useState<string>("全部");
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const buildings = useMemo(
    () => ["全部", ...new Set(state.components.map((c) => c.building))],
    [state.components]
  );

  const list = state.components.filter(
    (c) =>
      (jointFilter === "全部" || c.joint === jointFilter) &&
      (buildingFilter === "全部" || c.building === buildingFilter)
  );

  const set = <K extends keyof ComponentDraft>(key: K, value: ComponentDraft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const submit = () => {
    const result = addComponent(draft, false);
    if (result.ok) {
      setDraft(emptyDraft);
      setMessage({ kind: "ok", text: "构件已入测绘清单" });
    } else {
      setMessage({ kind: "error", text: result.error });
    }
  };

  return (
    <div className="view-grid">
      <section className="panel">
        <div className="heading">
          <div>
            <p>测绘录入</p>
            <h2>新增构件</h2>
          </div>
        </div>
        <div className="field-grid">
          <label>
            <span>建筑名称 *</span>
            <input value={draft.building} onChange={(e) => set("building", e.target.value)} placeholder="如 大雄宝殿" />
          </label>
          <label>
            <span>构件编号 *</span>
            <input value={draft.code} onChange={(e) => set("code", e.target.value)} placeholder="如 梁架A-03" />
          </label>
          <label>
            <span>木材种类</span>
            <input value={draft.species} onChange={(e) => set("species", e.target.value)} placeholder="楠木 / 松木 / 榆木" />
          </label>
          <label>
            <span>榫卯类型</span>
            <select value={draft.joint} onChange={(e) => set("joint", e.target.value)}>
              {JOINTS.map((j) => (
                <option key={j}>{j}</option>
              ))}
            </select>
          </label>
          <label>
            <span>截面尺寸</span>
            <input value={draft.sectionText} onChange={(e) => set("sectionText", e.target.value)} placeholder="180x240mm" />
          </label>
          <label>
            <span>含水率(%)，缺失留空</span>
            <input
              type="number"
              step="0.1"
              value={draft.moisture ?? ""}
              onChange={(e) => set("moisture", e.target.value === "" ? null : Number(e.target.value))}
              placeholder="如 13.5"
            />
          </label>
          <label>
            <span>病害等级</span>
            <select
              value={draft.defectLevel}
              onChange={(e) => set("defectLevel", e.target.value as DefectLevel)}
            >
              <option value="">无病害</option>
              <option value="轻微">轻微</option>
              <option value="中等">中等</option>
              <option value="严重">严重</option>
            </select>
          </label>
          <label>
            <span>病害复核状态</span>
            <select
              value={draft.reviewed}
              onChange={(e) => set("reviewed", e.target.value as ReviewStatus)}
            >
              <option value="none">无病害</option>
              <option value="unreviewed">未复核</option>
              <option value="reviewed">已复核</option>
            </select>
          </label>
          <label className="wide">
            <span>病害位置</span>
            <input value={draft.defectLoc} onChange={(e) => set("defectLoc", e.target.value)} placeholder="如 东端榫头" />
          </label>
          <label className="wide">
            <span>变形情况</span>
            <input value={draft.deformation} onChange={(e) => set("deformation", e.target.value)} placeholder="如 端部开裂" />
          </label>
          <label className="wide">
            <span>修缮建议</span>
            <input value={draft.suggestion} onChange={(e) => set("suggestion", e.target.value)} placeholder="如 剔补加铁箍" />
          </label>
        </div>
        <div className="form-actions">
          <button className="primary" onClick={submit}>保存构件</button>
        </div>
        {message && (
          <Notice kind={message.kind === "ok" ? "ok" : "error"}>{message.text}</Notice>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>构件清单</p>
            <h2>测绘构件（{list.length}）</h2>
          </div>
        </div>
        <div className="filter-row">
          <select value={buildingFilter} onChange={(e) => setBuildingFilter(e.target.value)}>
            {buildings.map((b) => (
              <option key={b}>{b}</option>
            ))}
          </select>
          <div className="chips">
            {["全部", ...JOINTS].map((j) => (
              <button
                key={j}
                className={jointFilter === j ? "chip-on" : ""}
                onClick={() => setJointFilter(j)}
              >
                {j}
              </button>
            ))}
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>建筑 / 构件</th>
                <th>材质 / 榫卯</th>
                <th>含水率</th>
                <th>病害</th>
                <th>复核</th>
                <th>派工状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((c) => {
                const gate = checkDispatchable(c);
                const task = openTaskFor(state, c);
                return (
                  <tr key={c.id}>
                    <td>
                      <b>{c.code}</b>
                      <small>{c.building} · {c.sectionText}</small>
                      <small className="dim">{c.deformation || "—"}</small>
                    </td>
                    <td>
                      <small>{c.species}</small>
                      <small>{c.joint}</small>
                    </td>
                    <td>{c.moisture === null ? <span className="text-danger">缺失</span> : `${c.moisture}%`}</td>
                    <td>
                      <LevelBadge level={c.defectLevel} />
                      {c.defectLoc && <small className="dim">{c.defectLoc}</small>}
                    </td>
                    <td>
                      {c.defectLevel === "" ? (
                        <span className="dim">—</span>
                      ) : c.reviewed === "reviewed" ? (
                        <button
                          className="link-btn"
                          onClick={() => updateComponent(c.id, { reviewed: "unreviewed" })}
                          title="点击撤回复核"
                        >
                          已复核
                        </button>
                      ) : (
                        <button
                          className="link-btn text-danger"
                          onClick={() => updateComponent(c.id, { reviewed: "reviewed" })}
                          title="点击标记复核"
                        >
                          未复核
                        </button>
                      )}
                    </td>
                    <td>
                      {task ? (
                        <span>
                          <StatusBadge status={task.status} />
                          <small className="dim">{task.id}</small>
                        </span>
                      ) : (
                        <span className="dim">未申报</span>
                      )}
                      {!gate.ok && <small className="text-danger">{gate.error}</small>}
                    </td>
                    <td>
                      <div className="row-actions">
                        {c.moisture === null && (
                          <button
                            onClick={() => {
                              const v = Number(prompt("补测含水率(%)：", "13.5"));
                              if (!Number.isNaN(v) && v > 0) updateComponent(c.id, { moisture: v });
                            }}
                          >
                            补测含水率
                          </button>
                        )}
                        <button
                          disabled={!!task}
                          onClick={() => {
                            const r = declareTask(c.id);
                            if (!r.ok) alert(r.error);
                          }}
                        >
                          申报派工
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <Notice kind="info">
          规则：存在<strong>未复核病害</strong>或<strong>含水率缺失</strong>的构件只能待派工，不得占用工位；
          同一建筑同一构件仅保留一个未完工任务。
        </Notice>
      </section>
    </div>
  );
}
