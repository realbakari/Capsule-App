import { useState } from "react";
import type { CommandSourceId, ConfigFileTarget } from "@capsule/shared";
import { COMMAND_SOURCE_LABELS } from "../../lib/commands";
import { formatUserError } from "../../lib/errors";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow, Switch } from "./controls";
import "../conversation/commands.css";

const FOREIGN_SOURCES: Array<{ id: CommandSourceId; label: string; hint: string }> = [
  { id: "claude-commands", label: "Claude Code commands", hint: "~/.claude/commands, and .claude/commands in each project." },
  { id: "codex-prompts", label: "Codex prompts", hint: "~/.codex/prompts. $1 is the first argument in these files." },
];

const SHELL_LABELS = { none: undefined, runs: "runs shell", "needs-trust": "shell waits for trust" } as const;

/** Capsule's own commands: where they come from, what is wrong with them, and which other folders to read. */
export function CommandsCard() {
  const { api, project, projectId, commands } = useWorkspace();
  const list = commands?.list;
  const [failure, setFailure] = useState<string>();
  const desktop = api.isDesktop === true;
  const home = api.homeDir || undefined;
  const root = project?.workingDirectory?.replace(/\/$/, "");
  /* A project's file reads from the project, anything else from home; the file name stays visible either way. */
  const shown = (file: string) => <bdi>{root && file.startsWith(`${root}/`) ? file.slice(root.length + 1) : formatProjectRoot(file, { home })}</bdi>;
  const run = (work: () => Promise<unknown>) => {
    setFailure(undefined);
    void work().catch((caught: unknown) => setFailure(formatUserError(caught)));
  };
  const openFolder = (scope: "user" | "project") => {
    const target: ConfigFileTarget = { kind: "folder", folder: "commands", scope, ...(scope === "project" && projectId ? { projectId } : {}) };
    run(() => api.configOpenFile(target));
  };
  const setSource = (id: CommandSourceId, on: boolean) =>
    run(async () => {
      if (!desktop) throw new Error("Change this on the desktop.");
      await api.configSetValue({ key: "commandSources", value: { ...list?.sources, [id]: on }, scope: "user" });
      commands?.reload();
    });

  return (
    <div className="card commands-card">
      <h3>Commands</h3>
      <p className="muted">
        A command is a Markdown file whose text becomes your message. Type <code>/name</code> in any conversation, with any
        agent, and Capsule expands it first. A paired device can run them too; their shell commands run on this computer.
      </p>
      <div className="commands-card-actions">
        <button type="button" className="ghost" disabled={!desktop} onClick={() => openFolder("user")}>Open your commands folder</button>
        <button type="button" className="ghost" disabled={!desktop || !project?.workingDirectory} title={project?.workingDirectory ? undefined : "Open a project with a folder first."}
          onClick={() => openFolder("project")}>
          Open {project?.name ?? "project"} commands folder
        </button>
      </div>
      {(commands?.error || failure) && <p className="commands-card-error" role="alert">{failure ?? commands?.error}</p>}
      {list && list.commands.length === 0 && (
        <div className="commands-card-empty">
          <p>No commands yet. Add <code>review.md</code> to your commands folder, then type <code>/review 123</code>:</p>
          <pre>Review pull request #$ARGUMENTS and list the risks before style.</pre>
        </div>
      )}
      {list && list.commands.length > 0 && (
        <ul className="commands-card-list" aria-label="Commands">
          {list.commands.map((command) => (
            <li key={command.name}>
              <div className="commands-card-row">
                <code>/{command.name}</code>
                {command.argumentHint && <span className="faint">{command.argumentHint}</span>}
                <span className="commands-card-tags">
                  {command.send === "review" && <span className="suggest-badge">review first</span>}
                  {SHELL_LABELS[command.shell] && <span className={`suggest-badge${command.shell === "needs-trust" ? " commands-card-waiting" : ""}`}>{SHELL_LABELS[command.shell]}</span>}
                  <span className="suggest-badge">{COMMAND_SOURCE_LABELS[command.source]}</span>
                </span>
              </div>
              {command.description && <p className="commands-card-description">{command.description}</p>}
              <p className="commands-card-path" title={command.path}>{shown(command.path)}</p>
            </li>
          ))}
        </ul>
      )}
      {list && list.problems.length > 0 && (
        <details className="advanced commands-card-problems">
          <summary>{list.problems.length} {list.problems.length === 1 ? "problem" : "problems"} in command files</summary>
          <ul>
            {list.problems.map((problem, index) => (
              <li key={`${problem.path}-${index}`}>
                <span className="commands-card-path" title={problem.path}>{shown(problem.path)}</span>
                <span>{problem.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <h4 className="commands-card-subhead">Other tools' folders</h4>
      {FOREIGN_SOURCES.map((source) => (
        <SettingRow key={source.id} label={source.label} hint={`Read as Markdown only: ${source.hint}`}>
          <Switch label={source.label} checked={list?.sources[source.id] === true} disabled={!desktop} title={desktop ? undefined : "Change this on the desktop."} onChange={(on) => setSource(source.id, on)} />
        </SettingRow>
      ))}
    </div>
  );
}
