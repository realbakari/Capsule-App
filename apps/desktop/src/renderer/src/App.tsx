import { useEffect, useState, type CSSProperties } from "react";
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
import { Splash } from "./features/shell/Splash";
import { Titlebar } from "./features/shell/Titlebar";
import { AboutModal } from "./features/settings/AboutModal";
import { ViewErrorBoundary } from "./features/shell/ErrorBoundary";
import { useSidebarSwipe } from "./lib/useSidebarSwipe";
import { WorkspaceProvider, useWorkspace } from "./lib/workspace";

const BOOT_SPLASH_MS = 1100;
const BOOT_FADE_MS = 200;

function Shell() {
  const { view, inspectorOpen, sidebarCollapsed, sidebarWidth, setSidebarCollapsed, aboutOpen, setAboutOpen } = useWorkspace();
  useSidebarSwipe(sidebarCollapsed, setSidebarCollapsed);
  const style = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;
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
          <ViewErrorBoundary key={view} label={view === "chat" ? "Conversation" : "This view"}>
            {view === "chat" && <Conversation />}
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

function ShellWrapper() {
  const { ready } = useWorkspace();
  const [phase, setPhase] = useState<"holding" | "fading" | "done">("holding");

  useEffect(() => {
    if (!ready) return;
    const fade = window.setTimeout(() => setPhase("fading"), 80);
    const done = window.setTimeout(() => setPhase("done"), 80 + BOOT_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, [ready]);

  // Safety fallback: never hold splash screen longer than 1200ms
  useEffect(() => {
    const fallbackFade = window.setTimeout(() => {
      setPhase((p) => (p === "holding" ? "fading" : p));
    }, 1200);
    const fallbackDone = window.setTimeout(() => {
      setPhase((p) => (p !== "done" ? "done" : p));
    }, 1200 + BOOT_FADE_MS);
    return () => {
      window.clearTimeout(fallbackFade);
      window.clearTimeout(fallbackDone);
    };
  }, []);

  return (
    <>
      {phase !== "done" && <Splash fading={phase === "fading"} />}
      <Shell />
    </>
  );
}

export default function App() {
  return (
    <WorkspaceProvider>
      <ShellWrapper />
    </WorkspaceProvider>
  );
}
