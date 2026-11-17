import { useEffect, useRef, useState } from "react";
import { ThreadDetailsRows } from "../threads/ThreadDetails";
import { applyBranchPrefix, favoriteOpenInApp, folderBasename } from "@capsule/shared";
import { OpenInControl } from "../open-in/OpenInPicker";
import { useOpenIn } from "../open-in/useOpenIn";
import { OPEN_IN_EVENT } from "../../lib/shortcuts-event";
import { OPEN_GIT_MENU_EVENT, type GitMenu } from "../../lib/git-palette";
import { formatUserError } from "../../lib/errors";
import { formatProjectRoot } from "../../lib/paths";
import { useWorkspace } from "../../lib/workspace";
import { shortcutLabel, withShortcut } from "../../lib/keybindings";
import { BackgroundTasks } from "./BackgroundTasks";
import { ApplyToLocalRow } from "../apply/ApplyToLocal";
import { CommitControl } from "./CommitControl";
import { ProjectActionsControl } from "./ProjectActionsControl";
import { HeaderPopover } from "./HeaderPopover";
import { MenuSelect } from "./MenuSelect";
import { SURFACES, offered, onBar, tabForTool, toolFromTab, type Surface } from "./surfaces";
import { simulatorAttachedTo } from "./SimulatorPane";
import { AlertTriangleIcon, CheckIcon, ChevronDownIcon, DiffSquareIcon, FolderIcon, FolderOpenIcon, GitBranchIcon, ListIcon, LaptopIcon, MoreHorizontalIcon, PlusIcon, TerminalIcon } from "./icons";

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
  const { api, project, session, git, gitError, files, inspectorOpen, inspectorTab, openInspector, setInspectorOpen, terminalOpen, setTerminalOpen, setNotice, keyBindings } = useWorkspace();
  const [details, setDetails] = useState(false);
  /* Bumped by the Open in shortcut when there is no favourite: details opens with the app list showing. */
  const [pickApp, setPickApp] = useState(0);
  /* Set by the palette's Commit… and Switch branch… rows: details opens with that menu showing. */
  const [gitMenu, setGitMenu] = useState<{ menu: GitMenu; count: number; }>();
  const detailsAnchor = useRef<HTMLDivElement>(null);
  const openIn = useOpenIn();
  const active = inspectorOpen ? toolFromTab(inspectorTab) : undefined;
  const desktop = api.isDesktop !== false;
  const state = {
    projectId: project?.id, git, desktop, platform: api.platform, groupId: session?.groupId,
    folderNames: files.map((entry) => entry.name), simulatorAttached: desktop && simulatorAttachedTo(session?.id),
  };
  const terminalCwd = session?.workingDirectory ?? project?.workingDirectory;

  useEffect(() => {
    const onOpenIn = () => {
      if (api.isDesktop === false || typeof api.listOpenInApps !== "function") return;
      if (!project || !terminalCwd) { setNotice("Open a folder first, then open it in another app."); return; }
      const target = { projectId: project.id, sessionId: session?.id };
      void api.listOpenInApps(target.projectId, target.sessionId).then((catalog) => {
        const favorite = favoriteOpenInApp(catalog);
        if (favorite) { void openIn(favorite.id, target); return; }
        setPickApp((value) => value + 1);
        setDetails(true);
      }, (error: unknown) => setNotice(formatUserError(error)));
    };
    window.addEventListener(OPEN_IN_EVENT, onOpenIn);
    return () => window.removeEventListener(OPEN_IN_EVENT, onOpenIn);
  }, [api, project, session?.id, terminalCwd, openIn, setNotice]);

  useEffect(() => {
    const onGitMenu = (event: Event) => {
      const menu = (event as CustomEvent<GitMenu>).detail;
      setGitMenu((current) => ({ menu, count: (current?.count ?? 0) + 1 }));
      setDetails(true);
    };
    window.addEventListener(OPEN_GIT_MENU_EVENT, onGitMenu);
    return () => window.removeEventListener(OPEN_GIT_MENU_EVENT, onGitMenu);
  }, []);

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
  /* A surface that cannot exist on this machine is left off; one that cannot open yet says why. */
  const candidates = SURFACES.filter((surface) => offered(surface, state) && onBar(surface, state, active));
  const slots = Math.max(1, Math.floor((room - TITLE_ROOM_PX - FIXED_BAR_PX) / ICON_PX));
  const ordered = [...candidates].sort((a, b) => Number(b.tool === active) - Number(a.tool === active));
  const shown = new Set(ordered.slice(0, slots).map((surface) => surface.tool));
  const inBar = candidates.filter((surface) => shown.has(surface.tool));
  const more = [...candidates.filter((surface) => !shown.has(surface.tool)), ...SURFACES.filter((surface) => offered(surface, state) && !onBar(surface, state, active))];

  return (
    <div className="surface-bar" role="toolbar" aria-label="Panels" ref={barRef}>
      <div ref={detailsAnchor} className="surface-bar-details">
        <button type="button" className={`icon-btn${details ? " active" : ""}${gitError ? " has-notice" : ""}`} title={gitError ? "Conversation details · Git status could not be read" : "Conversation details"} aria-label={gitError ? "Conversation details, Git status could not be read" : "Conversation details"} aria-expanded={details} onClick={() => { setPickApp(0); setGitMenu(undefined); setDetails((open) => !open); }}>
          <ListIcon size={15} />
        </button>
        {details && (
          <HeaderPopover anchor={detailsAnchor} label="Conversation details" className="session-details" onClose={() => setDetails(false)}>
            <SessionDetails key={`${pickApp}/${gitMenu?.count ?? 0}`} pickApp={pickApp > 0} gitMenu={gitMenu?.menu} onReview={() => { setDetails(false); openInspector("changes"); }} onClose={() => setDetails(false)} />
          </HeaderPopover>
        )}
      </div>
      {/* The real terminal under the conversation: a shell needs a folder, and a paired viewer has no machine to run one on. */}
      {desktop ? (
        <button
          type="button"
          className={`icon-btn${terminalOpen ? " active" : ""}`}
          disabled={!terminalCwd}
          title={terminalCwd ? withShortcut("Toggle terminal", "toggle-terminal", keyBindings) : "Open a folder to use the terminal"}
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
          onClick={() => setTerminalOpen(!terminalOpen)}
        >
          <TerminalIcon size={15} />
        </button>
      ) : null}
      {inBar.map((surface) => {
        const Icon = surface.icon;
        const blocked = surface.blockedBy(state);
        const keys = surface.command ? shortcutLabel(surface.command, keyBindings) : undefined;
        const title = blocked ?? `${surface.label}${keys ? ` (${keys})` : ""}`;
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
        options={more.map((surface) => ({ id: surface.tool, label: surface.label, detail: surface.detail, icon: <surface.icon size={14} /> }))}
        onChange={(id) => {
          const surface = more.find((item) => item.tool === id);
          if (surface) toggle(surface);
        }}
      />
    </div>
  );
}

/** Where this conversation runs, how full its context is, what changed, and what is running. */
function SessionDetails({ onReview, onClose, pickApp, gitMenu }: { onReview: () => void; onClose: () => void; pickApp: boolean; gitMenu?: GitMenu }) {
  const { api, project, session, git, gitError, contextUsage, openTerminal, initializeGit, setNotice } = useWorkspace();
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
        {api.isDesktop === false ? <p className="session-details-row"><LaptopIcon size={14} /><span>Paired device, reading this computer</span></p> : null}
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
        {folder && project && api.isDesktop !== false ? (
          <OpenInControl target={{ projectId: project.id, sessionId: session?.id }} what="folder" variant="row" startOpen={pickApp} />
        ) : null}
        <BranchRow startOpen={gitMenu === "branch"} />
        <ApplyToLocalRow onApply={onClose} />
      </section>
      <ThreadDetailsRows />
      {/* What the titlebar used to carry: run an action, commit and push, or start Git. */}
      {folder && api.isDesktop !== false && (
        <section className="session-details-actions" aria-label="Workspace actions">
          <ProjectActionsControl onRun={onClose} />
          <CommitControl startOpen={gitMenu === "commit"} />
          {git?.available && !git.isRepo ? (
            <button type="button" className="session-details-action" onClick={() => void initializeGit()}>
              <GitBranchIcon size={14} /><span>Initialize Git in this folder</span>
            </button>
          ) : null}
        </section>
      )}
      {percent === undefined ? null : (
        <section className="session-details-line">
          <h4>Context</h4>
          <span className="session-details-meter" aria-label={`${percent}% of the context window used`}>
            {percent}%<span className="session-details-bar"><i style={{ width: `${percent}%` }} /></span>
          </span>
        </section>
      )}
      {gitError ? (
        <section aria-label="Changes">
          <h4>Changes</h4>
          <p className="session-details-note" role="status"><AlertTriangleIcon size={14} /><span>{gitError}</span></p>
        </section>
      ) : git?.isRepo && (
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

/*
 * The checked-out branch, and switching it. The composer offers this only
 * before the first message, so a started conversation switches here. Remote
 * branches check out as local branches that track them; a name nobody has
 * yet can be created. A paired device sees the name without the menu: every
 * branch change is a write it cannot make.
 */
function BranchRow({ startOpen = false }: { startOpen?: boolean }) {
  const { api, git, project, sessions, settings, checkoutBranch, gitCreateBranch, setSessionId } = useWorkspace();
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => { if (startOpen) setOpen(true); }, [startOpen]);
  if (!git?.branch) return null;
  if (api.isDesktop === false) {
    return <p className="session-details-row"><GitBranchIcon size={14} /><span className="mono">{git.branch}</span></p>;
  }
  const needle = query.trim().toLowerCase();
  const matches = (branch: string) => !needle || branch.toLowerCase().includes(needle);
  const local = git.branches.filter(matches);
  const remote = (git.remoteBranches ?? []).filter(matches);
  const created = query.trim() ? applyBranchPrefix(settings?.branchPrefix, query.trim()) : "";
  const canCreate = Boolean(created) && !git.branches.includes(created);
  const elsewhere = git.checkedOutElsewhere ?? {};
  const threadAt = (folder: string) => sessions.find((item) => item.projectId === project?.id && item.workingDirectory && samePath(item.workingDirectory, folder));
  const close = () => { setOpen(false); setQuery(""); };
  const choose = (branch: string) => {
    close();
    if (branch !== git.branch) void checkoutBranch(branch);
  };
  const create = () => {
    close();
    void gitCreateBranch(query.trim());
  };
  return (
    <div className="session-details-anchor" ref={anchor}>
      <button type="button" className="session-details-action" aria-haspopup="dialog" aria-expanded={open} title="Switch or create a branch" onClick={() => setOpen((value) => !value)}>
        <GitBranchIcon size={14} /><span className="mono">{git.branch}</span><ChevronDownIcon size={12} />
      </button>
      {open && (
        <HeaderPopover anchor={anchor} label="Switch branch" className="branch-menu" onClose={close}>
          <input
            className="branch-menu-search"
            type="search"
            aria-label="Find or create a branch"
            placeholder="Find or create a branch"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const first = local.find((branch) => !elsewhere[branch]) ?? remote[0];
              if (first) choose(first);
              else if (canCreate) create();
            }}
          />
          {local.map((branch) => {
            const folder = elsewhere[branch];
            const thread = folder ? threadAt(folder) : undefined;
            if (folder) {
              return (
                <button key={branch} type="button" disabled={!thread}
                  title={thread ? `Open the thread working on ${branch}` : `Checked out in another worktree, at ${folder}`}
                  onClick={() => { close(); if (thread) setSessionId(thread.id); }}>
                  <span className="branch-menu-spacer" aria-hidden />
                  <span className="mono">{branch}</span>
                  <span className="branch-menu-where">{thread ? "open thread" : "other worktree"}</span>
                </button>
              );
            }
            return (
              <button key={branch} type="button" aria-current={branch === git.branch ? "true" : undefined} onClick={() => choose(branch)}>
                {branch === git.branch ? <CheckIcon size={13} /> : <span className="branch-menu-spacer" aria-hidden />}
                <span className="mono">{branch}</span>
              </button>
            );
          })}
          {remote.length ? <h5 className="branch-menu-heading">Remote</h5> : null}
          {remote.map((branch) => (
            <button key={branch} type="button" title={`Check out ${branch.slice(branch.indexOf("/") + 1)}, tracking ${branch}`} onClick={() => choose(branch)}>
              <span className="branch-menu-spacer" aria-hidden />
              <span className="mono">{branch}</span>
            </button>
          ))}
          {canCreate ? (
            <button type="button" onClick={create}>
              <PlusIcon size={13} />
              <span>Create branch <span className="mono">{created}</span></span>
            </button>
          ) : null}
          {!local.length && !remote.length && !canCreate ? <p className="commit-menu-note">No branch matches.</p> : null}
        </HeaderPopover>
      )}
    </div>
  );
}

/** Git reports real paths; a thread may hold the same folder through /var or a trailing slash. */
function samePath(left: string, right: string): boolean {
  const normal = (value: string) => value.replace(/\/+$/, "").replace(/^\/private(?=\/)/, "");
  return normal(left) === normal(right);
}
