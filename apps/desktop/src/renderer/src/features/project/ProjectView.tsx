import { useEffect, useState } from "react";
import type { AgentMode, ProjectAction, WorkspaceMode } from "@capsule/shared";
import { isSharedAction, PROJECT_FILE_NAME } from "@capsule/shared";

import { MODES, useWorkspace } from "../../lib/workspace";
import { formatProjectRoot } from "../../lib/paths";
import { AgentGlyph } from "../shell/AgentGlyph";
import { MenuSelect } from "../shell/MenuSelect";
import { SettingRow } from "../settings/controls";
import { ProjectActionDialog } from "../shell/ProjectActionDialog";
import { CopyIcon, FolderIcon, PlusIcon, TerminalIcon, TrashIcon } from "../shell/icons";

/**
 * Everything that belongs to one project, in one place.
 *
 * These settings existed already and were spread across five surfaces: the
 * name in a context menu, the icon in a global list of every project, the
 * folder on the Harnesses screen, the actions in a top-bar dropdown. Nothing
 * told you a project had settings at all.
 */
export function ProjectView() {
  const {
    project,
    projects,
    projectId,
    agents,
    harnesses,
    sessions,
    settings,
    api,
    refresh,
    setView,
    renameProject,
    deleteProject,
    saveProjectActions,
    addProjectFolder,
    removeProjectFolder,
    makePrimaryFolder,
    pickProjectDirectory,
    openPath,
    setConfirm,
  } = useWorkspace();
  const [name, setName] = useState(project?.name ?? "");
  const [editing, setEditing] = useState<ProjectAction>();

  useEffect(() => {
    setName(project?.name ?? "");
  }, [project?.id, project?.name]);

  if (!project) {
    return (
      <section className="panel">
        <div className="panel-inner">
          <p className="muted">Select a project to see its settings.</p>
        </div>
      </section>
    );
  }

  const isInbox = project.name === "Inbox";
  const actions = project.actions ?? [];
  const extras = project.extraFolders ?? [];
  const threadCount = sessions.filter((item) => item.projectId === project.id).length;
  const agentName = agents.find((item) => item.id === project.defaultAgentId)?.name;

  async function patch(input: Parameters<typeof api.updateProject>[1]) {
    await api.updateProject(project!.id, input);
    await refresh();
  }

  async function saveAction(next: ProjectAction) {
    const updated = actions.some((item) => item.id === next.id)
      ? actions.map((item) => (item.id === next.id ? next : item))
      : [...actions, next];
    await saveProjectActions(updated);
    setEditing(undefined);
  }

  return (
    <section className="panel">
      <div className="panel-inner">
        <div className="panel-header">
          <h2>{project.name}</h2>
          <p>
            {formatProjectRoot(project.workingDirectory, {
              home: window.capsule.homeDir,
              fallback: "No folder attached",
            })}
            {threadCount > 0 ? ` · ${threadCount} conversation${threadCount === 1 ? "" : "s"}` : ""}
          </p>
        </div>

        <div className="card">
          <h3>Project</h3>
          <SettingRow label="Name" hint="What this project is called in the sidebar and in search.">
            <input
              type="text"
              value={name}
              disabled={isInbox}
              onChange={(event) => setName(event.target.value)}
              onBlur={() => {
                if (name.trim() && name.trim() !== project.name) void renameProject(project.id, name);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
              }}
            />
          </SettingRow>
          <SettingRow
            label="Icon"
            hint={project.iconPath ? project.iconPath : "Taken from the folder when it has one."}
          >
            <div className="actions" style={{ marginTop: 0 }}>
              <span className="project-settings-icon">
                {project.iconDataUrl ? (
                  <img src={project.iconDataUrl} alt="" />
                ) : (
                  project.name.slice(0, 1).toUpperCase()
                )}
              </span>
              <button
                className="chip"
                type="button"
                onClick={() => {
                  void (async () => {
                    const paths = (await api.pickFiles()) as string[] | undefined;
                    const iconPath = paths?.[0];
                    if (iconPath) await patch({ iconPath });
                  })();
                }}
              >
                Choose image
              </button>
              {project.iconPath ? (
                <button className="ghost" type="button" onClick={() => void patch({ iconPath: null })}>
                  Automatic
                </button>
              ) : null}
            </div>
          </SettingRow>
        </div>

        <div className="card">
          <h3>New conversations</h3>
          <SettingRow
            label="Agent"
            hint={
              project.defaultAgentId
                ? "Conversations started here open with this agent."
                : "Following the app default. Pick one to pin it to this project."
            }
          >
            <div className="actions" style={{ marginTop: 0 }}>
              <MenuSelect
                ariaLabel="Default agent"
                placeholder="App default"
                icon={
                  project.defaultAgentId && agentName ? (
                    <AgentGlyph id={project.defaultAgentId} name={agentName} />
                  ) : undefined
                }
                value={project.defaultAgentId ?? ""}
                options={agents.map((item) => ({
                  id: item.id,
                  label: item.name,
                  detail: harnesses.find((candidate) => candidate.id === item.id)?.description,
                  icon: <AgentGlyph id={item.id} name={item.name} />,
                }))}
                onChange={(id) => void patch({ defaultAgentId: id })}
              />
              {project.defaultAgentId ? (
                <button className="ghost" type="button" onClick={() => void patch({ defaultAgentId: null })}>
                  Reset
                </button>
              ) : null}
            </div>
          </SettingRow>

          <SettingRow label="Mode" hint="What a new conversation here starts in.">
            <select
              className="field-select"
              value={project.defaultMode}
              onChange={(event) => void patch({ defaultMode: event.target.value as AgentMode })}
            >
              {MODES.map((mode) => (
                <option key={mode} value={mode}>
                  {mode}
                </option>
              ))}
            </select>
          </SettingRow>

          {/* The one setting here that had nowhere to live: it was app-wide,
              so a repo you always want isolated and one you never do could not
              both be right. */}
          <SettingRow
            label="Workspace"
            hint={
              project.defaultWorkspaceMode
                ? "Overrides the app default for this project."
                : `Following the app default (${settings?.defaultWorkspaceMode === "worktree" ? "isolated worktree" : "the project folder"}).`
            }
          >
            <select
              className="field-select"
              value={project.defaultWorkspaceMode ?? ""}
              onChange={(event) =>
                void patch({
                  defaultWorkspaceMode: (event.target.value || null) as WorkspaceMode | null,
                })
              }
            >
              <option value="">App default</option>
              <option value="local">The project folder</option>
              <option value="worktree">An isolated worktree</option>
            </select>
          </SettingRow>
        </div>

        <div className="card">
          <div className="row">
            <div>
              <h3>Folders</h3>
              <p className="muted">
                The first is the working folder: git, AGENTS.md and new conversations use it. The
                rest are readable by the agent and the file tree.
              </p>
            </div>
            <button className="chip" type="button" onClick={() => void addProjectFolder(project.id)}>
              <PlusIcon size={12} /> Add folder
            </button>
          </div>
          {[project.workingDirectory, ...extras].filter(Boolean).map((folder, index) => (
            <div className="row project-folder-row" key={folder}>
              <span className="inline-icon mono">
                <FolderIcon size={12} />
                {formatProjectRoot(folder, { home: window.capsule.homeDir })}
              </span>
              {index === 0 ? <span className="chip-static">working folder</span> : null}
              <div className="actions" style={{ marginTop: 0 }}>
                <button
                  className="ghost"
                  type="button"
                  title="Copy path"
                  aria-label="Copy path"
                  onClick={() => void navigator.clipboard.writeText(folder!)}
                >
                  <CopyIcon size={12} />
                </button>
                <button className="ghost" type="button" onClick={() => void openPath(folder!)}>
                  Show in Finder
                </button>
                {index > 0 ? (
                  <>
                    <button
                      className="ghost"
                      type="button"
                      onClick={() => void makePrimaryFolder(folder!, project.id)}
                    >
                      Make working folder
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => void removeProjectFolder(folder!, project.id)}
                    >
                      Remove
                    </button>
                  </>
                ) : null}
              </div>
            </div>
          ))}
          {!project.workingDirectory && (
            <button className="chip" type="button" onClick={() => void pickProjectDirectory(project.id)}>
              Attach a folder
            </button>
          )}
        </div>

        <div className="card">
          <div className="row">
            <div>
              <h3>Actions</h3>
              <p className="muted">
                Commands run from the top bar. Ones declared in {PROJECT_FILE_NAME} come with the
                repository and are the same for everyone who clones it.
              </p>
            </div>
            <button
              className="chip"
              type="button"
              onClick={() => setEditing({ id: "", name: "", command: "" })}
            >
              <PlusIcon size={12} /> Add action
            </button>
          </div>
          {project.projectFile?.status === "invalid" ? (
            <p className="notice">
              {PROJECT_FILE_NAME} is here but cannot be read, so everything it declares is being
              ignored: {project.projectFile.error}
            </p>
          ) : null}
          {actions.length === 0 ? (
            <p className="faint">No actions yet.</p>
          ) : (
            actions.map((action) => (
              <div className="row project-action-listing" key={action.id}>
                <span className="inline-icon">
                  <TerminalIcon size={12} />
                  <b>{action.name}</b>
                  <code className="mono">{action.command}</code>
                </span>
                <div className="actions" style={{ marginTop: 0 }}>
                  {action.runOnWorktreeCreate ? <span className="chip-static">setup</span> : null}
                  {action.previewUrl ? <span className="chip-static">preview</span> : null}
                  {/* A shared action is edited by editing the file, not here:
                      saving it locally would fork it from the repository
                      without saying so. */}
                  {isSharedAction(action) ? (
                    <span className="chip-static" title={`Declared in ${PROJECT_FILE_NAME}`}>
                      shared
                    </span>
                  ) : (
                    <button className="ghost" type="button" onClick={() => setEditing(action)}>
                      Edit
                    </button>
                  )}
                  <button
                    className="danger"
                    type="button"
                    disabled={isSharedAction(action)}
                    title={
                      isSharedAction(action)
                        ? `Remove it from ${PROJECT_FILE_NAME} instead`
                        : undefined
                    }
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
              </div>
            ))
          )}
        </div>

        {!isInbox && (
          <div className="card">
            <h3>Danger</h3>
            <SettingRow
              label="Delete this project"
              hint="Its conversations, runs and artifacts go with it. The folder on disk is untouched."
            >
              <button
                className="danger"
                type="button"
                onClick={() => {
                  deleteProject(project.id);
                  setView("chat");
                }}
              >
                <TrashIcon size={12} /> Delete project
              </button>
            </SettingRow>
          </div>
        )}
      </div>

      {editing ? (
        <ProjectActionDialog
          action={editing}
          onSave={(next) => void saveAction(next)}
          onClose={() => setEditing(undefined)}
        />
      ) : null}
    </section>
  );
}
