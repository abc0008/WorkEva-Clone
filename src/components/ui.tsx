"use client";

import type { ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  Clock3,
  Loader2,
} from "lucide-react";

export function Status({ value }: { value?: string }) {
  const normalized = (value || "PENDING").toLowerCase();
  const cls =
    normalized.includes("sign") ||
    normalized.includes("complete") ||
    normalized.includes("publish") ||
    normalized === "okay"
      ? "ok"
      : normalized.includes("exception") ||
          normalized.includes("overdue") ||
          normalized.includes("draft") ||
          normalized.includes("needs")
        ? "warning"
        : normalized.includes("reject") || normalized.includes("cancel")
          ? "danger"
          : normalized.includes("progress")
            ? "blue"
            : "neutral";
  return (
    <span className={`we-status ${cls}`}>
      {value?.replaceAll("_", " ") || "Pending"}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  detail,
  action,
}: {
  icon?: ReactNode;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="we-empty">
      {icon || <CircleDashed size={27} />}
      <strong>{title}</strong>
      {detail && <span>{detail}</span>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="we-loading">
      <Loader2 className="we-spinner" size={24} />
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="we-error">
      <AlertCircle size={17} /> <span style={{ flex: 1 }}>{message}</span>
      {onRetry && (
        <button className="we-button small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function fmtDate(value?: string, includeTime = false) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(includeTime ? { hour: "numeric", minute: "2-digit" } : {}),
  }).format(date);
}

export function initials(name?: string) {
  return (name || "User")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function responseLabel(answer?: string) {
  return answer === "NEEDS_EXPLANATION"
    ? "Needs explanation"
    : answer === "NOT_APPLICABLE"
      ? "Not applicable"
      : answer === "OKAY"
        ? "Okay"
        : "Not answered";
}

export function DueLabel({ dueAt }: { dueAt?: string }) {
  const late = !!dueAt && new Date(dueAt).getTime() < Date.now();
  return (
    <span
      style={{
        color: late ? "#a72219" : undefined,
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
      }}
    >
      {late ? <Clock3 size={13} /> : <CheckCircle2 size={13} />}
      {late ? `Overdue · ${fmtDate(dueAt)}` : `Due ${fmtDate(dueAt)}`}
    </span>
  );
}
