import { useState, type CSSProperties } from "react";
import type { ConfigFileTarget, ProfileSummary } from "@capsule/shared";
import { shortConfigPath } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { SettingRow } from "../settings/controls";
import { profileLine } from "./profile-view";
import "../conversation/commands.css";
import "./profiles.css";

/** Settings → Agents: the profiles that start a conversation in one pick. */
export function ProfilesCard() {
  const { api, project, projectId, config, configDiagnostics, harnesses, agents, startWithProfile } = useWorkspace();
  const [failure, setFailure] = useState<string>();
  const desktop = api.isDesktop === true;
  const canStart = desktop || api.remoteMode === "control";
  const profiles = config?.profiles ?? [];
  const named = harnesses.length ? harnesses : agents;
  const problems = (configDiagnostics?.problems ?? []).filter((problem) => /[\\/]profiles[\\/]/.test(problem.path));
  const run = (work: () => Promise<unknown>) => {
    setFailure(undefined);
    void work().catch((caught: unknown) => setFailure(formatUserError(caught)));
  };
  const create = (scope: "user" | "project", from?: string) => run(() => api.profilesCreate({ scope, ...(scope === "project" && projectId ? { projectId } : {}), ...(from ? { from } : {}) }));
  const open = (profile: ProfileSummary) => {
    const target: ConfigFileTarget = { kind: "resource", folder: "profiles", scope: profile.scope, name: profile.id, ...(profile.scope === "project" && projectId ? { projectId } : {}) };
    run(() => api.configOpenFile(target));
  };

  return (
    <div className="card commands-card profiles-card">
      <h3>Profiles</h3>
      <p className="muted">
        A profile starts a conversation with an agent, a model, an effort, a permission and standing instructions in one pick.
        Choose one from the composer's agent menu or the command palette, or bind a key to <code>profile:name</code>.
      </p>
      <div className="commands-card-actions">
        <button type="button" className="ghost" disabled={!desktop} onClick={() => create("user")}>New profile</button>
        <button type="button" className="ghost" disabled={!desktop || !project?.workingDirectory} title={project?.workingDirectory ? undefined : "Open a project with a folder first."}
          onClick={() => create("project")}>New {project?.name ?? "project"} profile</button>
      </div>
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
      {profiles.length === 0 && (
        <div className="commands-card-empty">
          <p>No profiles yet. New profile writes <code>profiles/new-profile.md</code> in your settings folder, starting from:</p>
          <pre>{"---\nname: Reviewer\nharness: codex\neffort: high\npermission: strict\nstyle: concise\n---\nLead with risks, then style."}</pre>
        </div>
      )}
      {profiles.length > 0 && (
        <ul className="commands-card-list" aria-label="Profiles">
          {profiles.map((profile) => (
            <li key={`${profile.scope}:${profile.id}`}>
              <div className="profiles-card-row">
                <span className="profile-dot" style={profile.color ? { "--profile-color": profile.color } as CSSProperties : undefined} aria-hidden="true" />
                <strong>{profile.name}</strong>
                <span className="suggest-badge">{profile.scope === "project" ? "Project" : "Yours"}</span>
                <span className="profiles-card-buttons">
                  <button type="button" className="chip" disabled={!canStart} title={canStart ? undefined : "Read only on this device."} onClick={() => void startWithProfile(profile.id)}>Start</button>
                  <button type="button" className="ghost" disabled={!desktop} onClick={() => create(profile.scope, profile.id)}>Duplicate</button>
                  <button type="button" className="ghost" disabled={!desktop} onClick={() => open(profile)}>Open file</button>
                </span>
              </div>
              <p className="profiles-card-line">{profileLine(profile, named)}{profile.style ? ` · ${profile.style} style` : ""}{profile.mcp ? ` · MCP: ${profile.mcp.length ? profile.mcp.join(", ") : "none"}` : ""}</p>
              {profile.description && <p className="commands-card-description">{profile.description}</p>}
              <p className="commands-card-path" title={profile.path}><bdi>{shortConfigPath(profile.path, api.homeDir || undefined)}</bdi></p>
            </li>
          ))}
        </ul>
      )}
      {problems.length > 0 && (
        <details className="advanced commands-card-problems">
          <summary>{problems.length} {problems.length === 1 ? "problem" : "problems"} in profile files</summary>
          <ul>
            {problems.map((problem, index) => (
              <li key={`${problem.path}-${index}`}>
                <span className="commands-card-path" title={problem.path}>{shortConfigPath(problem.path, api.homeDir || undefined)}</span>
                <span>{problem.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** The response style and personal instructions every conversation starts with. */
export function ResponseStyleCard() {
  const { api, config, configDiagnostics } = useWorkspace();
  const [failure, setFailure] = useState<string>();
  const desktop = api.isDesktop === true;
  const styles = config?.styles;
  const personal = styles?.personalInstructions;
  const personalProblem = configDiagnostics?.problems.find((problem) => problem.key === "personalInstructions");
  const run = (work: () => Promise<unknown>) => {
    setFailure(undefined);
    void work().catch((caught: unknown) => setFailure(formatUserError(caught)));
  };
  return (
    <div className="card">
      <h3>Response style</h3>
      <p className="muted">Sent once, before your first message in a conversation, with any agent. It is advice the agent reads, not a mode Capsule can enforce. A profile's own style wins.</p>
      <SettingRow label="Style" hint={styles?.styles.find((style) => style.id === styles.selected)?.description}>
        <select className="field-select" aria-label="Response style" disabled={!desktop || !styles} value={styles?.selected ?? "standard"}
          onChange={(event) => run(() => api.configSetValue({ key: "style", value: event.target.value, scope: "user" }))}>
          {styles?.styles.map((style) => <option key={style.id} value={style.id}>{style.name}{style.source === "builtin" ? "" : style.source === "project" ? " (project)" : " (yours)"}</option>)}
        </select>
      </SettingRow>
      <SettingRow label="Personal instructions" hint={personalProblem?.message ?? "A Markdown file sent with every conversation's first turn. A relative path is in your settings folder."}>
        <PathField key={personal ?? ""} value={personal ?? ""} disabled={!desktop}
          onSave={(value) => run(() => api.configSetValue({ key: "personalInstructions", value: value || undefined, scope: "user" }))} />
      </SettingRow>
      <div className="commands-card-actions">
        <button type="button" className="ghost" disabled={!desktop} onClick={() => run(() => api.configOpenFile({ kind: "folder", folder: "styles", scope: "user" }))}>Open your styles folder</button>
      </div>
      {failure && <p className="commands-card-error" role="alert">{failure}</p>}
    </div>
  );
}

function PathField(props: { value: string; disabled: boolean; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  const save = () => { if (draft.trim() !== props.value) props.onSave(draft.trim()); };
  return <input className="field-select" aria-label="Personal instructions file" placeholder="~/notes/agents.md" spellCheck={false} disabled={props.disabled}
    value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === "Enter") save(); }} />;
}
