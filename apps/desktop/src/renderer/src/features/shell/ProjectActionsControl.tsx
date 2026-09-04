import { useEffect, useRef, useState } from "react";
import type { ProjectAction, ProjectActionRun } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { PlusIcon, StopIcon, TerminalIcon } from "./icons";
import { HeaderPopover } from "./HeaderPopover";
import { ProjectActionDialog } from "./ProjectActionDialog";

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
  const [runs, setRuns] = useState<ProjectActionRun[]>([]);
  const [error, setError] = useState<string>();

  const actions = project?.actions ?? [];

  // Switching project or thread closes the menu and drops anything half-typed
  // in it, rather than carrying it into a place it does not belong.
  useEffect(() => {
    setOpen(false);
    setEditing(undefined);
    setError(undefined);
  }, [project?.id, session?.id]);

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
  }

  async function save(next: ProjectAction) {
    const updated = actions.some((item) => item.id === next.id)
      ? actions.map((item) => (item.id === next.id ? next : item))
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
      if (action.previewUrl && action.openPreview !== false) {
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
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <PlusIcon size={12} />
        <span>Add action</span>
      </button>
      {open ? (
        /*
         * Portalled, like the other two header controls. This menu lived
         * inside .topbar-project-actions, which is overflow: hidden — so the
         * list of actions was cut off at the bar it hung from.
         */
        <HeaderPopover
          anchor={root}
          label="Project actions"
          className="project-actions-menu"
          onClose={() => setOpen(false)}
        >
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
        </HeaderPopover>
      ) : null}
      {editing ? (
        <ProjectActionDialog
          action={editing}
          onSave={(next) => void save(next)}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </div>
  );
}
