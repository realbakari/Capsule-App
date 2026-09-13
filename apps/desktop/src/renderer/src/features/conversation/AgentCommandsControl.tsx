import { useEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useAnchoredPopover } from "../../lib/anchored-popover";
import { useWorkspace } from "../../lib/workspace";

/** Agent commands are normal, separate turns. They never consume the draft. */
export function AgentCommandsControl({ hideTrigger = false, onReturnFocus, anchor }: { hideTrigger?: boolean; onReturnFocus?: () => void; anchor?: RefObject<HTMLElement | null> }) {
  const { api, session, harnessStatuses, runAgentCommand, activeRun, busy, preparingAttachments, agentCommandsOpen, setAgentCommandsOpen } = useWorkspace();
  const [editing, setEditing] = useState<{ owner: string; command: string; input: string }>();
  const details = useRef<HTMLDetailsElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const position = useAnchoredPopover(agentCommandsOpen, anchor ?? details, panel);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => { if (!details.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node) && details.current?.open) setAgentCommandsOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => { document.removeEventListener("pointerdown", dismiss); };
  }, [setAgentCommandsOpen]);
  useEffect(() => { if (agentCommandsOpen) (panel.current?.querySelector("select") ?? panel.current?.querySelector("button"))?.focus(); }, [agentCommandsOpen]);
  const direct = session?.openclawSessionKey?.startsWith("direct:acp:");
  const commands = direct && session ? harnessStatuses[session.id]?.parsed?.availableCommands : undefined;
  const owner = JSON.stringify([session?.id, session?.harnessId, session?.openclawSessionKey]);
  const currentEdit = editing?.owner === owner ? editing : undefined;
  const selected = commands?.find((command) => command.name === currentEdit?.command) ?? commands?.[0];
  // A dynamically removed command or changed runtime cannot lend its input
  // to the command now shown in the picker.
  const input = currentEdit?.command === selected?.name ? currentEdit?.input ?? "" : "";
  return <details className="agent-command-control" ref={details} open={agentCommandsOpen} hidden={hideTrigger && !agentCommandsOpen} onKeyDown={(event) => {
    if (event.key === "Escape" && details.current?.open) { event.preventDefault(); event.stopPropagation(); setAgentCommandsOpen(false); if (hideTrigger) onReturnFocus?.(); else details.current.querySelector("summary")?.focus(); }
  }}>
    <summary hidden={hideTrigger} aria-label="Agent commands" title="Agent commands" onClick={(event) => { event.preventDefault(); setAgentCommandsOpen(!agentCommandsOpen); }}>Agent commands</summary>
    {agentCommandsOpen && createPortal(<div ref={panel} style={position} className="agent-command-popover" role="dialog" aria-label="Agent commands">
      <header><strong>Agent commands</strong><button type="button" className="ghost" onClick={() => { setAgentCommandsOpen(false); onReturnFocus?.(); }}>Close</button></header>
      {!commands?.length ? <p className="meta">{!direct ? "Command discovery is available for direct agents that report their commands. This runtime route does not provide a command list." : commands ? "This agent currently advertises no commands." : "The agent has not reported its commands yet."}</p> : <>
        <select aria-label="Select agent command" value={selected?.name} onChange={(event) => { setEditing({ owner, command: event.target.value, input: "" }); }}>
          {commands.map((command) => <option key={command.name} value={command.name}>/{command.name}</option>)}
        </select>
        <p className="meta">{selected?.description}</p>
        {selected?.inputHint !== undefined && <input aria-label="Command input" placeholder={selected.inputHint || "Command input"} maxLength={4000} value={input} onChange={(event) => setEditing({ owner, command: selected.name, input: event.target.value })} />}
        <p className="meta">Runs as a separate turn. Your draft and attachments stay here.</p>
        {api.isDesktop === false && <p className="meta">Send commands from the desktop app; this viewer is read-only.</p>}
        <button type="button" disabled={Boolean(activeRun || busy || preparingAttachments || api.isDesktop === false)} onClick={async () => {
          if (selected && await runAgentCommand(selected.name, selected.inputHint !== undefined ? input : "")) {
            setAgentCommandsOpen(false);
            setEditing(undefined);
            onReturnFocus?.();
          }
        }}>Run command</button>
      </>}
    </div>, document.body)}
  </details>;
}
