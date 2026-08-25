import { useWorkspace } from "../../lib/workspace";
import { TerminalIcon, XIcon } from "./icons";

export function Inspector() {
  const {
    project,
    session,
    status,
    activeRun,
    steps,
    artifacts,
    harnesses,
    git,
    files,
    pickProjectDirectory,
    openTerminal,
    openPath,
    mentionFile,
    setView,
    toggleInspector,
  } = useWorkspace();
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <h4>Context</h4>
        <button className="icon-btn" title="Close inspector" onClick={toggleInspector}>
          <XIcon size={14} />
        </button>
      </div>
      <div className="inspector-block">
        <h4>Project</h4>
        <div className="kv">
          <span>Name</span>
          <span>{project?.name ?? "—"}</span>
        </div>
        <div className="kv">
          <span>Mode</span>
          <span>{session?.mode ?? project?.defaultMode ?? "chat"}</span>
        </div>
        <div className="kv">
          <span>Folder</span>
          <span className="mono">{project?.workingDirectory ?? "not set"}</span>
        </div>
        <div className="actions" style={{ marginTop: 8 }}>
          <button className="ghost" onClick={() => void pickProjectDirectory()}>
            Choose folder
          </button>
          <button className="ghost" disabled={!project?.workingDirectory} onClick={() => void openTerminal()}>
            <span className="inline-icon">
              <TerminalIcon size={12} />
              Terminal
            </span>
          </button>
        </div>
      </div>
      <div className="inspector-block">
        <h4>Git</h4>
        {git?.isRepo ? (
          <>
            <div className="kv">
              <span>Branch</span>
              <span>{git.branch}</span>
            </div>
            <div className="kv">
              <span>Status</span>
              <span>{git.dirty ? `${git.changed} changed` : "clean"}</span>
            </div>
          </>
        ) : (
          <div className="faint">{git?.summary ?? "Set a folder to see git status."}</div>
        )}
      </div>
      <div className="inspector-block">
        <h4>Files</h4>
        {files.length === 0 ? (
          <div className="faint">Choose a project folder to browse files.</div>
        ) : (
          files.slice(0, 24).map((entry) => (
            <button
              key={entry.path}
              className="list-item"
              title="Click to mention, double-click to open"
              onClick={() => mentionFile(entry.path)}
              onDoubleClick={() => {
                if (project?.workingDirectory) {
                  void openPath(`${project.workingDirectory.replace(/\/$/, "")}/${entry.path}`);
                }
              }}
            >
              {entry.name}
              <span className="meta">{entry.type === "directory" ? "dir" : ""}</span>
            </button>
          ))
        )}
      </div>
      <div className="inspector-block">
        <h4>Harness</h4>
        {dedicated ? (
          <>
            <div className="kv">
              <span>Dedicated</span>
              <span>{dedicated.name}</span>
            </div>
            <div className="kv">
              <span>State</span>
              <span>{session?.harnessState ?? dedicated.readiness.replaceAll("_", " ")}</span>
            </div>
          </>
        ) : (
          <button className="ghost" onClick={() => setView("runtimes")}>
            Dedicate Claude or Codex
          </button>
        )}
      </div>
      <div className="inspector-block">
        <h4>Run</h4>
        {activeRun ? (
          steps.map((step) => (
            <div className={`step ${step.status}`} key={step.id}>
              <span className="glyph">
                {step.status === "complete" ? "✓" : step.status === "active" ? "●" : "○"}
              </span>
              {step.label}
            </div>
          ))
        ) : (
          <div className="faint">Idle</div>
        )}
      </div>
      <div className="inspector-block">
        <h4>Gateway</h4>
        <div className="kv">
          <span>Host</span>
          <span>
            {status?.gatewayHost}:{status?.gatewayPort}
          </span>
        </div>
      </div>
      {artifacts.length > 0 && (
        <div className="inspector-block">
          <h4>Diffs / artifacts</h4>
          {artifacts.map((artifact) => (
            <div key={artifact.id} className="kv">
              <span>{artifact.title}</span>
              <span className="faint">{artifact.kind}</span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
