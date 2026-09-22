// ===== 操作层共享展示件 =====
import type { DefectLevel, TaskStatus } from "../domain/types";
import { LEVEL_LABEL, STATUS_LABEL } from "../domain/rules";

export function formatTime(t: number): string {
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const STATUS_CLASS: Record<TaskStatus, string> = {
  pending: "pill pending",
  queued: "pill queued",
  active: "pill active",
  reschedule: "pill reschedule",
  done: "pill done",
};

export function StatusPill({ status }: { status: TaskStatus }) {
  return <span className={STATUS_CLASS[status]}>{STATUS_LABEL[status]}</span>;
}

const LEVEL_CLASS: Record<DefectLevel, string> = {
  severe: "level severe",
  medium: "level medium",
  light: "level light",
};

export function LevelBadge({ level, reviewed }: { level: DefectLevel; reviewed: boolean }) {
  return (
    <span className={LEVEL_CLASS[level]}>
      {LEVEL_LABEL[level]}
      {reviewed ? " · 已复核" : " · 未复核"}
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}
