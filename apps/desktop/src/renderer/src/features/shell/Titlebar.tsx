import { useState, useRef, useEffect } from "react";
import { harnessDisplayName } from "../../lib/harness";
import { useWorkspace } from "../../lib/workspace";
import { SidebarToggle } from "./SidebarControl";
import { ProjectActionsControl } from "./ProjectActionsControl";
import { CommitControl } from "./CommitControl";
import {
  ChevronDownIcon,
  FolderIcon,
  GitBranchIcon,
  PanelBottomIcon,
  PanelRightIcon,
  PlusIcon,
  StopIcon,
  TerminalIcon,
  XIcon,
} from "./icons";

const VIEW_TITLE: Record<string, string> = {
  runtimes: "Harnesses",
  skills: "Skills",
  history: "History",
  approvals: "Approvals",
  usage: "Usage",
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
    terminalOpen,
    setTerminalOpen,
    activeRun,
    stopRun,
    cancelHarness,
    closeHarness,
    createTask,
    initializeGit,
  } = useWorkspace();
  const terminalCwd = session?.workingDirectory ?? project?.workingDirectory;

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

  const label = connected ? "OpenClaw connected" : (status?.state ?? "Offline");
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
                <span>{projectName}</span>
              </span>
              {sessionTitle ? (
                <>
                  <span className="breadcrumb-separator">/</span>
                  <span className="breadcrumb-segment session-segment">
                    <span>{sessionTitle}</span>
                  </span>
                </>
              ) : null}
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
            <ProjectActionsControl />
            {/* Open in Finder/Terminal Menu */}
            <div className="topbar-menu-anchor" ref={openMenuRef}>
              <button
                type="button"
                className="topbar-chip-btn"
                onClick={() => setOpenMenu((prev) => !prev)}
                title="Open project folder"
              >
                <FolderIcon size={12} />
                <span>Open</span>
                <ChevronDownIcon size={12} />
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
            <CommitControl />
            {git?.available && !git.isRepo && (
              <button
                type="button"
                className="topbar-chip-btn"
                onClick={() => void initializeGit()}
                title="Initialize a Git repository in this folder"
              >
                <GitBranchIcon size={12} />
                <span>Initialize Git</span>
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
            className={`icon-btn ${terminalOpen ? "active" : ""}`}
            /* A shell needs a folder to open in, so the control says why it is
               unavailable instead of toggling nothing. */
            disabled={!terminalCwd}
            title={terminalCwd ? "Toggle terminal (⌘J)" : "Open a folder to use the terminal"}
            aria-label="Toggle terminal (⌘J)"
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <PanelBottomIcon size={14} />
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
