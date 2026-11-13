import { useRef, useState } from "react";
import { folderBasename } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { HeaderPopover } from "./HeaderPopover";
import { MenuSelect } from "./MenuSelect";
import { SURFACES, tabForTool, toolFromTab, type Surface } from "./surfaces";
import { DiffSquareIcon, FolderIcon, GitBranchIcon, ListIcon, LaptopIcon, MoreHorizontalIcon, TerminalIcon } from "./icons";

/**
 * The panel's surfaces, one icon each, in the titlebar. Clicking an icon shows
 * that surface beside the conversation; clicking the one already showing
 * closes the panel. The list icon opens what this conversation is working
 * with, the way a status line would, without taking the panel.
 */
export function SurfaceBar() {
  const { api, project, session, git, inspectorOpen, inspectorTab, openInspector, setInspectorOpen, terminalOpen, setTerminalOpen, settings, updateSettings, setNotice } = useWorkspace();
  const [details, setDetails] = useState(false);
  const detailsAnchor = useRef<HTMLDivElement>(null);
  const active = inspectorOpen ? toolFromTab(inspectorTab) : undefined;
  const state = { projectId: project?.id, git, desktop: api.isDesktop !== false, platform: api.platform };
  const terminalCwd = session?.workingDirectory ?? project?.workingDirectory;

  /* A surface that cannot exist on this machine is left off; one that cannot open yet says why. */
  const offered = (surface: Surface) => !(surface.tool === "simulator" && surface.blockedBy({ desktop: state.desktop, platform: state.platform }));
  const toggle = (surface: Surface) => {
    if (active === surface.tool) setInspectorOpen(false);
    else openInspector(tabForTool(surface.tool));
  };
  const more = SURFACES.filter((surface) => !surface.inBar && offered(surface));

  return (
    <div className="surface-bar" role="toolbar" aria-label="Panels">
      <div ref={detailsAnchor} className="surface-bar-details">
        <button type="button" className={`icon-btn${details ? " active" : ""}`} title="Conversation details" aria-label="Conversation details" aria-expanded={details} onClick={() => setDetails((open) => !open)}>
          <ListIcon size={15} />
        </button>
        {details && (
          <HeaderPopover anchor={detailsAnchor} label="Conversation details" className="session-details" onClose={() => setDetails(false)}>
            <SessionDetails onReview={() => { setDetails(false); openInspector("changes"); }} />
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
      {SURFACES.filter((surface) => surface.inBar && offered(surface)).map((surface) => {
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
          { id: "keep-awake", label: settings?.keepAwakeWhileRunning ? "Keep computer awake: on" : "Keep computer awake: off", detail: "While a turn is running. Also in Settings." },
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
function SessionDetails({ onReview }: { onReview: () => void }) {
  const { api, project, session, git, contextUsage, activeRun, runs } = useWorkspace();
  const folder = session?.workingDirectory ?? project?.workingDirectory;
  const finished = runs.filter((run) => run.sessionId === session?.id && run.completedAt).length;
  const percent = contextUsage ? Math.round(Math.max(0, Math.min(1, contextUsage.fraction)) * 100) : undefined;
  return (
    <div className="session-details-body">
      <section>
        <h4>Environment</h4>
        <p className="session-details-row"><LaptopIcon size={14} /><span>{api.isDesktop === false ? "Paired device, reading this computer" : "This computer"}</span></p>
        {folder && (
          <p className="session-details-row" title={folder}>
            <FolderIcon size={14} />
            <span className="truncate">{project?.name ?? folderBasename(folder)} <span className="faint">· {formatProjectRoot(folder, { home: window.capsule?.homeDir })}</span></span>
          </p>
        )}
        {git?.branch && <p className="session-details-row"><GitBranchIcon size={14} /><span className="mono">{git.branch}</span></p>}
      </section>
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
      <section>
        <h4>Background tasks</h4>
        {activeRun ? (
          <p className="session-details-row"><TerminalIcon size={14} /><span className="truncate">{activeRun.prompt?.slice(0, 80) || "A turn is running"}</span></p>
        ) : (
          <p className="session-details-row faint">Nothing running</p>
        )}
        {finished > 0 && <p className="session-details-row faint">{finished} finished</p>}
      </section>
    </div>
  );
}
