import { useEffect, type CSSProperties } from "react";
import { Conversation } from "./features/conversation/Conversation";
import { ProjectView } from "./features/project/ProjectView";
import { RuntimesView } from "./features/harness/RuntimesView";
import { ApprovalsView, HistoryView, SkillsView } from "./features/library/LibraryViews";
import { UsageView } from "./features/library/UsageView";
import { SettingsView } from "./features/settings/SettingsView";
import { ConfirmDialog } from "./features/shell/ConfirmDialog";
import { ContentSearch } from "./features/shell/ContentSearch";
import { FilePicker } from "./features/shell/FilePicker";
import { Inspector, INSPECTOR_REVISION } from "./features/shell/Inspector";
import { Palette } from "./features/shell/Palette";
import { Sidebar } from "./features/shell/Sidebar";
import { Titlebar } from "./features/shell/Titlebar";
import { AboutModal } from "./features/settings/AboutModal";
import { ViewErrorBoundary } from "./features/shell/ErrorBoundary";
import { useSidebarSwipe } from "./lib/useSidebarSwipe";
import { WorkspaceProvider, useWorkspace } from "./lib/workspace";

function Shell() {
  const {
    view,
    inspectorOpen,
    ready,
    startupError,
    refresh,
    sidebarCollapsed,
    sidebarWidth,
    setSidebarCollapsed,
    aboutOpen,
    setAboutOpen,
  } = useWorkspace();
  useSidebarSwipe(sidebarCollapsed, setSidebarCollapsed);
  const style = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;

  /*
   * The window is hidden until this fires. Waiting for the first paint alone
   * revealed the workspace before it had any projects or conversations in it,
   * so the app appeared with an empty sidebar and a blank thread and filled in
   * afterwards. Two frames after the first render that has data: React has
   * committed and the browser has drawn it.
   */
  useEffect(() => {
    if (!ready) return;
    let paintedFrame: number | undefined;
    const frame = requestAnimationFrame(() => {
      paintedFrame = requestAnimationFrame(() => void window.capsule.rendererReady?.());
    });
    return () => {
      cancelAnimationFrame(frame);
      if (paintedFrame !== undefined) cancelAnimationFrame(paintedFrame);
    };
  }, [ready]);
  if (!ready) {
    return (
      <main className="panel">
        <div className="panel-inner">
          <h1>{startupError ? "Could not open your workspace" : "Opening your workspace…"}</h1>
          {startupError ? <>
            <p role="alert">{startupError}</p>
            <p className="muted">Your saved projects and conversations have not been reset.</p>
            <button type="button" onClick={() => void refresh()}>Retry</button>
          </> : <p className="muted" role="status">Loading saved projects and conversations.</p>}
        </div>
      </main>
    );
  }
  return (
    <div
      className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={style}
    >
      <Sidebar />
      <div className="sidebar-swipe-edge" aria-hidden />
      <div className="workspace">
        <Titlebar />
        <div className="workspace-body">
          <div className="conversation-host" hidden={view !== "chat"}>
            <ViewErrorBoundary label="Conversation"><Conversation /></ViewErrorBoundary>
          </div>
          <ViewErrorBoundary key={view} label="This view">
            {view === "project" && <ProjectView />}
            {view === "runtimes" && <RuntimesView />}
            {view === "skills" && <SkillsView />}
            {view === "usage" && <UsageView />}
            {view === "history" && <HistoryView />}
            {view === "approvals" && <ApprovalsView />}
            {view === "settings" && <SettingsView />}
          </ViewErrorBoundary>
          {view === "chat" && inspectorOpen && (
            <ViewErrorBoundary label="Inspector" resetKey={INSPECTOR_REVISION}>
              <Inspector />
            </ViewErrorBoundary>
          )}
        </div>
      </div>
      <ViewErrorBoundary compact label="Command palette">
        <Palette />
      </ViewErrorBoundary>
      <ViewErrorBoundary compact label="File picker">
        <FilePicker />
      </ViewErrorBoundary>
      <ViewErrorBoundary compact label="Search">
        <ContentSearch />
      </ViewErrorBoundary>
      <ConfirmDialog />
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <Shell />
    </WorkspaceProvider>
  );
}
