import { useEffect, useRef, useState } from "react";
import type { ProjectAction } from "@capsule/shared";
import { isSharedAction, PROJECT_FILE_NAME } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { usePrimaryAction } from "../../lib/project-actions";
import { ChevronDownIcon, PlayIcon, PlusIcon, TerminalIcon } from "./icons";
import { HeaderPopover } from "./HeaderPopover";
import { ProjectActionDialog } from "./ProjectActionDialog";

/**
 * A split button: the action this project ran last, one click away, and the
 * full list behind the chevron. Actions run in the terminal dock, where their
 * output is live and Control-C stops them.
 */
export function ProjectActionsControl({ onRun }: { onRun?: () => void }) {
  const { project, session, settings, saveProjectActions, runProjectAction, setConfirm } = useWorkspace();
  const root = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectAction>();

  const actions = project?.actions ?? [];
  const primary = usePrimaryAction(project?.id, actions);
  const blocked = settings?.sandbox === "strict" ? "Strict sandbox blocks terminal commands." : undefined;

  // Switching project or thread closes the menu and drops anything half-typed
  // in it, rather than carrying it into a place it does not belong.
  useEffect(() => {
    setOpen(false);
    setEditing(undefined);
  }, [project?.id, session?.id]);

  function edit(action?: ProjectAction) {
    setEditing(action ?? { id: "", name: "", command: "" });
  }

  async function save(next: ProjectAction) {
    const updated = actions.some((item) => item.id === next.id)
      ? actions.map((item) => (item.id === next.id ? next : item))
      : [...actions, next];
    return saveProjectActions(updated);
  }

  function run(action: ProjectAction) {
    setOpen(false);
    runProjectAction(action);
    onRun?.();
  }

  if (!project?.workingDirectory) return null;

  const dialog = editing ? (
    <ProjectActionDialog
      action={editing}
      onSave={save}
      onClose={() => setEditing((current) => current === editing ? undefined : current)}
    />
  ) : null;

  if (!primary) {
    return (
      <div className="session-details-anchor project-actions-control">
        <button type="button" className="session-details-action" onClick={() => edit()}>
          <PlusIcon size={14} />
          <span>Add project action</span>
        </button>
        {dialog}
      </div>
    );
  }

  return (
    <div className="session-details-anchor project-actions-control" ref={root}>
      <div className="project-action-split">
        <button type="button" className="session-details-action" disabled={Boolean(blocked)} title={blocked ?? primary.command} onClick={() => run(primary)}>
          <PlayIcon size={14} />
          <span>Run {primary.name}</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="All project actions"
          title="All project actions"
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronDownIcon size={12} />
        </button>
      </div>
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
          {blocked ? <p className="faint project-actions-empty">{blocked}</p> : null}
          {actions.map((action) => (
            <div className="project-action-row" key={action.id}>
              <button type="button" className="project-action-run" disabled={Boolean(blocked)} onClick={() => run(action)}>
                <TerminalIcon size={12} />
                <span>
                  <b>{action.name}</b>
                  <small>{action.command}</small>
                </span>
              </button>
              {isSharedAction(action) ? <span className="chip-static" title={`Declared in ${PROJECT_FILE_NAME}`}>shared</span> : (
                <button type="button" className="ghost" onClick={() => edit(action)}>
                  Edit
                </button>
              )}
              <button
                type="button"
                className="danger"
                disabled={isSharedAction(action)}
                title={isSharedAction(action) ? `Remove it from ${PROJECT_FILE_NAME} instead` : undefined}
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
            </div>
          ))}
          <button type="button" onClick={() => edit()}>
            <PlusIcon size={12} /> New action…
          </button>
        </HeaderPopover>
      ) : null}
      {dialog}
    </div>
  );
}
