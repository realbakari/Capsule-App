import { useWorkspace } from "../../lib/workspace";
import { PanelLeftIcon, PanelRightIcon, PlusIcon, StopIcon, XIcon } from "./icons";

const VIEW_TITLE: Record<string, string> = {
  runtimes: "ACP harnesses",
  skills: "Skills",
  history: "History",
  approvals: "Approvals",
  settings: "Settings",
};

export function Titlebar() {
  const {
    connected,
    status,
    setView,
    view,
    project,
    session,
    sidebarCollapsed,
    toggleSidebar,
    inspectorOpen,
    toggleInspector,
    activeRun,
    stopRun,
    cancelHarness,
    closeHarness,
    createTask,
  } = useWorkspace();
  const label = connected
    ? "OpenClaw connected"
    : status?.kind === "mock"
      ? "Gateway offline"
      : (status?.state ?? "Offline");
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const harnessName = session?.harnessId === "codex" ? "Codex" : "Claude Code";
  const title =
    view === "chat"
      ? session?.title && session.title !== "New conversation"
        ? session.title
        : (project?.name ?? "Inbox")
      : (VIEW_TITLE[view] ?? "Capsule");

  return (
    <header className={`page-header ${sidebarCollapsed ? "with-traffic" : ""}`}>
      <div className="header-actions header-lead">
        {sidebarCollapsed && (
          <button className="icon-btn" title="Show sidebar (⌘B)" onClick={toggleSidebar}>
            <PanelLeftIcon />
          </button>
        )}
        <div className="page-title">
          {view === "chat" && project?.name && session?.title && session.title !== "New conversation" ? (
            <>
              <b>{project.name}</b>
              {` · ${title}`}
            </>
          ) : (
            <b>{title}</b>
          )}
        </div>
      </div>
      <div className="header-actions">
        {view === "chat" && (
          <button className="icon-btn" title="New conversation (⌘N)" onClick={() => void createTask()}>
            <PlusIcon />
          </button>
        )}
        {harnessLive && (
          <span className="live-chip">
            <span className="dot on" />
            {harnessName}
            <button title="Cancel turn" onClick={() => void cancelHarness()}>
              <StopIcon size={12} />
            </button>
            <button title="Close harness" onClick={() => void closeHarness()}>
              <XIcon size={12} />
            </button>
          </span>
        )}
        {activeRun && (
          <button className="icon-btn" title="Stop run" onClick={() => void stopRun()}>
            <StopIcon />
          </button>
        )}
        {view === "chat" && (
          <button
            className={`icon-btn ${inspectorOpen ? "active" : ""}`}
            title="Toggle inspector (⌘\\)"
            onClick={toggleInspector}
          >
            <PanelRightIcon />
          </button>
        )}
        <button
          className="status-dot-btn"
          title={label}
          onClick={() => setView("settings")}
          aria-label={label}
        >
          <span className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn" : "off"}`} />
        </button>
      </div>
    </header>
  );
}
