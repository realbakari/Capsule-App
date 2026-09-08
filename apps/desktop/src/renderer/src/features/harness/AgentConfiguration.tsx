import { useEffect, useRef, useState } from "react";
import type { AcpConfigOption } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";

/** Shared by composer capabilities and Harnesses; no optimistic policy changes. */
export function AgentConfiguration({ sessionId, options }: { sessionId: string; options: AcpConfigOption[] }) {
  const { api, refreshHarnessStatus } = useWorkspace();
  const readOnly = api.isDesktop !== true;
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const active = useRef(true);
  const saving = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function change(id: string, value: string | boolean) {
    if (saving.current || readOnly) return;
    saving.current = true; setPending(id); setError(undefined);
    try { await api.setHarnessConfig(sessionId, id, value); }
    catch (failure) { if (active.current) setError(formatUserError(failure)); }
    finally {
      // Refresh even on rejection: the agent may have changed dependent values.
      try { await refreshHarnessStatus(sessionId); }
      catch (failure) { if (active.current) setError((previous) => previous ?? formatUserError(failure)); }
      finally {
        saving.current = false;
        if (active.current) setPending(undefined);
      }
    }
  }
  return <details className="advanced agent-configuration">
    <summary>Agent settings · {options.length}</summary>
    <p className="faint">These are the agent's own settings. Read its descriptions before changing modes or permissions. Only acknowledged values are shown.</p>
    {readOnly && <p className="faint">Change agent settings from the desktop app. This viewer is read-only.</p>}
    {options.map((option) => <label key={option.id} className="agent-config-row">
      <span>{option.name}{option.description && <small>{option.description}</small>}</span>
      {option.type === "boolean" ? <input type="checkbox" checked={option.booleanValue === true} disabled={readOnly || Boolean(pending) || option.booleanValue === undefined}
        onChange={(event) => void change(option.id, event.target.checked)} />
        : <select value={option.currentValue ?? ""} disabled={readOnly || Boolean(pending) || !option.choices.length} onChange={(event) => void change(option.id, event.target.value)}>
          {!option.choices.some((choice) => choice.value === option.currentValue) && <option value={option.currentValue ?? ""} disabled>{option.currentValue ?? "Not reported"}</option>}
          {option.choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.name}</option>)}
        </select>}
    </label>)}
    {pending && <p role="status" className="faint">Applying setting…</p>}
    {error && <p role="alert">{error}</p>}
  </details>;
}
