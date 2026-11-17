import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { modelFavoriteKey, type Agent, type HarnessStatus, type AcpModelCatalog, type FeatureAvailability, type ProfileSummary, type TurnMode } from "@capsule/shared";
import { profileLine } from "../customization/profile-view";
import { AgentGlyph } from "../shell/AgentGlyph";
import { CheckIcon, SearchIcon, StarIcon } from "../shell/icons";
import { useAnchoredPopover } from "../../lib/anchored-popover";
import { agentReadinessReason } from "../../lib/harness-preflight";

/* ⌘1 to ⌘9 pick the first visible models while the picker is open. */
const JUMP_KEYS = 9;

/**
 * One popover in three columns: agents on a rail, the chosen agent's models,
 * and the reasoning settings for the current model. Permissions sit in a row
 * under all three. Catalogs belong to an installed agent, not a hardcoded list
 * of providers.
 */
export function AgentModelPicker(props: {
  agents: Agent[]; harnesses: HarnessStatus[]; agentId: string; liveHarnessId?: string;
  models?: AcpModelCatalog; currentModel: string; availability: FeatureAvailability;
  onAgent: (id: string) => void; onModel: (id: string) => void;
  loading?: boolean; error?: string; onRetry?: () => void;
  onManage?: () => void; onOpenChange?: (open: boolean) => void; disabled?: boolean;
  /** Favorite keys from settings; without a toggle the stars are read-only. */
  favorites?: readonly string[]; onToggleFavorite?: (modelId: string) => void;
  /** The models saved for Plan and Act with this agent. */
  modeModels?: { plan?: string; act?: string }; onModeModel?: (mode: TurnMode, modelId: string) => void;
  /** Profiles start a new conversation, so they sit above the raw agents. */
  profiles?: ProfileSummary[]; onProfile?: (id: string) => void;
  /** What else shapes the turn, such as effort, shown after the model on the trigger. */
  detail?: string;
  /** The Reasoning column's body: effort levels, or why there are none here. */
  reasoning?: ReactNode;
  /** The control in the row under the columns. */
  permissions?: ReactNode;
  /** The labels of the settings inside, so a shortcut knows which it can reach. */
  settingLabels?: readonly string[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [choosingHarness, setChoosingHarness] = useState(false);
  const favorites = props.favorites ?? [];
  const anchor = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const position = useAnchoredPopover(open, anchor, panel, "end", 576);
  const agents = props.harnesses.length ? props.harnesses : props.agents;
  const agent = agents.find((item) => item.id === props.agentId) ?? props.agents.find((item) => item.id === props.agentId);
  const harness = props.harnesses.find((item) => item.id === props.agentId);
  /* A model list that failed for want of a login is a dead end without the way to sign in. */
  const needsSignIn = harness?.readiness === "needs_login" || /auth|sign.?in|log.?in/i.test(props.error ?? "");
  const preferred = agents.filter((item) => item.id === props.agentId || ["codex", "claude", "grok"].includes(item.id));
  const rail = preferred.length ? preferred.slice(0, 4) : agents.slice(0, 4);
  const knownModel = props.models?.availableModels.find((item) => item.modelId === props.currentModel);
  const modelName = knownModel?.name ?? (props.currentModel || agent?.name);
  const models = props.models?.availableModels ?? [];
  const needle = query.trim().toLowerCase();
  const favorite = (id: string) => favorites.includes(modelFavoriteKey(props.agentId, id));
  const filtered = models.filter((model) => (!favoritesOnly || favorite(model.modelId)) && (!model.isLegacy || showLegacy || Boolean(needle))
    && `${model.name} ${model.modelId}`.toLowerCase().includes(needle));
  const modelsLocked = props.disabled || props.availability.state === "unavailable";
  const jumpable = modelsLocked ? [] : filtered.slice(0, JUMP_KEYS);
  function close() { setOpen(false); anchor.current?.querySelector<HTMLButtonElement>("button")?.focus(); }
  function pick(modelId: string) { props.onModel(modelId); close(); }
  function railTitle(item: { id: string; name: string }) {
    if (props.liveHarnessId && props.liveHarnessId !== item.id) return `${item.name}: Start a new conversation to switch agents.`;
    const status = props.harnesses.find((candidate) => candidate.id === item.id);
    const reason = status && agentReadinessReason(status);
    return reason ? `${item.name}: Unavailable. ${status.detail || reason}` : item.name;
  }
  useEffect(() => { props.onOpenChange?.(open); return () => props.onOpenChange?.(false); }, [open, props.onOpenChange]);
  /* Search takes focus once the popover is placed: a hidden element cannot take it. */
  useEffect(() => {
    if (open && position.visibility === "visible" && !panel.current?.contains(document.activeElement)) search.current?.focus();
  }, [open, position.visibility]);
  useEffect(() => {
    if (!open) return;
    /* A setting's own popover opens outside the panel; choosing from it is not a click away. */
    const insideNested = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest(".menu-select-pop, .permissions-pop"));
    const dismiss = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node) && !insideNested(event.target)) setOpen(false); };
    /* Escape closes it even when focus has left the panel (a click on its padding, a disabled row), but a nested popover closes first. */
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented && !document.querySelector(".menu-select-pop, .permissions-pop")) { event.preventDefault(); close(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="menu-select agent-model-select" ref={anchor}>
    <button type="button" className="menu-select-trigger agent-model-trigger" aria-label="Agent and model" aria-haspopup="dialog" aria-expanded={open}
      data-settings={props.settingLabels?.join("|") || undefined}
      title={open ? undefined : [modelName, props.detail].filter(Boolean).join(" · ") || undefined}
      onClick={() => setOpen((value) => !value)}>
      {agent && <AgentGlyph id={agent.id} name={agent.name} />}<span>{modelName || "Choose agent"}</span>
      {props.detail ? <span className="agent-model-trigger-detail">{props.detail}</span> : null}
    </button>
    {open && createPortal(<div className="agent-model-picker" ref={panel} style={position} role="dialog" aria-label="Choose agent and model"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
        if (event.metaKey && !event.shiftKey && !event.altKey && !event.ctrlKey && /^[1-9]$/.test(event.key) && !choosingHarness) {
          const target = jumpable[Number(event.key) - 1];
          if (target) { event.preventDefault(); event.stopPropagation(); pick(target.modelId); }
          return;
        }
        if (event.key === "Tab") {
          const controls = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input') ?? []);
          if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
          else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
        }
        const inFooter = event.target instanceof Element && event.target.closest(".agent-model-picker-footer");
        /* Right from a model reaches the Reasoning column; left from there comes back to the chosen model. */
        if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && event.target instanceof Element && event.target !== search.current && !inFooter) {
          const fromReasoning = Boolean(event.target.closest(".agent-model-reasoning"));
          const target = event.key === "ArrowRight" && !fromReasoning ? panel.current?.querySelector<HTMLElement>('.agent-model-reasoning [tabindex="0"]')
            : event.key === "ArrowLeft" && fromReasoning ? panel.current?.querySelector<HTMLElement>('[data-model-choice][aria-pressed="true"]:not(:disabled)') ?? panel.current?.querySelector<HTMLElement>("[data-model-choice]:not(:disabled)") ?? search.current : undefined;
          if (target) { event.preventDefault(); target.focus(); }
          return;
        }
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          if ((event.key === "Home" || event.key === "End") && event.target === search.current) return;
          if (inFooter) return;
          const inRail = event.target instanceof Element && event.target.closest(".agent-model-rail");
          const rows = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>(inRail ? ".agent-model-rail button:not(:disabled)" : '[data-model-choice]:not(:disabled), [data-harness-choice]:not(:disabled)') ?? []);
          if (!rows.length) return;
          event.preventDefault();
          const index = rows.findIndex((row) => row === document.activeElement);
          const next = event.key === "Home" ? 0 : event.key === "End" ? rows.length - 1 : index < 0
            ? event.key === "ArrowUp" ? rows.length - 1 : 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length;
          rows[next]?.focus();
        }
      }}>
      <div className="agent-model-picker-body">
        <nav aria-label="Agents" className="agent-model-rail">
          <button type="button" className="agent-model-rail-favorites" aria-label="Favorite models" title="Favorite models" aria-pressed={favoritesOnly && !choosingHarness}
            onClick={() => { setChoosingHarness(false); setFavoritesOnly((value) => !value); }}><StarIcon size={18} /></button>
          <span className="agent-model-rail-rule" aria-hidden="true" />
          {rail.map((item) => <button type="button" key={item.id} aria-label={item.name} title={railTitle(item)} aria-pressed={item.id === props.agentId && !favoritesOnly && !choosingHarness}
            disabled={props.disabled || Boolean(props.liveHarnessId && props.liveHarnessId !== item.id)}
            onClick={() => { props.onAgent(item.id); setChoosingHarness(false); setFavoritesOnly(false); setQuery(""); setShowLegacy(false); }}><AgentGlyph id={item.id} name={item.name} size={18} /></button>)}
          <button type="button" aria-label="All agents" title="All agents" aria-pressed={choosingHarness} onClick={() => { setChoosingHarness((value) => !value); setQuery(""); }}>…</button>
        </nav>
        <section className="agent-model-list" aria-label={`${agent?.name ?? "Agent"} models`}>
          <header className="agent-model-search"><SearchIcon size={14} /><input ref={search} aria-label={choosingHarness ? "Search agents" : "Search models"} placeholder={choosingHarness ? "Search agents…" : "Search models…"} value={query} onChange={(event) => setQuery(event.target.value)} /></header>
          <div className="agent-model-rows">
          {choosingHarness ? <>
            {props.onProfile && props.profiles?.some((profile) => `${profile.name} ${profile.description ?? ""}`.toLowerCase().includes(needle)) && <>
              <p className="agent-model-heading">Profiles</p>
              {props.profiles.filter((profile) => `${profile.name} ${profile.description ?? ""}`.toLowerCase().includes(needle)).map((profile) =>
                <button type="button" className="agent-harness-choice agent-profile-choice" data-harness-choice key={profile.id} disabled={props.disabled}
                  title={profile.description} onClick={() => { close(); props.onProfile?.(profile.id); }}>
                  <span className="profile-dot" style={profile.color ? { "--profile-color": profile.color } as CSSProperties : undefined} aria-hidden="true" />
                  <span>{profile.name}<small>{profileLine(profile, agents)}</small></span>
                </button>)}
            </>}
            <p className="agent-model-heading">Agents</p>
            {props.liveHarnessId && <small className="agent-model-note">Start a new conversation to switch agents.</small>}
            {agents.filter((item) => item.name.toLowerCase().includes(needle)).map((item) => {
              const status = props.harnesses.find((candidate) => candidate.id === item.id);
              return <button type="button" className="agent-harness-choice" data-harness-choice key={item.id}
                disabled={props.disabled || Boolean(props.liveHarnessId && props.liveHarnessId !== item.id)}
                onClick={() => { props.onAgent(item.id); setChoosingHarness(false); setFavoritesOnly(false); setQuery(""); }}>
                <AgentGlyph id={item.id} name={item.name} /><span>{item.name}<small>{status?.readiness === "missing_cli" ? "Setup required" : status?.readiness === "needs_login" ? "Sign-in required" : status?.binaryPath ? "Installed" : status?.detail ?? ""}</small></span>
              </button>;
            })}
            {props.onManage && <button type="button" className="agent-model-manage" onClick={() => { close(); props.onManage?.(); }}>Manage agents</button>}
          </> : <>
          {favoritesOnly && <p className="agent-model-heading">Favorites</p>}
          {filtered.map((model) => {
            const selected = model.modelId === props.currentModel;
            const starred = favorite(model.modelId);
            const jump = jumpable.indexOf(model);
            return <div className="agent-model-row" key={model.modelId}>
              <button type="button" data-model-choice aria-pressed={selected} disabled={modelsLocked}
                title={model.modelId !== model.name ? model.modelId : undefined}
                onClick={() => pick(model.modelId)}>
                {agent && <AgentGlyph id={agent.id} name={agent.name} />}<span>{model.name}</span>{selected ? <CheckIcon size={14} /> : null}
              </button>
              {props.onModeModel && (["plan", "act"] as const).map((mode) => {
                const label = mode === "plan" ? "Plan" : "Act";
                const chosen = props.modeModels?.[mode] === model.modelId;
                return <button type="button" key={mode} className={`model-mode-use${chosen ? " is-chosen" : ""}`} aria-pressed={chosen}
                  aria-label={chosen ? `Stop using ${model.name} for ${label} mode` : `Use ${model.name} for ${label} mode`}
                  title={chosen ? `Used for ${label} mode. Click to stop.` : `Use for ${label} mode`}
                  onClick={() => props.onModeModel?.(mode, model.modelId)}>{label}</button>;
              })}
              <button type="button" className={`model-favorite${starred ? " is-chosen" : ""}`} aria-label={`${starred ? "Unfavorite" : "Favorite"} ${model.name}`} aria-pressed={starred}
                disabled={!props.onToggleFavorite} title="Favorite. Cycle favorites (⌥⌘M)"
                onClick={() => props.onToggleFavorite?.(model.modelId)}><StarIcon size={13} /></button>
              {jump >= 0 ? <kbd className="agent-model-jump" aria-hidden="true">⌘{jump + 1}</kbd> : null}
            </div>;
          })}
          {!filtered.length && <p className="agent-model-empty" role="status">{props.loading ? "Loading models…" : props.error ?? (models.length ? "No models found" : harness?.readiness === "missing_cli" ? harness.detail : props.liveHarnessId ? props.availability.detail : "This agent has not reported model choices. Its default will be used.")}</p>}
          {models.some((model) => model.isLegacy) && !needle && <button type="button" className="agent-model-more" aria-expanded={showLegacy} onClick={() => setShowLegacy((value) => !value)}>{showLegacy ? "Show less" : "Show more"}</button>}
          </>}
          </div>
          {!choosingHarness && ((needsSignIn && !filtered.length) || (props.error && props.onRetry) || (!models.length && harness?.readiness === "missing_cli" && props.onManage)) ? <div className="agent-model-footnote">
            {/* The list already says the agent is signed out; the foot adds only the agent's own login command. */}
            {!filtered.length && needsSignIn && harness?.loginHint ? <p>{harness.loginHint}</p> : null}
            <div className="agent-model-actions">
              {props.error && props.onRetry ? <button type="button" className="chip" onClick={props.onRetry}>Retry</button> : null}
              {props.error && needsSignIn && props.onManage ? <button type="button" className="chip" onClick={() => { close(); props.onManage?.(); }}>Open Agents</button> : null}
              {!models.length && harness?.readiness === "missing_cli" && props.onManage ? <button type="button" className="chip" onClick={() => { close(); props.onManage?.(); }}>Set up harness</button> : null}
            </div>
          </div> : null}
        </section>
        {!choosingHarness && <section className="agent-model-reasoning" aria-label="Reasoning">
          <header><span>Reasoning</span>{modelName ? <span className="agent-model-reasoning-model">{modelName}</span> : null}</header>
          <div className="agent-model-reasoning-body">{props.reasoning}</div>
        </section>}
      </div>
      {props.permissions ? <footer className="agent-model-picker-footer">{props.permissions}</footer> : null}
    </div>, document.body)}
  </div>;
}
