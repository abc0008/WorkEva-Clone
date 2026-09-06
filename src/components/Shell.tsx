"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  BarChart3,
  CheckSquare,
  FileText,
  GitBranch,
  Menu,
  Play,
  Settings,
  Upload,
  X,
} from "lucide-react";
import type { AppSnapshot, Principal } from "@/lib/types";
import { initials } from "./ui";

type Props = {
  view: string;
  setView: (view: string) => void;
  snapshot: AppSnapshot;
  onPersona: (id: string) => void;
  children: React.ReactNode;
};

const nav = [
  { id: "my-reviews", label: "My reviews", icon: FileText },
  { id: "documents", label: "Documents", icon: Upload },
  { id: "dashboard", label: "Review dashboard", icon: BarChart3 },
  { id: "my-tasks", label: "My tasks", icon: CheckSquare },
  { id: "workflow-runs", label: "Workflow runs", icon: Play },
  { id: "workflow-designer", label: "Workflow designer", icon: GitBranch },
  { id: "administration", label: "Administration", icon: Settings },
];

function canSee(item: (typeof nav)[number], principal: Principal) {
  if (item.id === "administration") return principal.roles.includes("admin");
  if (item.id === "documents")
    return principal.roles.some((r) =>
      ["publisher", "admin", "manager"].includes(r),
    );
  if (item.id === "workflow-designer")
    return principal.roles.some((r) => ["designer", "admin"].includes(r));
  return true;
}

export function Shell({ view, setView, snapshot, onPersona, children }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const principal = snapshot.principal;
  const displayPeriod = snapshot.packages[0]?.period
    ? `${snapshot.packages[0].period} close`
    : "September 2026 close";
  const reviewsPending = snapshot.assignments.filter(
    (a) => a.reviewerId === principal.id && a.status !== "SIGNED",
  ).length;
  return (
    <div className="we-shell">
      <aside className={`we-sidebar ${open ? "open" : ""}`}>
        <div className="we-brand">
          Work<em>Eva</em>
        </div>
        <nav className="we-nav">
          {nav.map((item) => {
            if (!canSee(item, principal)) return null;
            const Icon = item.icon;
            const active =
              (
                {
                  runs: "workflow-runs",
                  designer: "workflow-designer",
                  tasks: "my-tasks",
                  admin: "administration",
                } as Record<string, string>
              )[view] === item.id ||
              view === item.id ||
              (view === "review" && item.id === "my-reviews") ||
              (view === "reviews" && item.id === "my-reviews");
            return (
              <button
                type="button"
                key={item.id}
                className={`we-nav-item ${active ? "active" : ""}`}
                onClick={() => {
                  const hasUnsaved =
                    typeof window !== "undefined" &&
                    (window as unknown as { workevaHasUnsaved?: boolean })
                      .workevaHasUnsaved;
                  if (
                    hasUnsaved &&
                    !window.confirm(
                      "You have unsaved responses. Leave this review?",
                    )
                  )
                    return;
                  router.push(
                    `/${item.id === "my-reviews" ? "reviews" : item.id === "workflow-runs" ? "runs" : item.id === "workflow-designer" ? "designer" : item.id === "my-tasks" ? "tasks" : item.id === "administration" ? "admin" : item.id}`,
                  );
                  setOpen(false);
                }}
              >
                <Icon />
                <span className="we-nav-label">{item.label}</span>
                {item.id === "my-reviews" && reviewsPending > 0 && (
                  <span className="we-nav-badge">{reviewsPending}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="we-sidebar-footer">
          <strong>Review workspace</strong>Controlled finance operations
        </div>
      </aside>
      <main className="we-main">
        <header className="we-topbar">
          <button
            type="button"
            className="we-mobile-menu"
            onClick={() => setOpen((v) => !v)}
            aria-label="Open navigation"
          >
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="we-topbar-period">{displayPeriod}</div>
          <div className="we-topbar-sep" />
          <div className="we-topbar-workspace">Controlled workspace</div>
          {snapshot.localMode && (
            <span className="we-local-badge">Synthetic local demo</span>
          )}
          <div className="we-topbar-sep" />
          <div className="we-profile">
            <div className="we-avatar">{initials(principal.name)}</div>
            <div>
              <div className="we-profile-name">{principal.name}</div>
              <div className="we-profile-role">
                {principal.roles[0] || "Finance"}
              </div>
            </div>
          </div>
          {snapshot.localMode && (
            <select
              aria-label="Development persona"
              className="we-select"
              style={{ width: 126, height: 31, fontSize: 11 }}
              value={principal.id}
              onChange={(e) => onPersona(e.target.value)}
            >
              {snapshot.users
                .filter((u) => u.active)
                .map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
            </select>
          )}
        </header>
        {children}
      </main>
    </div>
  );
}
