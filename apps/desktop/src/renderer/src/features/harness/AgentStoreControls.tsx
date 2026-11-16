import type { HarnessId } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { useAgentStore } from "./agent-store";
import "./agent-store.css";

/**
 * Install, update or remove one agent from inside Capsule. Nothing happens
 * until a button is pressed. A copy the user installed is named, never touched.
 * `inline` is the one-line form for the composer notice and first run.
 */
export function AgentStoreControls({ harnessId, name, inline = false }: { harnessId: HarnessId; name: string; inline?: boolean }) {
  const { setConfirm } = useWorkspace();
  const store = useAgentStore();
  const row = store.row(harnessId);
  const act = store.enabled;

  switch (row.kind) {
    case "none":
      return null;
    case "user":
      return inline ? null : <p className="agent-store-note">Installed by you at <code title={row.path}>{row.path}</code></p>;
    case "unavailable":
      return <p className="agent-store-note">{row.reason}</p>;
    case "busy":
      return <div className="agent-store agent-store-busy" role="status" aria-live="polite">
        <span className="agent-store-label">{row.label}{row.bytes ? <span className="agent-store-bytes"> · {row.bytes}</span> : "…"}</span>
        <span className="agent-store-meter" aria-hidden data-indeterminate={row.fraction === undefined || undefined}>
          <span style={row.fraction === undefined ? undefined : { width: `${Math.round(row.fraction * 100)}%` }} />
        </span>
      </div>;
    case "failed":
      return <div className="agent-store" role="alert">
        <span className="agent-store-error" title={row.error}>{row.error}</span>
        {act && row.canRetry ? <button type="button" className="chip" onClick={() => void store.install(harnessId)}>Try again</button> : null}
      </div>;
    case "offer":
      return act
        ? <div className="agent-store">
          <button type="button" className={inline ? "chip" : "send"} onClick={() => void store.install(harnessId)}>Install</button>
          <span className="agent-store-caption">v{row.version} {row.from}</span>
        </div>
        : <p className="agent-store-note">Capsule can install v{row.version} {row.from} on the computer running it.</p>;
    case "installed":
      if (inline && !row.update) return null;
      return <div className="agent-store">
        <span className="agent-store-caption">Installed by Capsule · v{row.version}</span>
        {act && row.update ? <button type="button" className="chip" onClick={() => void store.install(harnessId)}>Update to v{row.update}</button> : null}
        {act && !inline ? <button type="button" className="ghost" onClick={() => setConfirm({
          title: `Remove ${name}?`,
          detail: `Capsule deletes the copy of ${name} it installed. Conversations that use it can't start until it is installed again.`,
          danger: true,
          confirmLabel: "Remove",
          onConfirm: () => { setConfirm(undefined); void store.uninstall(harnessId); },
        })}>Remove</button> : null}
      </div>;
  }
}

/** Whether the store can install this agent here and now, for callers that offer Install in place of instructions. */
export function useCanInstall(harnessId: HarnessId): boolean {
  const store = useAgentStore();
  const row = store.row(harnessId);
  return store.enabled && (row.kind === "offer" || row.kind === "busy" || row.kind === "failed");
}
