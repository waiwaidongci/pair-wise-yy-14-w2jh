// ===== 操作层：测绘构件清单（录入、复核、含水率、重测、申报派工入口）=====
import { useMemo, useState } from "react";
import { useStore } from "../store/store";
import type { DefectLevel, JoineryType } from "../domain/types";
import {
  blockReason,
  findOpenTask,
  isBlocked,
  sectionText,
  STATUS_LABEL,
  LEVEL_WEIGHT,
} from "../domain/rules";
import { Empty, LevelBadge } from "./ui";

const JOINERIES: JoineryType[] = ["燕尾榫", "透榫", "半榫", "箍头榫"];
const LEVELS: DefectLevel[] = ["severe", "medium", "light"];
const LEVEL_NAME: Record<DefectLevel, string> = { severe: "严重", medium: "中等", light: "轻微" };

function ComponentInventory() {
  const { state, dispatch } = useStore();
  const [filter, setFilter] = useState<JoineryType | "all">("all");
  const [surveyId, setSurveyId] = useState<string | null>(null);

  const list = useMemo(
    () =>
      state.components
        .filter((c) => filter === "all" || c.joineryType === filter)
        .sort((a, b) => a.building.localeCompare(b.building, "zh") || a.code.localeCompare(b.code)),
    [state.components, filter],
  );

  return (
    <div className="stack">
      <section className="panel">
        <div className="heading">
          <div>
            <p>测绘录入</p>
            <h2>新增构件</h2>
          </div>
        </div>
        <NewComponentForm />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>构件清单</p>
            <h2>测绘构件（{state.components.length}）</h2>
          </div>
        </div>
        <div className="chips filter-chips">
          <button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>
            全部
          </button>
          {JOINERIES.map((j) => (
            <button key={j} className={filter === j ? "on" : ""} onClick={() => setFilter(j)}>
              {j}
            </button>
          ))}
        </div>

        <div className="cards">
          {list.length === 0 && <Empty text="当前筛选下暂无构件" />}
          {list.map((c) => {
            const block = blockReason(c);
            const openTask = findOpenTask(state.tasks, c.building, c.id);
            const openDefects = c.defects.filter((d) => !d.reviewed);
            const topOpen = openDefects.length
              ? openDefects.reduce(
                  (acc, d) => (LEVEL_WEIGHT[d.level] > LEVEL_WEIGHT[acc.level] ? d : acc),
                )
              : null;
            const topReviewed = c.defects
              .filter((d) => d.reviewed)
              .reduce(
                (acc: (typeof c.defects)[number] | null, d) =>
                  !acc || LEVEL_WEIGHT[d.level] > LEVEL_WEIGHT[acc.level] ? d : acc,
                null,
              );
            const showDefect = topOpen ?? topReviewed;
            return (
              <article key={c.id} className={`comp-card ${block ? "blocked" : ""}`}>
                <div className="comp-head">
                  <div>
                    <h3>
                      {c.building} · {c.code}
                      {c.revision > 1 && <em className="rev">第{c.revision}版</em>}
                    </h3>
                    <p className="meta">
                      {c.woodSpecies} · {c.joineryType} · 净截面 {sectionText(c.section)} · 含水率{" "}
                      {c.moisture === null ? <b className="warn">缺失</b> : `${c.moisture}%`}
                    </p>
                  </div>
                  <div className="comp-tags">
                    {showDefect && (
                      <LevelBadge level={showDefect.level} reviewed={showDefect.reviewed} />
                    )}
                    {block ? (
                      <span className="tag warn-tag">⛔ {block}</span>
                    ) : (
                      <span className="tag ok-tag">可派工</span>
                    )}
                    {openTask && (
                      <span className="tag task-tag">任务：{STATUS_LABEL[openTask.status]}</span>
                    )}
                  </div>
                </div>

                <div className="defect-list">
                  {c.defects.length === 0 && <span className="muted">无病害记录</span>}
                  {c.defects.map((d) => (
                    <div key={d.id} className="defect-row">
                      <LevelBadge level={d.level} reviewed={d.reviewed} />
                      <span>
                        {d.location}：{d.detail}
                      </span>
                      {!d.reviewed && (
                        <button
                          onClick={() =>
                            dispatch({ type: "REVIEW_DEFECT", componentId: c.id, defectId: d.id })
                          }
                        >
                          复核通过
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="suggest">修缮建议：{c.suggestion || "—"}</p>

                <div className="actions">
                  {c.moisture === null && (
                    <MoistureInput
                      onSubmit={(v) =>
                        dispatch({ type: "SET_MOISTURE", componentId: c.id, moisture: v })
                      }
                    />
                  )}
                  {!openTask && (
                    <button
                      className="primary"
                      onClick={() => dispatch({ type: "DECLARE", componentId: c.id })}
                    >
                      申报派工{isBlocked(c) ? "（只能待派工）" : ""}
                    </button>
                  )}
                  {(!openTask || openTask.status === "active" || openTask.status === "reschedule") && (
                    <button onClick={() => setSurveyId(surveyId === c.id ? null : c.id)}>
                      {surveyId === c.id ? "收起重测" : "重测修订"}
                    </button>
                  )}
                </div>

                {surveyId === c.id && (
                  <ResurveyForm
                    onSubmit={(patch) => {
                      dispatch({ type: "RESURVEY", componentId: c.id, patch });
                      setSurveyId(null);
                    }}
                  />
                )}
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function MoistureInput({ onSubmit }: { onSubmit: (v: number) => void }) {
  const [v, setV] = useState("");
  return (
    <span className="inline-form">
      补测含水率
      <input
        value={v}
        placeholder="如 12.5"
        onChange={(e) => setV(e.target.value)}
        style={{ width: 90 }}
      />
      %
      <button
        onClick={() => {
          const n = Number(v);
          if (n > 0) {
            onSubmit(n);
            setV("");
          }
        }}
      >
        提交
      </button>
    </span>
  );
}

function ResurveyForm({
  onSubmit,
}: {
  onSubmit: (patch: {
    moisture: number;
    section: { width: number; height: number };
    newDefect: { location: string; detail: string; level: DefectLevel } | null;
  }) => void;
}) {
  const [moisture, setMoisture] = useState("12.0");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [loc, setLoc] = useState("");
  const [detail, setDetail] = useState("");
  const [level, setLevel] = useState<DefectLevel>("medium");
  const [err, setErr] = useState("");

  return (
    <div className="subform">
      <p className="subform-title">重测数据（提交后已开工任务转为待重排并释放工位，旧记录保留）</p>
      <div className="field-grid">
        <label>
          <span>重测含水率 %</span>
          <input value={moisture} onChange={(e) => setMoisture(e.target.value)} />
        </label>
        <label>
          <span>新净截面宽 mm</span>
          <input value={w} placeholder="如 180" onChange={(e) => setW(e.target.value)} />
        </label>
        <label>
          <span>新净截面高 mm</span>
          <input value={h} placeholder="如 240" onChange={(e) => setH(e.target.value)} />
        </label>
        <label>
          <span>新发现病害位置（可空）</span>
          <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="如 西端榫肩" />
        </label>
        <label>
          <span>病害描述</span>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} />
        </label>
        <label>
          <span>病害等级</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as DefectLevel)}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {LEVEL_NAME[l]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {err && <p className="form-error">{err}</p>}
      <button
        className="primary"
        onClick={() => {
          const nw = Number(w);
          const nh = Number(h);
          const nm = Number(moisture);
          if (!(nw > 0) || !(nh > 0) || !(nm > 0)) {
            setErr("截面与含水率均须为正数");
            return;
          }
          onSubmit({
            moisture: nm,
            section: { width: nw, height: nh },
            newDefect: loc.trim()
              ? { location: loc.trim(), detail: detail.trim() || "重测新发现病害", level }
              : null,
          });
        }}
      >
        提交重测
      </button>
    </div>
  );
}

function NewComponentForm() {
  const { state, dispatch } = useStore();
  const [building, setBuilding] = useState("");
  const [code, setCode] = useState("");
  const [species, setSpecies] = useState("");
  const [joinery, setJoinery] = useState<JoineryType>("透榫");
  const [w, setW] = useState("");
  const [h, setH] = useState("");
  const [moisture, setMoisture] = useState("");
  const [loc, setLoc] = useState("");
  const [detail, setDetail] = useState("");
  const [level, setLevel] = useState<DefectLevel>("medium");
  const [suggestion, setSuggestion] = useState("");
  const [msg, setMsg] = useState("");

  return (
    <div className="field-grid">
      <label>
        <span>建筑名称 *</span>
        <input value={building} onChange={(e) => setBuilding(e.target.value)} placeholder="如 大雄宝殿" />
      </label>
      <label>
        <span>构件编号 *</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="如 梁架A-03" />
      </label>
      <label>
        <span>木材种类 *</span>
        <input value={species} onChange={(e) => setSpecies(e.target.value)} placeholder="如 楠木" />
      </label>
      <label>
        <span>榫卯类型</span>
        <select value={joinery} onChange={(e) => setJoinery(e.target.value as JoineryType)}>
          {JOINERIES.map((j) => (
            <option key={j}>{j}</option>
          ))}
        </select>
      </label>
      <label>
        <span>截面宽 mm *</span>
        <input value={w} onChange={(e) => setW(e.target.value)} placeholder="180" />
      </label>
      <label>
        <span>截面高 mm *</span>
        <input value={h} onChange={(e) => setH(e.target.value)} placeholder="240" />
      </label>
      <label>
        <span>含水率 %（空=缺失，将阻塞派工）</span>
        <input value={moisture} onChange={(e) => setMoisture(e.target.value)} placeholder="如 12.4" />
      </label>
      <label>
        <span>病害位置（空=无病害，新病害默认未复核）</span>
        <input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="如 端部" />
      </label>
      <label>
        <span>变形/病害情况</span>
        <input value={detail} onChange={(e) => setDetail(e.target.value)} />
      </label>
      <label>
        <span>病害等级</span>
        <select value={level} onChange={(e) => setLevel(e.target.value as DefectLevel)}>
          {LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_NAME[l]}
            </option>
          ))}
        </select>
      </label>
      <label className="wide">
        <span>修缮建议</span>
        <input value={suggestion} onChange={(e) => setSuggestion(e.target.value)} />
      </label>
      <div className="wide form-foot">
        {msg && <span className="form-error">{msg}</span>}
        <button
          className="primary"
          onClick={() => {
            if (!building.trim() || !code.trim() || !species.trim() || !(Number(w) > 0) || !(Number(h) > 0)) {
              setMsg("请填写建筑、编号、木种与有效截面");
              return;
            }
            const dup = state.components.some(
              (c) => c.building === building.trim() && c.code === code.trim(),
            );
            if (dup) {
              setMsg("同一建筑下该构件编号已存在");
              return;
            }
            dispatch({
              type: "ADD_COMPONENT",
              input: {
                building: building.trim(),
                code: code.trim(),
                woodSpecies: species.trim(),
                joineryType: joinery,
                section: { width: Number(w), height: Number(h) },
                moisture: moisture.trim() === "" ? null : Number(moisture),
                defect: loc.trim()
                  ? { location: loc.trim(), detail: detail.trim() || "待描述", level }
                  : null,
                suggestion: suggestion.trim(),
              },
            });
            setBuilding("");
            setCode("");
            setSpecies("");
            setW("");
            setH("");
            setMoisture("");
            setLoc("");
            setDetail("");
            setSuggestion("");
            setMsg("已保存构件记录");
          }}
        >
          保存构件
        </button>
      </div>
    </div>
  );
}

export default ComponentInventory;
