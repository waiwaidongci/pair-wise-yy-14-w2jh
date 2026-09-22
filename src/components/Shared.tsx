import React from "react";
import type { DefectLevel, TaskStatus } from "../types";
import { STATUS_LABEL } from "../rules";

// 共享展示组件：状态徽标、等级徽标、提示条等纯 UI。

export function LevelBadge({ level }: { level: DefectLevel }) {
  if (!level) return <span className="badge badge-muted">无病害</span>;
  const cls = level === "严重" ? "badge-danger" : level === "中等" ? "badge-warn" : "badge-info";
  return <span className={`badge ${cls}`}>{level}</span>;
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const map: Record<TaskStatus, string> = {
    PENDING: "status-pending",
    QUEUED: "status-queued",
    ACTIVE: "status-active",
    DONE: "status-done",
    REWORK: "status-rework",
  };
  return <span className={`badge ${map[status]}`}>{STATUS_LABEL[status]}</span>;
}

export function Notice({ kind, children }: { kind: "ok" | "error" | "info"; children: React.ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function fmtQty(n: number): string {
  return `${n.toFixed(3)}m³`;
}

export function fmtTime(t?: number): string {
  if (!t) return "—";
  const d = new Date(t);
  const pad = (x: number) => String(x).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
