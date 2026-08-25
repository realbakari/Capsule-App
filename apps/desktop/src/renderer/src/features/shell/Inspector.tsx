import { useEffect, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { useWorkspace, type InspectorTab } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import { CpuIcon, DiffIcon, FileIcon, GitBranchIcon, TerminalIcon, XIcon } from "./icons";

const TABS: Array<{ id: InspectorTab; label: string; key: string }> = [
  { id: "files", label: "Files", key: "f" },
  { id: "changes", label: "Changes", key: "c" },
  { id: "diff", label: "Diff", key: "d" },
  { id: "agents", label: "Agents", key: "a" },
  { id: "run", label: "Run", key: "r" },
];

export function Inspector() {
  const {
    project,
    session,
    activeRun,
    steps,
    artifacts,
    harnesses,
    harnessSessions,
    git,
    files,
    pickProjectDirectory,
    openTerminal,
    openPath,
    mentionFile,
    setView,
    toggleInspector,
    checkoutBranch,
    api,
    projectId,
    inspectorTab,
    setInspectorTab,
    gitCommit,
    gitStage,
    gitDiscard,
    gitCreateBranch,
    spawnHarness,
    cancelHarness,
    closeHarness,
    setSessionId,
    busy,
  } = useWorkspace();
  const [dir, setDir] = useState(".");
  const [listing, setListing] = useState<FileEntry[]>(files);
  const [diff, setDiff] = useState("");
  const [preview, setPreview] = useState("");
  const [message, setMessage] = useState("");
  const [branchName, setBranchName] = useState("");
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);
  const tab = inspectorTab;

  useEffect(() => {
    setDir(".");
    setListing(files);
  }, [files, projectId]);

  useEffect(() => {
    if (!projectId || tab !== "diff") return;
    void api.gitDiff(projectId).then((text: string) => {
      setDiff(text);
      setPreview("");
    });
  }, [api, git?.summary, projectId, tab]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (!target?.closest(".inspector")) return;
      if (target.closest("input, textarea, select")) return;
      const match = TABS.find((item) => item.key === event.key.toLowerCase());
      if (match) {
        event.preventDefault();
        setInspectorTab(match.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setInspectorTab]);

  async function openDir(relative: string) {
    if (!projectId) return;
    const next = await api.listFiles(projectId, relative);
    setDir(relative);
    setListing(next);
  }

  async function showFileDiff(relative: string) {
    if (!projectId) return;
    setDiff(await api.gitDiff(projectId, relative));
    setPreview("");
    setInspectorTab("diff");
  }

  async function previewFile(relative: string) {
    if (!projectId) return;
    try {
      setPreview((await api.readFile(projectId, relative)).slice(0, 8000));
      setDiff("");
    } catch (error) {
      setPreview(error instanceof Error ? error.message : String(error));
    }
    setInspectorTab("diff");
  }

  const parent = dir === "." ? undefined : dir.split("/").slice(0, -1).join("/") || ".";

  return (
    <aside className="inspector">
      <div className="inspector-header">
        <h4>Context</h4>
        <button className="icon-btn" title="Close inspector" onClick={toggleInspector}>
          <XIcon size={14} />
        </button>
      </div>
      <div className="inspector-tabs">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "active" : ""}
            title={`${item.label} (${item.key.toUpperCase()})`}
            onClick={() => setInspectorTab(item.id)}
          >
            {item.label}
            {item.id === "changes" && git?.changed ? <span className="tab-count">{git.changed}</span> : null}
            {item.id === "agents" && harnessSessions.length ? (
              <span className="tab-count">{harnessSessions.length}</span>
            ) : null}
          </button>
        ))}
      </div>
      {tab === "files" && (
        <div className="inspector-block">
          <div className="kv">
            <span className="truncate">{dir === "." ? project?.name ?? "Files" : dir}</span>
            {parent && (
              <button className="ghost" onClick={() => void openDir(parent)}>
                Up
              </button>
            )}
          </div>
          {listing.length === 0 ? (
            <div className="faint">Choose a project folder to browse files.</div>
          ) : (
            listing.map((entry) => (
              <button
                key={entry.path}
                className="list-item"
                title="Click to mention · double-click to preview"
                onClick={() => {
                  if (entry.type === "directory") void openDir(entry.path);
                  else mentionFile(entry.path);
                }}
                onDoubleClick={() => {
                  if (entry.type === "file") void previewFile(entry.path);
                  else if (project?.workingDirectory) {
                    void openPath(`${project.workingDirectory.replace(/\/$/, "")}/${entry.path}`);
                  }
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  void navigator.clipboard.writeText(entry.path);
                }}
              >
                <FileIcon size={12} />
                <span className="truncate">{entry.name}</span>
                <span className="meta">{entry.type === "directory" ? "dir" : ""}</span>
              </button>
            ))
          )}
        </div>
      )}
      {tab === "changes" && (
        <div className="inspector-block">
          {git?.isRepo ? (
            <>
              <div className="kv">
                <span>Branch</span>
                <span>{git.branch}</span>
              </div>
              {(git.files ?? []).length === 0 ? (
                <div className="faint">Working tree clean.</div>
              ) : (
                git.files.map((entry) => (
                  <div className="change-row" key={entry.path}>
                    <button className="list-item" onClick={() => void showFileDiff(entry.path)}>
                      <DiffIcon size={12} />
                      <span className="truncate">{entry.path}</span>
                      <span className="meta">{entry.code}</span>
                    </button>
                    <button className="ghost" onClick={() => void gitStage(entry.path)}>
                      Stage
                    </button>
                    <button className="danger" onClick={() => gitDiscard(entry.path)}>
                      Discard
                    </button>
                  </div>
                ))
              )}
              <form
                className="commit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!message.trim()) return;
                  void gitCommit(message).then(() => setMessage(""));
                }}
              >
                <input
                  type="text"
                  placeholder="Commit message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <button className="send" type="submit" disabled={!git.dirty || !message.trim()}>
                  Commit
                </button>
              </form>
              <form
                className="commit-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!branchName.trim()) return;
                  void gitCreateBranch(branchName).then(() => setBranchName(""));
                }}
              >
                <input
                  type="text"
                  placeholder="New branch"
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                />
                <button className="ghost" type="submit" disabled={!branchName.trim()}>
                  Create
                </button>
              </form>
            </>
          ) : (
            <div className="faint">{git?.summary ?? "Set a folder to see git status."}</div>
          )}
        </div>
      )}
      {tab === "diff" && (
        <div className="inspector-block">
          {preview && !diff ? <pre className="mono artifact-preview">{preview}</pre> : <DiffView text={diff} />}
          {artifacts
            .filter((item) => item.kind === "patch" && item.content)
            .map((artifact) => (
              <div key={artifact.id}>
                <h4>{artifact.title}</h4>
                <DiffView text={artifact.content ?? ""} />
              </div>
            ))}
        </div>
      )}
      {tab === "agents" && (
        <div className="inspector-block">
          {harnesses.map((harness) => (
            <div className="change-row" key={harness.id}>
              <div className="list-item" style={{ cursor: "default" }}>
                <CpuIcon size={12} />
                <span className="truncate">{harness.name}</span>
                <span className="meta">{harness.readiness.replaceAll("_", " ")}</span>
              </div>
              <button
                className="send"
                disabled={!projectId || busy}
                onClick={() => void spawnHarness(harness.id)}
              >
                Spawn
              </button>
            </div>
          ))}
          {harnessSessions.length === 0 ? (
            <div className="faint">No live Claude or Codex sessions.</div>
          ) : (
            harnessSessions.map((item) => (
              <div className="change-row" key={item.id}>
                <button
                  className={`list-item ${item.id === session?.id ? "active" : ""}`}
                  onClick={() => {
                    setSessionId(item.id);
                    setView("chat");
                  }}
                >
                  <span className="truncate">{item.title}</span>
                  <span className="meta">{item.harnessState}</span>
                </button>
                <button className="ghost" onClick={() => void cancelHarness(item.id)}>
                  Cancel
                </button>
                <button className="danger" onClick={() => void closeHarness(item.id)}>
                  Close
                </button>
              </div>
            ))
          )}
        </div>
      )}
      {tab === "run" && (
        <>
          <div className="inspector-block">
            <h4>Project</h4>
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
            <h4>Harness</h4>
            {dedicated ? (
              <div className="kv">
                <span>Dedicated</span>
                <span>{dedicated.name}</span>
              </div>
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
          {artifacts.length > 0 && (
            <div className="inspector-block">
              <h4>Artifacts</h4>
              {artifacts.map((artifact) => (
                <div key={artifact.id} className="kv">
                  <span>{artifact.title}</span>
                  <span className="faint">{artifact.kind}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {git?.isRepo && git.branches.length > 1 && tab !== "agents" && (
        <div className="inspector-block">
          <h4>Branches</h4>
          {git.branches.map((branch) => (
            <button
              key={branch}
              className={`list-item ${branch === git.branch ? "active" : ""}`}
              onClick={() => void checkoutBranch(branch)}
            >
              <GitBranchIcon size={12} />
              <span className="truncate">{branch}</span>
            </button>
          ))}
        </div>
      )}
    </aside>
  );
}
