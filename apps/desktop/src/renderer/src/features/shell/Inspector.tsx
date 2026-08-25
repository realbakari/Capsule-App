import { useEffect, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { DiffView } from "./DiffView";
import { DiffIcon, FileIcon, GitBranchIcon, TerminalIcon, XIcon } from "./icons";

type InspectorTab = "files" | "changes" | "diff" | "run";

export function Inspector() {
  const {
    project,
    session,
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
    checkoutBranch,
    api,
    projectId,
  } = useWorkspace();
  const [tab, setTab] = useState<InspectorTab>("files");
  const [dir, setDir] = useState(".");
  const [listing, setListing] = useState<FileEntry[]>(files);
  const [diff, setDiff] = useState("");
  const [preview, setPreview] = useState("");
  const dedicated = harnesses.find((item) => item.id === project?.defaultAgentId);

  useEffect(() => {
    setDir(".");
    setListing(files);
  }, [files, projectId]);

  useEffect(() => {
    if (!projectId || tab !== "diff") return;
    void api.gitDiff(projectId).then((text: string) => setDiff(text));
  }, [api, git?.summary, projectId, tab]);

  async function openDir(relative: string) {
    if (!projectId) return;
    const next = await api.listFiles(projectId, relative);
    setDir(relative);
    setListing(next);
  }

  async function showFileDiff(relative: string) {
    if (!projectId) return;
    const text = await api.gitDiff(projectId, relative);
    setDiff(text);
    setTab("diff");
  }

  async function previewFile(relative: string) {
    if (!projectId) return;
    try {
      const text = await api.readFile(projectId, relative);
      setPreview(text.slice(0, 8000));
      setDiff("");
      setTab("diff");
    } catch (error) {
      setPreview(error instanceof Error ? error.message : String(error));
      setTab("diff");
    }
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
        {(
          [
            ["files", "Files"],
            ["changes", "Changes"],
            ["diff", "Diff"],
            ["run", "Run"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
            {id === "changes" && git?.changed ? <span className="tab-count">{git.changed}</span> : null}
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
                  <button
                    key={entry.path}
                    className="list-item"
                    onClick={() => void showFileDiff(entry.path)}
                    onDoubleClick={() => mentionFile(entry.path)}
                  >
                    <DiffIcon size={12} />
                    <span className="truncate">{entry.path}</span>
                    <span className="meta">{entry.code}</span>
                  </button>
                ))
              )}
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
            {session?.mode && (
              <div className="kv">
                <span>Mode</span>
                <span>{session.mode}</span>
              </div>
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
      {git?.isRepo && git.branches.length > 1 && (
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
