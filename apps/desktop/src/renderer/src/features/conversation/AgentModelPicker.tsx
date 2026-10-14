import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Agent, HarnessStatus, AcpModelCatalog, FeatureAvailability } from "@capsule/shared";
import { AgentGlyph } from "../shell/AgentGlyph";
import { ChevronDownIcon, SearchIcon, XIcon } from "../shell/icons";
import { useAnchoredPopover } from "../../lib/anchored-popover";
import { readModelFavorites, modelFavoriteKey } from "../../lib/model-favorites";

/** Catalogs belong to an installed agent, not a hardcoded list of providers. */
export function AgentModelPicker(props: {
  agents: Agent[]; harnesses: HarnessStatus[]; agentId: string; liveHarnessId?: string;
  models?: AcpModelCatalog; currentModel: string; availability: FeatureAvailability;
  onAgent: (id: string) => void; onModel: (id: string) => void;
  loading?: boolean; error?: string; onRetry?: () => void;
  onManage?: () => void; onOpenChange?: (open: boolean) => void; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [choosingHarness, setChoosingHarness] = useState(false);
  const [favorites, setFavorites] = useState(readModelFavorites);
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const position = useAnchoredPopover(open, anchor, panel, "start");
  const agents = props.harnesses.length ? props.harnesses : props.agents;
  const agent = agents.find((item) => item.id === props.agentId) ?? props.agents.find((item) => item.id === props.agentId);
  const harness = props.harnesses.find((item) => item.id === props.agentId);
  const preferred = agents.filter((item) => item.id === props.agentId || ["codex", "claude", "grok"].includes(item.id));
  const rail = preferred.length ? preferred.slice(0, 4) : agents.slice(0, 4);
  const knownModel = props.models?.availableModels.find((item) => item.modelId === props.currentModel);
  const models = props.models?.availableModels ?? [];
  const needle = query.trim().toLowerCase();
  const favorite = (id: string) => favorites.includes(modelFavoriteKey(props.agentId, id));
  const filtered = models.filter((model) => (!favoritesOnly || favorite(model.modelId)) && (!model.isLegacy || showLegacy || Boolean(needle))
    && `${model.name} ${model.modelId}`.toLowerCase().includes(needle));
  function close() { setOpen(false); anchor.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
  useEffect(() => { props.onOpenChange?.(open); return () => props.onOpenChange?.(false); }, [open, props.onOpenChange]);
  useEffect(() => {
    if (!open) return;
    search.current?.focus();
    const dismiss = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  function toggleFavorite(id: string) {
    const key = modelFavoriteKey(props.agentId, id);
    const next = favorite(id) ? favorites.filter((item) => item !== key) : [...favorites, key].slice(-100);
    setFavorites(next);
    try { localStorage.setItem("capsule.model-favorites", JSON.stringify(next)); } catch { /* In-memory favorites still work when storage is unavailable. */ }
  }
  return <div className="menu-select" ref={anchor}>
    <button type="button" className="menu-select-trigger" aria-label="Agent and model" aria-haspopup="dialog" aria-expanded={open}
      onClick={() => setOpen((value) => !value)}>
      {agent && <AgentGlyph id={agent.id} name={agent.name} />}<span>{knownModel?.name ?? (props.currentModel || agent?.name || "Choose agent")}</span><ChevronDownIcon size={12} />
    </button>
    {open && createPortal(<div className="agent-model-picker" ref={panel} style={position} role="dialog" aria-label="Choose agent and model"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        if (event.key === "Tab") {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input') ?? []);
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          if ((event.key === "Home" || event.key === "End") && event.target === search.current) return;
          const rows = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[data-model-choice]:not(:disabled), [data-harness-choice]:not(:disabled)') ?? []);
          if (!rows.length) return;
          event.preventDefault();
          const index = rows.findIndex((row) => row === document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index < 0
            ? event.key === "ArrowUp" ? rows.length - 1 : 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
          rows[next]?.focus();
        }
      }}>
      <header><SearchIcon size={14} /><input ref={search} aria-label={choosingHarness ? "Search harnesses" : "Search models"} placeholder={choosingHarness ? "Search harnesses…" : "Search models…"} value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="icon-btn" aria-label="Close model picker" onClick={close}><XIcon size={14} /></button></header>
      <div className="agent-model-picker-body">
        <nav aria-label="Agents">
          <button type="button" aria-label="Favorite models" aria-pressed={favoritesOnly && !choosingHarness} onClick={() => { setChoosingHarness(false); setFavoritesOnly((value) => !value); }}>☆</button>
          {rail.map((item) => <button type="button" key={item.id} aria-label={item.name} title={item.name} aria-pressed={item.id === props.agentId && !favoritesOnly && !choosingHarness}
            disabled={props.disabled || Boolean(props.liveHarnessId && props.liveHarnessId !== item.id)}
            onClick={() => { props.onAgent(item.id); setChoosingHarness(false); setFavoritesOnly(false); setQuery(""); setShowLegacy(false); }}><AgentGlyph id={item.id} name={item.name} /></button>)}
          <button type="button" aria-label="All harnesses" title="All harnesses" aria-pressed={choosingHarness} onClick={() => { setChoosingHarness((value) => !value); setQuery(""); }}>…</button>
        </nav>
        <section aria-label={`${agent?.name ?? "Agent"} models`}>
          {choosingHarness ? <>
            <p className="agent-model-heading">Harnesses</p>
            {props.liveHarnessId && <small className="agent-model-note">Start a new conversation to switch harnesses.</small>}
            {agents.filter((item) => item.name.toLowerCase().includes(needle)).map((item) => {
              const status = props.harnesses.find((candidate) => candidate.id === item.id);
              return <button type="button" className="agent-harness-choice" data-harness-choice key={item.id}
                disabled={props.disabled || Boolean(props.liveHarnessId && props.liveHarnessId !== item.id)}
                onClick={() => { props.onAgent(item.id); setChoosingHarness(false); setFavoritesOnly(false); setQuery(""); }}>
                <AgentGlyph id={item.id} name={item.name} /><span>{item.name}<small>{status?.readiness === "missing_cli" ? "Setup required" : status?.readiness === "needs_login" ? "Sign-in required" : status?.binaryPath ? "Installed" : status?.detail ?? ""}</small></span>
              </button>;
            })}
            {props.onManage && <button type="button" className="agent-model-manage" onClick={() => { close(); props.onManage?.(); }}>Manage harnesses</button>}
          </> : <>
          <p className="agent-model-heading">{agent?.name ?? "Select an agent"}{favoritesOnly ? " · Favorites" : ""}</p>
          {filtered.map((model) => <div className="agent-model-row" key={model.modelId}>
            <button type="button" data-model-choice aria-pressed={model.modelId === props.currentModel}
              disabled={props.disabled || props.availability.state === "unavailable"}
              onClick={() => { props.onModel(model.modelId); close(); }}><span>{model.name}</span><small>{model.modelId}</small></button>
            <button type="button" className="model-favorite" aria-label={`${favorite(model.modelId) ? "Unfavorite" : "Favorite"} ${model.name}`} aria-pressed={favorite(model.modelId)} onClick={() => toggleFavorite(model.modelId)}>{favorite(model.modelId) ? "★" : "☆"}</button>
          </div>)}
          {!filtered.length && <p className="agent-model-empty" role="status">{props.loading ? "Loading models…" : props.error ?? (models.length ? "No matching models." : harness?.readiness === "missing_cli" ? harness.detail : props.liveHarnessId ? props.availability.detail : "This agent has not reported model choices. Its default will be used.")}</p>}
          {props.error && props.onRetry && <button type="button" className="chip" onClick={props.onRetry}>Retry</button>}
          {!models.length && harness?.readiness === "missing_cli" && props.onManage && <button type="button" className="chip" onClick={() => { close(); props.onManage?.(); }}>Set up harness</button>}
          {models.some((model) => model.isLegacy) && !needle && <button type="button" className="ghost" aria-expanded={showLegacy} onClick={() => setShowLegacy((value) => !value)}>{showLegacy ? "Hide" : "Show"} legacy models</button>}
          </>}
        </section>
      </div>
    </div>, document.body)}
  </div>;
}
