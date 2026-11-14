import { useState } from "react";
import { parsePermissionRule, type PermissionList, type Provenance } from "@capsule/shared";
import { shortConfigPath } from "../../lib/config-view";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import "./customization.css";

const LISTS: Array<{ list: PermissionList; label: string; hint: string }> = [
  { list: "deny", label: "Deny", hint: "Refused without asking." },
  { list: "ask", label: "Ask", hint: "Always shown to you, even when an allow rule matches." },
  { list: "allow", label: "Allow", hint: "Approved once without asking." },
];

const SCOPE_LABELS: Record<Provenance["scope"], string> = {
  user: "You",
  project: "Project",
  local: "Project, only me",
  legacy: "capsule.json",
  plugin: "Plugin",
  default: "Built in",
};

/**
 * Settings → Agents → Permission rules. Behind an expansion: it is
 * governance, not something a new conversation needs. Each rule shows its
 * file; rules in your own files can be removed here, the team's file is
 * edited by hand. Read-only on a paired device.
 */
export function PermissionRulesCard() {
  const { api, config, configDiagnostics: diagnostics, projectId } = useWorkspace();
  const [text, setText] = useState("");
  const [list, setList] = useState<PermissionList>("allow");
  const [scope, setScope] = useState<"user" | "local">("user");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const desktop = api.isDesktop === true;
  const home = window.capsule?.homeDir;
  const project = config?.project?.projectId === projectId ? config?.project : undefined;
  const permissions = diagnostics?.permissions;
  const held = (diagnostics?.trust?.pending ?? []).filter((item) => item.kind === "permission-allow");
  const total = permissions ? permissions.allow.length + permissions.ask.length + permissions.deny.length : 0;
  const parsed = text.trim() ? parsePermissionRule(text) : undefined;

  function act(work: () => Promise<unknown>) {
    setError(undefined);
    setBusy(true);
    void work().catch((caught: unknown) => setError(formatUserError(caught))).finally(() => setBusy(false));
  }

  function add() {
    if (!parsed?.ok) return;
    act(async () => {
      await api.configEditPermissionRule({ op: "add", list, rule: parsed.rule.text, scope, ...(scope === "local" ? { projectId: project?.projectId } : {}) });
      setText("");
    });
  }

  return (
    <div className="card permission-rules">
      <details>
        <summary>
          <h3>Permission rules</h3>
          <span className="permission-rules-count">{diagnostics?.safeMode ? "Off in safe mode" : total === 0 ? "None" : `${total} ${total === 1 ? "rule" : "rules"}`}</span>
        </summary>
        <p className="muted">
          Rules answer an agent's permission requests before they reach you, for every agent Capsule drives. Deny wins over ask, and ask over allow.
          Each answer is noted in the turn's work log.
        </p>
        {LISTS.map(({ list: name, label, hint }) => {
          const rules = permissions?.[name] ?? [];
          const waiting = name === "allow" ? held : [];
          return (
            <section key={name} className="permission-list">
              <h4 className="doctor-heading">{label}<span className="permission-list-hint">{hint}</span></h4>
              {rules.length === 0 && waiting.length === 0 ? (
                <p className="doctor-empty">No {label.toLowerCase()} rules.</p>
              ) : (
                <ul className="doctor-list">
                  {rules.map((entry, index) => {
                    const own = entry.source.scope === "user" || entry.source.scope === "local";
                    return (
                      <li key={`${entry.value}:${entry.source.path}:${index}`} className="permission-rule">
                        <code>{entry.value}</code>
                        <span className="doctor-scope" title={entry.source.path}>{SCOPE_LABELS[entry.source.scope]}</span>
                        {desktop && own ? (
                          <button type="button" className="ghost doctor-open" disabled={busy}
                            aria-label={`Remove ${entry.value}`}
                            onClick={() => act(() => api.configEditPermissionRule({ op: "remove", list: name, rule: entry.value, scope: entry.source.scope as "user" | "local", ...(entry.source.scope === "local" ? { projectId: project?.projectId } : {}) }))}>
                            Remove
                          </button>
                        ) : <span className="permission-rule-file">{entry.source.path ? shortConfigPath(entry.source.path, home) : ""}</span>}
                      </li>
                    );
                  })}
                  {waiting.map((item, index) => (
                    <li key={`held:${item.detail}:${index}`} className="permission-rule is-held">
                      <code>{item.detail}</code>
                      <span className="doctor-state is-untrusted">Waiting for trust</span>
                      <span className="permission-rule-file" title={item.path}>{shortConfigPath(item.path, home)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
        {desktop && !diagnostics?.safeMode && (
          <form className="permission-add" onSubmit={(event) => { event.preventDefault(); add(); }}>
            <h4 className="doctor-heading">Add a rule</h4>
            <div className="permission-add-row">
              <select className="field-select" aria-label="List" value={list} onChange={(event) => setList(event.target.value as PermissionList)}>
                {LISTS.map((item) => <option key={item.list} value={item.list}>{item.label}</option>)}
              </select>
              <input type="text" className="permission-add-text" aria-label="Rule" placeholder="execute(pnpm test *)" spellCheck={false}
                value={text} onChange={(event) => setText(event.target.value)} />
              <select className="field-select" aria-label="Save to" value={scope} onChange={(event) => setScope(event.target.value as "user" | "local")}>
                <option value="user">You, everywhere</option>
                <option value="local" disabled={!project}>This project, only me</option>
              </select>
              <button type="submit" className="chip" disabled={busy || !parsed?.ok}>Add</button>
            </div>
            <p className={parsed && !parsed.ok ? "doctor-error" : "doctor-keys"}>
              {parsed && !parsed.ok ? parsed.message : "A kind and what it covers: execute(git status), edit(**/.env*), fetch(domain:github.com), mcp(browser:*)."}
            </p>
          </form>
        )}
        {error && <div className="notice" role="alert">{error}</div>}
      </details>
    </div>
  );
}
