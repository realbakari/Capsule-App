import { HOOK_EVENTS, type ConfigDiagnostics } from "@capsule/shared";
import { shortConfigPath } from "../../lib/config-view";

/**
 * The doctor's Hooks section: every hook in effect, its file, whether it is
 * on, and how its last run went. The files are the editor; this is the view.
 */
export function HooksList({ diagnostics, home }: { diagnostics: ConfigDiagnostics; home?: string }) {
  const rows = HOOK_EVENTS.flatMap((event) =>
    (diagnostics.hooks[event] ?? []).flatMap(({ value: group, source }) =>
      group.hooks.map((handler) => {
        const target = handler.type === "command" ? handler.command : handler.url;
        const label = group.matcher ? `${event} (${group.matcher})` : event;
        const runs = diagnostics.runs.filter((run) => run.kind === "hook" && run.label === label && run.command === target && run.source === source.path);
        return { event, matcher: group.matcher, target, type: handler.type, source, runs };
      })));
  return (
    <>
      <h4 className="doctor-heading">Hooks</h4>
      {rows.length === 0 ? (
        <p className="doctor-empty">
          {diagnostics.safeMode ? "Safe mode runs no hooks." : "No hooks. Add them under \"hooks\" in a settings file."}
        </p>
      ) : (
        <ul className="doctor-list">
          {diagnostics.hooksDisabled && <li className="doctor-empty">Every hook is off: disableAllHooks is set in a settings file.</li>}
          {rows.map((row, index) => {
            const last = row.runs.at(-1);
            return (
              <li key={`${row.event}:${row.target}:${index}`} className="hook-row">
                <span className="doctor-scope">{row.event}{row.matcher ? <span className="hook-matcher"> {row.matcher}</span> : null}</span>
                <span className={`doctor-state ${diagnostics.hooksDisabled ? "is-skipped" : "is-ok"}`}>{diagnostics.hooksDisabled ? "Off" : "On"}</span>
                <code className="hook-target" title={row.target}>{row.type === "http" ? `POST ${row.target}` : row.target}</code>
                <span className="doctor-keys hook-meta">
                  {row.source.path ? shortConfigPath(row.source.path, home) : row.source.scope}
                  {" · "}
                  {last ? `${row.runs.length} recent ${row.runs.length === 1 ? "run" : "runs"}, last ${last.outcome ?? (last.exitCode === 0 ? "ok" : `exit ${last.exitCode}`)}` : "not run yet"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
