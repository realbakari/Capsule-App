import { useEffect, useState, type CSSProperties } from "react";
import { Conversation } from "./features/conversation/Conversation";
import { RuntimesView } from "./features/harness/RuntimesView";
import { ApprovalsView, HistoryView, SkillsView } from "./features/library/LibraryViews";
import { SettingsView } from "./features/settings/SettingsView";
import { ConfirmDialog } from "./features/shell/ConfirmDialog";
import { ContentSearch } from "./features/shell/ContentSearch";
import { FilePicker } from "./features/shell/FilePicker";
import { Inspector } from "./features/shell/Inspector";
import { Palette } from "./features/shell/Palette";
import { Sidebar } from "./features/shell/Sidebar";
import { Splash } from "./features/shell/Splash";
import { Titlebar } from "./features/shell/Titlebar";
import { ViewErrorBoundary } from "./features/shell/ErrorBoundary";
import { WorkspaceProvider, useWorkspace } from "./lib/workspace";

const BOOT_SPLASH_MS = 1100;
const BOOT_FADE_MS = 200;

function Shell() {
  const { view, inspectorOpen, sidebarCollapsed, sidebarWidth } = useWorkspace();
  const style = { "--sidebar-width": `${sidebarWidth}px` } as CSSProperties;
  return (
    <div
      className={`app ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      style={style}
    >
      <Sidebar />
      <div className="workspace">
        <Titlebar />
        <div className="workspace-body">
          <ViewErrorBoundary key={view} label={view === "chat" ? "Conversation" : "This view"}>
            {view === "chat" && <Conversation />}
            {view === "runtimes" && <RuntimesView />}
            {view === "skills" && <SkillsView />}
            {view === "history" && <HistoryView />}
            {view === "approvals" && <ApprovalsView />}
            {view === "settings" && <SettingsView />}
          </ViewErrorBoundary>
          {view === "chat" && inspectorOpen && (
            <ViewErrorBoundary label="Inspector">
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
    </div>
  );
}

export default function App() {
  const [phase, setPhase] = useState<"holding" | "fading" | "done">("holding");

  useEffect(() => {
    const fade = window.setTimeout(() => setPhase("fading"), BOOT_SPLASH_MS);
    const done = window.setTimeout(() => setPhase("done"), BOOT_SPLASH_MS + BOOT_FADE_MS);
    return () => {
      window.clearTimeout(fade);
      window.clearTimeout(done);
    };
  }, []);

  return (
    <WorkspaceProvider>
      {phase !== "done" && <Splash fading={phase === "fading"} />}
      <Shell />
    </WorkspaceProvider>
  );
}
