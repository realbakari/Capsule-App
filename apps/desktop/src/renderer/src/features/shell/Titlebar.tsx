import { useWorkspace } from "../../lib/workspace";
import { SidebarToggle } from "./SidebarControl";
import { SurfaceBar } from "./SurfaceBar";
import { ThreadTitleMenu } from "./ThreadTitleMenu";
import { PresenceIndicator } from "../share/Presence";
import { ThreadProfileChip } from "../customization/ThreadProfileChip";
import { gatewayConnectionLabel } from "../../lib/harness";
import { ArrowLeftIcon, ArrowRightIcon, StopIcon } from "./icons";

/*
 * The titlebar names where you are and picks the panel. Opening the folder,
 * project actions, commit and push live in Conversation details (the list
 * icon), one row each, so the bar stays the same short width everywhere.
 */
const VIEW_TITLE: Record<string, string> = {
  channels: "Channels",
  project: "Project",
  runtimes: "Agents",
  skills: "Skills",
  history: "History",
  approvals: "Approvals",
  usage: "Usage",
  settings: "Settings",
  board: "Board",
};

export function Titlebar() {
  const {
    connected,
    status,
    settings,
    setView,
    view,
    project,
    session,
    sidebarCollapsed,
    activeRun,
    stopRun,
    canGoBack,
    canGoForward,
    goBack,
    goForward,
  } = useWorkspace();

  const label = gatewayConnectionLabel(settings?.runtimeMode, connected, status?.state);

  const projectName = project?.name ?? "Inbox";
  // Whatever the thread is actually called. Substituting a nicer-sounding
  // title here made the titlebar disagree with the sidebar, which still showed
  // the real one.
  const sessionTitle = session?.title ?? "";

  return (
    <header className={`page-header ${sidebarCollapsed || view === "channels" ? "with-traffic" : ""}${sidebarCollapsed ? " with-history" : ""}`}>
      {view === "chat" ? <h1 className="sr-only">{sessionTitle || projectName}</h1> : null}
      {sidebarCollapsed || view === "channels" ? <SidebarToggle /> : null}
      {/* With the sidebar away, its back and forward arrows come here, beside the toggle that brings it back. */}
      {sidebarCollapsed ? (
        <span className="titlebar-history">
          <button type="button" className="icon-btn" title="Back (⌘[)" aria-label="Back" disabled={!canGoBack} onClick={goBack}><ArrowLeftIcon size={14} /></button>
          <button type="button" className="icon-btn" title="Forward (⌘])" aria-label="Forward" disabled={!canGoForward} onClick={goForward}><ArrowRightIcon size={14} /></button>
        </span>
      ) : null}
      <div className="header-actions header-lead">
        <div className="page-title breadcrumb-title">
          {view === "chat" ? (
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-segment project-segment">
                <span>{projectName}</span>
              </span>
              {sessionTitle ? (
                <>
                  <span className="breadcrumb-separator">/</span>
                  <ThreadTitleMenu />
                  <PresenceIndicator />
                  <ThreadProfileChip />
                </>
              ) : null}
            </div>
          ) : (
            <div className="topbar-breadcrumb">{view === "channels" && <button className="ghost" onClick={() => setView("chat")}>Back to conversations</button>}<b>{VIEW_TITLE[view] ?? ""}</b></div>
          )}
        </div>
      </div>

      <div className="header-actions">
        {activeRun && (
          <button className="icon-btn" title="Stop run" aria-label="Stop run" onClick={() => void stopRun()}>
            <StopIcon size={14} />
          </button>
        )}

        {view === "chat" && <SurfaceBar />}

        {/* Only when something needs attention; a healthy connection shows in the sidebar footer. */}
        {!connected && settings?.runtimeMode !== "direct" && (
          <button className="status-dot-btn" title={label} onClick={() => setView("settings")} aria-label={label}>
            <span className={`dot ${status?.state === "connecting" ? "warn live" : "off"}`} />
          </button>
        )}
      </div>
    </header>
  );
}
