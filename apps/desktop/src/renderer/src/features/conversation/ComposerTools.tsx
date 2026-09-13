import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { HarnessLiveStatus, HarnessStatus, SessionRef } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { MenuSelect } from "../shell/MenuSelect";
import { XIcon } from "../shell/icons";
import { CapabilityDetails } from "../harness/CapabilityDetails";
import { AgentCommandsControl } from "./AgentCommandsControl";
import { useAnchoredPopover } from "../../lib/anchored-popover";

/** Secondary actions stay discoverable without competing with Attach and Send. */
export function ComposerTools({ harness, session, status, stashCount, onContext, onStash }: {
  harness?: HarnessStatus;
  session?: SessionRef;
  status?: HarnessLiveStatus;
  stashCount: number;
  onContext: (kind: "file" | "skill") => void;
  onStash: () => void;
}) {
  const { setAgentCommandsOpen } = useWorkspace();
  const [capabilitiesOpen, setCapabilitiesOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const capabilities = useRef<HTMLDivElement>(null);
  const position = useAnchoredPopover(capabilitiesOpen, root, capabilities);
  const focusTrigger = () => root.current?.querySelector<HTMLButtonElement>('[aria-label="Conversation tools"]')?.focus();
  useEffect(() => {
    if (!capabilitiesOpen) return;
    capabilities.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !capabilities.current?.contains(event.target as Node)) setCapabilitiesOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [capabilitiesOpen]);
  return <div className="composer-tools" ref={root}>
    <MenuSelect ariaLabel="Conversation tools" value="" placeholder="Conversation tools" iconOnly options={[
      { id: "file", label: "Mention a project file", detail: "@ · Search files in this workspace", group: "Context" },
      { id: "skill", label: "Attach a skill", detail: "$ · Choose an installed skill", group: "Context" },
      { id: "stash", label: "Prompt stash", detail: stashCount ? `${stashCount} saved prompts` : "Save or restore a draft", group: "Conversation" },
      ...(session?.harnessId ? [{ id: "commands", label: "Agent commands", detail: "Commands reported by this session", group: "Conversation" }] : []),
      ...(harness ? [{ id: "capabilities", label: "Agent settings and capabilities", detail: "Available controls and runtime limitations", group: "Conversation" }] : []),
    ]} onChange={(id) => {
      setCapabilitiesOpen(id === "capabilities");
      if (id === "commands") setAgentCommandsOpen(true);
      else if (id === "stash") onStash();
      else if (id === "file" || id === "skill") onContext(id);
    }} />
    {session?.harnessId && <AgentCommandsControl key={session.id} hideTrigger anchor={root} onReturnFocus={focusTrigger} />}
    {capabilitiesOpen && createPortal(<div ref={capabilities} style={position} className="composer-tools-popover" role="dialog" aria-label="Agent settings and capabilities"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setCapabilitiesOpen(false); focusTrigger(); }
      }}>
      <header><strong>Agent settings and capabilities</strong><button type="button" className="icon-btn" aria-label="Close agent capabilities" onClick={() => { setCapabilitiesOpen(false); focusTrigger(); }}><XIcon size={14} /></button></header>
      <CapabilityDetails harness={harness} session={session} status={status} initiallyOpen />
    </div>, document.body)}
  </div>;
}
