import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectAction, ProjectActionRun } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { PlusIcon, StopIcon, TerminalIcon, XIcon } from "./icons";

function previewUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
}

export function ProjectActionsControl() {
  const {
    api,
    project,
    session,
    saveProjectActions,
    setBrowserUrl,
    openInspector,
    setConfirm,
  } = useWorkspace();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectAction>();
  const [name, setName] = useState("");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [runs, setRuns] = useState<ProjectActionRun[]>([]);
  const [error, setError] = useState<string>();

  const actions = project?.actions ?? [];

  useEffect(() => {
    if (!open) return undefined;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    if (!project?.id || !open) return undefined;
    let disposed = false;
    const refresh = () => {
      void api.listProjectActionRuns(project.id, session?.id).then((next) => {
        if (!disposed) setRuns(next as ProjectActionRun[]);
      });
    };
    refresh();
    const timer = window.setInterval(refresh, 1_500);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [api, open, project?.id, session?.id]);

  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setEditing(undefined);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [editing]);

  function edit(action?: ProjectAction) {
    setEditing(action ?? { id: "", name: "", command: "" });
    setName(action?.name ?? "");
    setCommand(action?.command ?? "");
    setUrl(action?.previewUrl ?? "");
  }

  async function save() {
    const next: ProjectAction = {
      id: editing?.id || `action-${crypto.randomUUID()}`,
      name: name.trim(),
      command: command.trim(),
      ...(previewUrl(url) ? { previewUrl: previewUrl(url) } : {}),
    };
    if (!next.name || !next.command) return;
    const updated = editing?.id
      ? actions.map((action) => (action.id === editing.id ? next : action))
      : [...actions, next];
    await saveProjectActions(updated);
    setEditing(undefined);
  }

  async function run(action: ProjectAction) {
    if (!project) return;
    setError(undefined);
    try {
      const next = (await api.runProjectAction(project.id, action.id, session?.id)) as ProjectActionRun;
      setRuns((current) => [next, ...current.filter((run) => run.actionId !== next.actionId)]);
      if (action.previewUrl) {
        setBrowserUrl(action.previewUrl);
        openInspector("browser");
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  async function stop(action: ProjectAction) {
    if (!project) return;
    setError(undefined);
    try {
      const next = (await api.stopProjectAction(project.id, action.id, session?.id)) as ProjectActionRun;
      setRuns((current) => current.map((run) => (run.actionId === next.actionId ? next : run)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  if (!project?.workingDirectory) return null;

  return (
    <div className="topbar-menu-anchor project-actions-control" ref={root}>
      <button
        type="button"
        className="topbar-chip-btn"
        onClick={() => setOpen((value) => !value)}
        title="Run or add a project action"
      >
        <PlusIcon size={12} />
        <span>Add action</span>
      </button>
      {open ? (
        <div className="topbar-dropdown-menu project-actions-menu">
          {
            <>
              {error ? <p className="notice project-action-error">{error}</p> : null}
              {actions.length === 0 ? <p className="faint project-actions-empty">No saved actions.</p> : null}
              {actions.map((action) => {
                const runState = runs.find((run) => run.actionId === action.id);
                const running = runState?.status === "running";
                return (
                  <div className="project-action-row" key={action.id}>
                    <button type="button" className="project-action-run" onClick={() => void run(action)}>
                      <TerminalIcon size={12} />
                      <span>
                        <b>{action.name}</b>
                        <small>{action.command}</small>
                      </span>
                      <span className={`project-action-state ${runState?.status ?? "idle"}`}>
                        {runState?.status ?? "run"}
                      </span>
                    </button>
                    {running ? (
                      <button type="button" className="ghost" title="Stop action" onClick={() => void stop(action)}>
                        <StopIcon size={11} />
                      </button>
                    ) : (
                      <button type="button" className="ghost" onClick={() => edit(action)}>
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="danger"
                      onClick={() =>
                        setConfirm({
                          title: `Delete “${action.name}”?`,
                          detail: "The saved command is removed from this project. Files are not changed.",
                          confirmLabel: "Delete action",
                          danger: true,
                          onConfirm: () => {
                            setConfirm(undefined);
                            void saveProjectActions(actions.filter((item) => item.id !== action.id));
                          },
                        })
                      }
                    >
                      Delete
                    </button>
                    {runState?.output ? <pre className="project-action-output">{runState.output}</pre> : null}
                  </div>
                );
              })}
              <button type="button" onClick={() => edit()}>
                <PlusIcon size={12} /> New action…
              </button>
            </>
          }
        </div>
      ) : null}
      {/* A modal, not a panel inside the dropdown: the form is a task of its
          own, and a menu that reflows into a form loses the list behind it. */}
      {editing
        ? createPortal(
            <div className="palette-backdrop center" onClick={() => setEditing(undefined)}>
              <form
                className="dialog project-action-dialog"
                onClick={(event) => event.stopPropagation()}
                onSubmit={(event) => {
                  event.preventDefault();
                  void save();
                }}
              >
                <header>
                  <div>
                    <h3>{editing.id ? "Edit action" : "Add action"}</h3>
                    <p>A command saved with this project, to run from the top bar.</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Close"
                    onClick={() => setEditing(undefined)}
                  >
                    <XIcon size={14} />
                  </button>
                </header>
                <label>
                  <span>Name</span>
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Dev server"
                  />
                </label>
                <label>
                  <span>Command</span>
                  {/* A textarea: a build command with flags does not fit one
                      line, and a single-line input hides its own end. */}
                  <textarea
                    className="field"
                    rows={2}
                    value={command}
                    onChange={(event) => setCommand(event.target.value)}
                    placeholder="pnpm dev"
                  />
                </label>
                <label>
                  <span>
                    Preview URL <small>optional</small>
                  </span>
                  <input
                    type="text"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="localhost:5173"
                  />
                  <small className="field-hint">
                    Opens in Capsule's browser panel when the action runs.
                  </small>
                </label>
                <div className="actions">
                  <button className="ghost" type="button" onClick={() => setEditing(undefined)}>
                    Cancel
                  </button>
                  <button className="send" type="submit" disabled={!name.trim() || !command.trim()}>
                    Save action
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
