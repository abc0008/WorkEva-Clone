"use client";

import { useCallback, useEffect, useState } from "react";
import type { AppSnapshot } from "@/lib/types";
import { api } from "@/lib/client";
import { Shell } from "./Shell";
import { ReviewPanel } from "./ReviewPanel";
import { DocumentsPanel } from "./DocumentsPanel";
import { DashboardPanel } from "./DashboardPanel";
import { WorkflowPanel } from "./WorkflowPanel";
import { AdminPanel } from "./AdminPanel";
import { ErrorNotice, LoadingState } from "./ui";

export default function WorkEvaApp({ view = "my-reviews" }: { view?: string }) {
  const [activeView, setActiveView] = useState(
    view === "review" ? "my-reviews" : view,
  );
  const [snapshot, setSnapshot] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const refresh = useCallback(async () => {
    try {
      setError("");
      const data = await api<AppSnapshot>("/api/state");
      setSnapshot(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load WorkEva.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    setActiveView(view);
  }, [view]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);
  const persona = async (id: string) => {
    if (
      (window as unknown as { workevaHasUnsaved?: boolean })
        .workevaHasUnsaved &&
      !window.confirm("You have unsaved changes. Switch user?")
    )
      return;
    if (typeof window !== "undefined") {
      localStorage.setItem("workeva-user", id);
      document.cookie = `workeva-user=${encodeURIComponent(id)}; path=/; max-age=31536000`;
    }
    await refresh();
  };
  if (!snapshot)
    return (
      <div className="we-loading">
        <div>
          <LoadingState />
          {error && (
            <ErrorNotice message={error} onRetry={() => void refresh()} />
          )}
        </div>
      </div>
    );
  const panel =
    activeView === "documents" ? (
      <DocumentsPanel
        snapshot={snapshot}
        onRefresh={refresh}
        setToast={setToast}
      />
    ) : activeView === "dashboard" || activeView === "review-dashboard" ? (
      <DashboardPanel
        snapshot={snapshot}
        onRefresh={refresh}
        setToast={setToast}
      />
    ) : activeView === "workflow-runs" || activeView === "runs" ? (
      <WorkflowPanel
        mode="runs"
        snapshot={snapshot}
        onRefresh={refresh}
        setToast={setToast}
      />
    ) : activeView === "workflow-designer" || activeView === "designer" ? (
      <WorkflowPanel
        mode="designer"
        snapshot={snapshot}
        onRefresh={refresh}
        setToast={setToast}
      />
    ) : activeView === "my-tasks" || activeView === "tasks" ? (
      <WorkflowPanel
        mode="tasks"
        snapshot={snapshot}
        onRefresh={refresh}
        setToast={setToast}
      />
    ) : activeView === "administration" || activeView === "admin" ? (
      <AdminPanel snapshot={snapshot} />
    ) : (
      <ReviewPanel
        snapshot={snapshot}
        onRefresh={refresh}
        setToast={setToast}
      />
    );
  return (
    <Shell
      view={activeView}
      setView={setActiveView}
      snapshot={snapshot}
      onPersona={persona}
    >
      {error && (
        <div className="we-content" style={{ paddingBottom: 0 }}>
          <ErrorNotice message={error} onRetry={() => void refresh()} />
        </div>
      )}
      {panel}
      {toast && <div className="we-toast">{toast}</div>}
    </Shell>
  );
}
