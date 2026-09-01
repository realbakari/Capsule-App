import { useState, useRef, useEffect } from "react";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { SidebarToggle } from "./SidebarControl";
import {
  FolderIcon,
  GitBranchIcon,
  PanelRightIcon,
  PlusIcon,
  StopIcon,
  TerminalIcon,
  XIcon,
} from "./icons";

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
    harnesses,
    status,
    setView,
    view,
    project,
    session,
    git,
    api,
    openTerminal,
    openInspector,
    sidebarCollapsed,
    inspectorOpen,
    toggleInspector,
    activeRun,
    stopRun,
    cancelHarness,
    closeHarness,
    createTask,
  } = useWorkspace();

  const [openMenu, setOpenMenu] = useState(false);
  const openMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (openMenuRef.current && !openMenuRef.current.contains(event.target as Node)) {
        setOpenMenu(false);
      }
    }
    if (openMenu) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
    return undefined;
  }, [openMenu]);

  const label = connected
    ? "OpenClaw connected"
    : status?.kind === "mock"
      ? "Gateway offline"
      : (status?.state ?? "Offline");
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const harnessName = harnessDisplayName(harnesses, session?.harnessId);

  const projectName = project?.name ?? "Inbox";
  // Whatever the thread is actually called. Substituting a nicer-sounding
  // title here made the titlebar disagree with the sidebar, which still showed
  // the real one.
  const sessionTitle = session?.title ?? "";

  return (
    <header className={`page-header ${sidebarCollapsed ? "with-traffic" : ""}`}>
      {sidebarCollapsed ? <SidebarToggle /> : null}
      <div className="header-actions header-lead">
        <div className="page-title breadcrumb-title">
          {view === "chat" ? (
            <div className="topbar-breadcrumb">
              <span className="breadcrumb-segment project-segment">
                <FolderIcon size={13} className="breadcrumb-icon" />
                <span>{projectName}</span>
              </span>
              <span className="breadcrumb-separator">/</span>
              <span className="breadcrumb-segment session-segment">
                <span>{sessionTitle}</span>
              </span>
            </div>
          ) : (
            <b>{VIEW_TITLE[view] ?? ""}</b>
          )}
        </div>
      </div>

      <div className="header-actions">
        {/* Workspace Quick Actions */}
        {view === "chat" && project?.workingDirectory && (
          <div className="topbar-project-actions">
            {/* Open in Finder/Terminal Menu */}
            <div className="topbar-menu-anchor" ref={openMenuRef}>
              <button
                type="button"
                className="topbar-chip-btn"
                onClick={() => setOpenMenu((prev) => !prev)}
                title="Open project folder"
              >
                <FolderIcon size={12} />
                <span>Open ▾</span>
              </button>
              {openMenu && (
                <div className="topbar-dropdown-menu">
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(false);
                      if (project.workingDirectory) void api.openPath?.(project.workingDirectory);
                    }}
                  >
                    Reveal in Finder
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenMenu(false);
                      void openTerminal();
                    }}
                  >
                    Open in Terminal
                  </button>
                </div>
              )}
            </div>

            {/* Git Branch Badge */}
            {git?.isRepo && (
              <button
                type="button"
                className="topbar-chip-btn git-chip"
                onClick={() => openInspector("changes")}
                title={`Git branch: ${git.branch ?? "HEAD"}${git.dirty ? " (uncommitted changes)" : ""}`}
              >
                <GitBranchIcon size={12} />
                <span>{git.branch ?? "main"}</span>
                {git.dirty && <span className="git-dirty-indicator">•</span>}
              </button>
            )}
          </div>
        )}

        {view === "chat" && (
          <button className="icon-btn" title="New conversation (⌘N)" aria-label="New conversation (⌘N)" onClick={() => void createTask()}>
            <PlusIcon size={14} />
          </button>
        )}

        {harnessLive && (
          <span className="live-chip">
            <span className="dot on live" title={`${harnessName} is running`} />
            <span>{harnessName}</span>
            <button title="Cancel turn" aria-label="Cancel turn" onClick={() => void cancelHarness()}>
              <StopIcon size={10} />
            </button>
            <button title="Close harness" aria-label="Close harness" onClick={() => void closeHarness()}>
              <XIcon size={10} />
            </button>
          </span>
        )}

        {activeRun && (
          <button className="icon-btn" title="Stop run" aria-label="Stop run" onClick={() => void stopRun()}>
            <StopIcon size={14} />
          </button>
        )}

        {view === "chat" && (
          <button
            className={`icon-btn ${inspectorOpen ? "active" : ""}`}
            title="Toggle inspector (⌘\\)"
            aria-label="Toggle inspector (⌘\\)"
            onClick={toggleInspector}
          >
            <PanelRightIcon size={14} />
          </button>
        )}

        <button
          className="status-dot-btn"
          title={label}
          onClick={() => setView("settings")}
          aria-label={label}
        >
          <span
            className={`dot ${connected ? "on" : status?.state === "connecting" ? "warn live" : "off"}`}
          />
        </button>
      </div>
    </header>
  );
}
