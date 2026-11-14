import { useEffect, useRef, useState } from "react";
import { folderBasename } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { BackgroundTasks } from "./BackgroundTasks";
import { ApplyToLocalRow } from "../apply/ApplyToLocal";
import { CommitControl } from "./CommitControl";
import { ProjectActionsControl } from "./ProjectActionsControl";
import { HeaderPopover } from "./HeaderPopover";
import { MenuSelect } from "./MenuSelect";
import { SURFACES, tabForTool, toolFromTab, type Surface } from "./surfaces";
import { CoffeeIcon, DiffSquareIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, ListIcon, LaptopIcon, MoreHorizontalIcon, TerminalIcon } from "./icons";

/**
 * The panel's surfaces, one icon each, in the titlebar. Clicking an icon shows
 * that surface beside the conversation; clicking the one already showing
 * closes the panel. The list icon opens what this conversation is working
 * with, the way a status line would, without taking the panel.
 */
/* The titlebar's budget: the name keeps this much; details, terminal and More always show. */
const TITLE_ROOM_PX = 208;
const ICON_PX = 32;
/* Details, terminal and More, plus the titlebar's own padding and gap. */
const FIXED_BAR_PX = 3 * ICON_PX + 44;

export function SurfaceBar() {
  const { api, project, session, git, inspectorOpen, inspectorTab, openInspector, setInspectorOpen, terminalOpen, setTerminalOpen, settings, updateSettings, setNotice } = useWorkspace();
  const [details, setDetails] = useState(false);
  const detailsAnchor = useRef<HTMLDivElement>(null);
  const active = inspectorOpen ? toolFromTab(inspectorTab) : undefined;
  const state = { projectId: project?.id, git, desktop: api.isDesktop !== false, platform: api.platform, groupId: session?.groupId };
  const terminalCwd = session?.workingDirectory ?? project?.workingDirectory;

  /* A surface that cannot exist on this machine is left off; one that cannot open yet says why. */
  const offered = (surface: Surface) => !(surface.tool === "simulator" && surface.blockedBy({ desktop: state.desktop, platform: state.platform }))
    && !(surface.tool === "compare" && !state.groupId);
  const toggle = (surface: Surface) => {
    if (active === surface.tool) setInspectorOpen(false);
    else openInspector(tabForTool(surface.tool));
  };
  /*
   * The bar keeps the conversation's name readable: when the titlebar is
   * narrow (a wide panel beside it), panel icons that do not fit move to the
   * top of More, the one on show staying in the bar.
   */
  const barRef = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(Infinity);
  useEffect(() => {
    const header = barRef.current?.closest(".page-header");
    if (!header) return undefined;
    const measure = () => setRoom(header.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);
  const candidates = SURFACES.filter((surface) => surface.inBar && offered(surface));
  const slots = Math.max(1, Math.floor((room - TITLE_ROOM_PX - FIXED_BAR_PX) / ICON_PX));
  const ordered = [...candidates].sort((a, b) => Number(b.tool === active) - Number(a.tool === active));
  const shown = new Set(ordered.slice(0, slots).map((surface) => surface.tool));
  const inBar = candidates.filter((surface) => shown.has(surface.tool));
  const more = [...candidates.filter((surface) => !shown.has(surface.tool)), ...SURFACES.filter((surface) => !surface.inBar && offered(surface))];

  return (
    <div className="surface-bar" role="toolbar" aria-label="Panels" ref={barRef}>
      <div ref={detailsAnchor} className="surface-bar-details">
        <button type="button" className={`icon-btn${details ? " active" : ""}`} title="Conversation details" aria-label="Conversation details" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
          <ListIcon size={15} />
        </button>
        {details && (
          <HeaderPopover anchor={detailsAnchor} label="Conversation details" className="session-details" onClose={() => setDetails(false)}>
            <SessionDetails onReview={() => { setDetails(false); openInspector("changes"); }} onClose={() => setDetails(false)} />
          </HeaderPopover>
        )}
      </div>
      {/* The real terminal under the conversation: a shell needs a folder, and a paired viewer has no machine. */}
      <button
        type="button"
        className={`icon-btn${terminalOpen ? " active" : ""}`}
        disabled={!terminalCwd || api.isDesktop === false}
        title={api.isDesktop === false ? "Available in the desktop app" : terminalCwd ? "Toggle terminal (⌘J)" : "Open a folder to use the terminal"}
        aria-label="Toggle terminal (⌘J)"
        aria-pressed={terminalOpen}
        onClick={() => setTerminalOpen(!terminalOpen)}
      >
        <TerminalIcon size={15} />
      </button>
      {inBar.map((surface) => {
        const Icon = surface.icon;
        const blocked = surface.blockedBy(state);
        const title = blocked ?? `${surface.label}${surface.shortcut ? ` (${surface.shortcut})` : ""}`;
        return (
          <button
            key={surface.tool}
            type="button"
            className={`icon-btn${active === surface.tool ? " active" : ""}`}
            title={title}
            aria-label={surface.label}
            aria-pressed={active === surface.tool}
            disabled={Boolean(blocked)}
            onClick={() => toggle(surface)}
          >
            <Icon size={15} />
          </button>
        );
      })}
      <MenuSelect
        ariaLabel="More panels and controls"
        value=""
        placeholder="More"
        iconOnly
        icon={<MoreHorizontalIcon size={15} />}
        options={[
          ...more.map((surface) => ({ id: surface.tool, label: surface.label, detail: surface.detail, icon: <surface.icon size={14} /> })),
          { id: "keep-awake", label: settings?.keepAwakeWhileRunning ? "Keep computer awake: on" : "Keep computer awake: off", detail: "While a turn is running. Also in Settings.", icon: <CoffeeIcon size={14} /> },
        ]}
        onChange={(id) => {
          const surface = more.find((item) => item.tool === id);
          if (surface) { toggle(surface); return; }
          if (id === "keep-awake") {
            void updateSettings({ keepAwakeWhileRunning: !settings?.keepAwakeWhileRunning }).catch((error) => setNotice(formatUserError(error)));
          }
        }}
      />
    </div>
  );
}

/** Where this conversation runs, how full its context is, what changed, and what is running. */
function SessionDetails({ onReview, onClose }: { onReview: () => void; onClose: () => void }) {
  const { api, project, session, git, contextUsage, openTerminal, initializeGit, setNotice } = useWorkspace();
  const folder = session?.workingDirectory ?? project?.workingDirectory;
  const reveal = async () => {
    if (!folder) return;
    try { await api.openPath(folder); } catch (error) { setNotice(formatUserError(error)); }
  };
  const percent = contextUsage ? Math.round(Math.max(0, Math.min(1, contextUsage.fraction)) * 100) : undefined;
  return (
    <div className="session-details-body">
      <section>
        <h4>Environment</h4>
        <p className="session-details-row"><LaptopIcon size={14} /><span>{api.isDesktop === false ? "Paired device, reading this computer" : "This computer"}</span></p>
        {folder && (
          <div className="session-details-row" title={folder}>
            <FolderIcon size={14} />
            <span className="truncate">{project?.name ?? folderBasename(folder)} <span className="faint">· {formatProjectRoot(folder, { home: window.capsule?.homeDir })}</span></span>
            {/* Open the folder where you work on it, from the row that names it. */}
            {api.isDesktop !== false ? <span className="session-details-row-actions">
              <button type="button" className="icon-btn" title="Reveal in Finder" aria-label="Reveal in Finder" onClick={() => void reveal()}><FolderOpenIcon size={14} /></button>
              <button type="button" className="icon-btn" title="Open in Terminal" aria-label="Open in Terminal" onClick={() => void openTerminal()}><TerminalIcon size={14} /></button>
            </span> : null}
          </div>
        )}
        {git?.branch && <p className="session-details-row"><GitBranchIcon size={14} /><span className="mono">{git.branch}</span></p>}
        <ApplyToLocalRow onApply={onClose} />
      </section>
      {/* What the titlebar used to carry: run an action, commit and push, or start Git. */}
      {folder && api.isDesktop !== false && (
        <section className="session-details-actions" aria-label="Workspace actions">
          <ProjectActionsControl />
          <CommitControl />
          {git?.available && !git.isRepo ? (
            <button type="button" className="session-details-action" onClick={() => void initializeGit()}>
              <GitBranchIcon size={14} /><span>Initialize Git in this folder</span>
            </button>
          ) : null}
        </section>
      )}
      <section className="session-details-line">
        <h4>Context</h4>
        {percent === undefined ? <span className="faint">Not reported yet</span> : (
          <span className="session-details-meter" aria-label={`${percent}% of the context window used`}>
            {percent}%<span className="session-details-bar"><i style={{ width: `${percent}%` }} /></span>
          </span>
        )}
      </section>
      {git?.isRepo && (
        <section className="session-details-line">
          <h4>Changes</h4>
          <span className="session-details-changes">
            <DiffSquareIcon size={14} />
            {git.dirty ? <><span className="added">+{git.added ?? 0}</span> <span className="removed">−{git.removed ?? 0}</span></> : <span className="faint">None</span>}
            <button type="button" className="chip" onClick={onReview}>Review</button>
          </span>
        </section>
      )}
      <BackgroundTasks />
    </div>
  );
}
