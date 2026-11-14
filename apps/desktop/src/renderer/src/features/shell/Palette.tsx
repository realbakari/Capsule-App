import { useEffect, useMemo, useState, type ReactNode } from "react";
import { threadShelf, type AppearanceTheme, type HarnessPermissionProfile, type SearchResults, type Session } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { keymapFrom, shortcutLabel } from "../../lib/keybindings";
import { rankPalette, type PaletteEntry } from "../../lib/palette";
import { OPEN_IN_EVENT, SHOW_SHORTCUTS_EVENT } from "../../lib/shortcuts-event";
import { TOGGLE_DICTATION_EVENT } from "../../lib/dictation";
import { useThreadTriage } from "../../lib/thread-triage";
import { useToasts } from "../../lib/toasts";
import { useSessionActions } from "../triage/session-actions";
import { REOPEN_PANEL_EVENT } from "../triage/useReopenPanel";
import { ACTION_ICONS } from "./ActionMenu";
import { ArrowLeftIcon, ArrowRightIcon, CpuIcon, DiffIcon, FileIcon, FolderIcon, GlobeIcon, HistoryIcon, InfoIcon, LaptopIcon, MessageSquareIcon, MessageSquarePlusIcon, MoonIcon, PanelLeftIcon, PanelRightIcon, PlusIcon, RefreshIcon, KeyboardIcon, LinkIcon, SearchIcon, SettingsIcon, ShieldIcon, SmartphoneIcon, SmilePlusIcon, SparkIcon, SunIcon, TerminalIcon } from "./icons";
import { SearchDialog, type SearchDialogItem } from "./SearchDialog";
import { requestRename } from "./ThreadTitleMenu";
import "./palette.css";

/*
 * Every palette row is a PaletteEntry with an icon. A feature adds its
 * commands by adding a group builder below and spreading it into `entries`;
 * ranking, shortcuts, highlighting and the disabled state come for free.
 */
type Entry = PaletteEntry & { icon: ReactNode };

const icon = (Icon: (props: { size?: number }) => ReactNode) => <Icon size={15} />;

/* Menu labels are short because the menu sits on the thread; the palette says what they act on. */
const CONVERSATION_LABELS: Partial<Record<string, string>> = {
  rename: "Rename conversation",
  pin: "Pin conversation",
  unpin: "Unpin conversation",
  "generate-title": "Generate a new title",
  "open-folder": "Open conversation folder",
  "copy-path": "Copy folder path",
  archive: "Archive conversation",
  delete: "Delete conversation…",
  "mark-unread": "Mark conversation unread",
  "mark-read": "Mark conversation read",
  settle: "Settle conversation",
  unsettle: "Return conversation to active",
  snooze: "Snooze conversation…",
  wake: "Wake conversation now",
};
const CONVERSATION_COMMANDS: Partial<Record<string, string>> = { "mark-unread": "mark-unread" };
/* Reading and copying work from a paired viewer; everything else changes the desktop. */
const VIEWER_SAFE = new Set(["copy-markdown", "copy-path", "copy-branch"]);

const THEMES: Array<{ id: AppearanceTheme; label: string; icon: ReactNode }> = [
  { id: "light", label: "Light theme", icon: icon(SunIcon) },
  { id: "dark", label: "Dark theme", icon: icon(MoonIcon) },
  { id: "system", label: "Match system theme", icon: icon(LaptopIcon) },
];

export function Palette() {
  const { palette } = useWorkspace();
  return palette ? <PaletteDialog /> : null;
}

function PaletteDialog() {
  const workspace = useWorkspace();
  const {
    api, paletteQuery, setPalette, setPaletteQuery, setView, createTask, canGoBack, canGoForward, goBack, goForward, setThreadFind,
    createProjectFromFolder, pickProjectDirectory, pickFilesToMention, projects, settings, updateSettings,
    sessions, session, setProjectId, setAboutOpen, openInspector, setAgentCommandsOpen, setFilePicker, setContentSearch,
    project, terminalOpen, setTerminalOpen, sidebarCollapsed, setSidebarCollapsed, inspectorOpen, setInspectorOpen, refresh,
  } = workspace;
  const sessionActions = useSessionActions();
  const triage = useThreadTriage();
  const toasts = useToasts();
  const [page, setPage] = useState<"root" | "new-in">("root");
  const query = paletteQuery.trim().toLowerCase();
  const searchesMessages = page === "root" && query.length >= 2;
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<{ query: string; hits?: SearchResults; error?: string }>();
  const currentSearch = search?.query === query ? search : undefined;
  const keymap = useMemo(() => keymapFrom(settings?.keybindings), [settings?.keybindings]);

  useEffect(() => {
    if (!searchesMessages) return;
    let current = true;
    setSearch(undefined);
    const timer = setTimeout(() => {
      void api.search(query).then((hits) => {
        if (current) setSearch({ query, hits });
      }).catch((error) => {
        if (current) setSearch({ query, error: formatUserError(error) });
      });
    }, 150);
    return () => { current = false; clearTimeout(timer); };
  }, [api, searchesMessages, query, retry]);

  const desktopOnly = api.isDesktop === false ? "Available in the desktop app." : undefined;
  const folder = session?.workingDirectory ?? project?.workingDirectory;

  function openPage(next: "root" | "new-in") {
    setPage(next);
    setPaletteQuery("");
  }

  async function restartAgent(target: Session) {
    if (!target.harnessId) return;
    const key = `restart:${target.id}`;
    toasts.show({ key, tone: "info", title: "Restarting the agent…", detail: target.title });
    try {
      if (target.harnessState !== "closed") await api.closeHarness(target.id);
      const profile = target.permissionProfile;
      await api.spawnHarness({
        projectId: target.projectId,
        sessionId: target.id,
        harnessId: target.harnessId,
        mode: target.acpMode,
        model: target.modelOverride,
        permissionProfile: profile === "strict" || profile === "approve-all" || profile === "default" ? profile as HarnessPermissionProfile : undefined,
      });
      toasts.show({ key, tone: "success", title: "Agent restarted", detail: target.title });
    } catch (error) {
      toasts.show({ key, tone: "error", title: "Could not restart the agent", detail: formatUserError(error) });
    } finally {
      void refresh();
    }
  }

  function restartReason(target: Session): string | undefined {
    if (desktopOnly) return desktopOnly;
    if (!target.harnessId) return "This conversation has no coding agent session to restart.";
    if (target.harnessState === "spawning") return "The agent is still starting.";
    return undefined;
  }

  function conversationEntries(target: Session): Entry[] {
    const group = "This conversation";
    const keywords = "conversation thread";
    const shelfActive = triage.writable && threadShelf(target) === "active";
    const fromMenu = sessionActions.items(target).map((item): Entry => {
      const Icon = item.icon ? ACTION_ICONS[item.icon] : undefined;
      return {
        id: `thread-${item.id}`,
        label: CONVERSATION_LABELS[item.id] ?? item.label,
        group,
        keywords,
        icon: Icon ? <Icon size={15} /> : undefined,
        command: CONVERSATION_COMMANDS[item.id],
        disabledReason: (VIEWER_SAFE.has(item.id) ? undefined : desktopOnly)
          ?? (item.enabled === false ? "Nothing new to mark unread yet." : undefined),
        run: () => {
          if (sessionActions.run(target, item.id) !== "rename") return;
          setView("chat");
          // The titlebar's field mounts once the conversation view is on screen.
          setTimeout(() => requestRename(target.id));
        },
      };
    });
    return [
      ...(shelfActive ? [{
        id: "thread-settle-next", label: "Settle and go to next", group, keywords, icon: icon(ACTION_ICONS.check),
        command: "settle-and-next", run: () => void triage.settle(target.id, { advance: true }),
      }] : []),
      ...fromMenu,
      {
        id: "thread-restart-agent", label: "Restart agent session", group, keywords: `${keywords} respawn reconnect harness`,
        icon: icon(RefreshIcon), disabledReason: restartReason(target), run: () => void restartAgent(target),
      },
    ];
  }

  /* Rebuilt per render: ranking a few hundred rows is cheaper than keeping a memo honest. */
  function buildEntries(): Entry[] {
    if (page === "new-in") {
      return projects.map((item) => ({
        id: `new-in-${item.id}`, label: item.name, detail: item.workingDirectory, group: "New conversation in",
        icon: icon(FolderIcon), disabledReason: desktopOnly, run: () => createTask(item.id),
      }));
    }
    const current = settings?.appearanceTheme ?? "system";
    const actions: Entry[] = [
      { id: "new", label: "New conversation", group: "Actions", icon: icon(PlusIcon), command: "new-conversation", disabledReason: desktopOnly, run: () => createTask() },
      { id: "new-in", label: "New conversation in…", group: "Actions", icon: icon(MessageSquarePlusIcon), keywords: "project", keepOpen: true,
        disabledReason: desktopOnly ?? (projects.length ? undefined : "Add a project first."), run: () => openPage("new-in") },
      { id: "new-project", label: "New project from folder", group: "Actions", icon: icon(FolderIcon), disabledReason: desktopOnly, run: createProjectFromFolder },
      { id: "open-folder", label: "Open folder", group: "Actions", icon: icon(FolderIcon), command: "open-folder", disabledReason: desktopOnly, run: () => pickProjectDirectory() },
      { id: "open-files", label: "Open files", group: "Actions", icon: icon(FolderIcon), command: "open-files", disabledReason: desktopOnly, run: pickFilesToMention },
      { id: "go-to-file", label: "Go to file…", group: "Go to", icon: icon(FileIcon), command: "search-files", keywords: "open search find",
        disabledReason: folder ? undefined : "Open a folder first.", run: () => setFilePicker(true) },
      { id: "search-in-files", label: "Search in files…", group: "Go to", icon: icon(SearchIcon), command: "search-in-files", keywords: "grep find text",
        disabledReason: folder ? undefined : "Open a folder first.", run: () => setContentSearch(true) },
      { id: "terminal", label: terminalOpen ? "Hide terminal" : "Show terminal", group: "Workspace", icon: icon(TerminalIcon), command: "toggle-terminal",
        disabledReason: desktopOnly ?? (folder ? undefined : "Open a folder first."), run: () => { setView("chat"); setTerminalOpen(!terminalOpen); } },
      { id: "sidebar", label: sidebarCollapsed ? "Show sidebar" : "Hide sidebar", group: "Workspace", icon: icon(PanelLeftIcon), command: "toggle-sidebar", run: () => setSidebarCollapsed(!sidebarCollapsed) },
      { id: "panel", label: inspectorOpen ? "Hide panel" : "Show panel", group: "Workspace", icon: icon(PanelRightIcon), command: "toggle-inspector", keywords: "inspector", run: () => setInspectorOpen(!inspectorOpen) },
      { id: "review", label: "Open Review", group: "Workspace", icon: icon(DiffIcon), command: "open-review", keywords: "diff changes", run: () => openInspector("changes") },
      { id: "reopen-panel", label: "Reopen the closed panel", group: "Workspace", icon: icon(PanelRightIcon), command: "reopen-panel",
        disabledReason: inspectorOpen ? "The panel is open." : undefined, run: () => window.dispatchEvent(new CustomEvent(REOPEN_PANEL_EVENT)) },
      { id: "browser", label: "Open browser", group: "Workspace", icon: icon(GlobeIcon), command: "open-browser", run: () => openInspector("browser") },
      { id: "simulator", label: "Open iOS Simulator", group: "Workspace", icon: icon(SmartphoneIcon), disabledReason: desktopOnly ?? (api.platform && api.platform !== "darwin" ? "Available on macOS with Xcode." : undefined), run: () => openInspector("simulator") },
      { id: "open-in-favorite", label: "Open folder in favourite app", group: "Workspace", icon: icon(FolderIcon), command: "open-in-favorite", keywords: "editor open in",
        disabledReason: desktopOnly ?? (folder ? undefined : "Open a folder first."), run: () => { setView("chat"); window.dispatchEvent(new CustomEvent(OPEN_IN_EVENT)); } },
      { id: "open-in-settings", label: "Manage Open in apps", group: "Workspace", icon: icon(SettingsIcon), keywords: "editor open in", disabledReason: desktopOnly,
        run: () => { workspace.setSettingsTab("projects"); setView("settings"); } },
      { id: "dictation", label: "Start or finish dictation", group: "Workspace", icon: icon(MessageSquareIcon), command: "dictation", keywords: "voice microphone speak",
        disabledReason: !session ? "Open a conversation first." : undefined, run: () => { setView("chat"); window.dispatchEvent(new CustomEvent(TOGGLE_DICTATION_EVENT)); } },
      { id: "back", label: "Back", group: "Go to", icon: icon(ArrowLeftIcon), command: "history-back", disabledReason: canGoBack ? undefined : "No earlier conversation to go back to.", run: goBack },
      { id: "forward", label: "Forward", group: "Go to", icon: icon(ArrowRightIcon), command: "history-forward", disabledReason: canGoForward ? undefined : "No later conversation to go forward to.", run: goForward },
      { id: "find-in-thread", label: "Find in conversation", group: "Workspace", icon: icon(SearchIcon), command: "find-in-thread", disabledReason: !session ? "Open a conversation first." : undefined, run: () => { setView("chat"); setThreadFind(true); } },
      { id: "chat", label: "Open conversation", group: "Go to", icon: icon(MessageSquareIcon), run: () => setView("chat") },
      { id: "channels", label: "Shared channels", group: "Go to", icon: icon(MessageSquareIcon), disabledReason: desktopOnly, run: () => setView("channels") },
      { id: "skills", label: "Skills & packs", group: "Go to", icon: icon(SparkIcon), run: () => setView("skills") },
      { id: "harness", label: "Agents", group: "Go to", icon: icon(CpuIcon), keywords: "harness", run: () => setView("runtimes") },
      { id: "shortcuts", label: "Keyboard shortcuts", group: "Go to", icon: icon(KeyboardIcon), command: "show-shortcuts", keywords: "keys", run: () => window.dispatchEvent(new CustomEvent(SHOW_SHORTCUTS_EVENT)) },
      { id: "runs", label: "Run history", group: "Go to", icon: icon(HistoryIcon), run: () => setView("history") },
      { id: "thread-agents", label: "Thread agents", group: "Go to", icon: icon(CpuIcon), run: () => openInspector("agents") },
      { id: "agent-commands", label: "Agent commands", group: "Go to", icon: icon(TerminalIcon), disabledReason: !session?.harnessId ? "Start an agent conversation first." : undefined, run: () => { setView("chat"); setAgentCommandsOpen(true); } },
      { id: "approvals", label: "Approvals", group: "Go to", icon: icon(ShieldIcon), run: () => setView("approvals") },
      { id: "settings", label: "Settings", group: "Go to", icon: icon(SettingsIcon), command: "settings", keywords: "preferences", run: () => setView("settings") },
      ...THEMES.map((theme): Entry => ({
        id: `theme-${theme.id}`, label: theme.label, group: "Theme", icon: theme.icon, keywords: "appearance colour color mode",
        detail: theme.id === current ? "Current" : undefined, disabledReason: desktopOnly,
        run: () => updateSettings({ appearanceTheme: theme.id }),
      })),
      { id: "connect", label: "Connect OpenClaw", group: "Workspace", icon: icon(LinkIcon), keywords: "gateway", disabledReason: desktopOnly, run: () => api.connectGateway() },
      ...(api.isDesktop === true ? [
        { id: "pet-show", label: "Show desktop companion", group: "Workspace", icon: icon(SmilePlusIcon), run: () => api.togglePet(true) },
        { id: "pet-hide", label: "Hide desktop companion", group: "Workspace", icon: icon(SmilePlusIcon), run: () => api.togglePet(false) },
      ] : []),
      { id: "update", label: "Check for updates", group: "Workspace", icon: icon(RefreshIcon), run: () => setAboutOpen(true) },
      { id: "about", label: "About Capsule", group: "Workspace", icon: icon(InfoIcon), run: () => setAboutOpen(true) },
    ];
    const projectNames = new Map(projects.map((item) => [item.id, item.name]));
    const recency = (item: Session) => Date.parse(item.updatedAt) || 0;
    const threads: Entry[] = sessions.filter((item) => item.state === "active" && item.id !== session?.id)
      .sort((a, b) => recency(b) - recency(a))
      .map((item) => ({
        id: `session-${item.id}`, label: item.title, detail: projectNames.get(item.projectId),
        group: "Conversations", icon: icon(MessageSquareIcon),
        run: () => { setProjectId(item.projectId, item.id); setView("chat"); },
      }));
    const projectItems: Entry[] = projects.map((item) => ({
      id: `project-${item.id}`, label: item.name, detail: item.workingDirectory, group: "Projects", icon: icon(FolderIcon), searchOnly: true,
      run: () => { setProjectId(item.id); setView("chat"); },
    }));
    return [...threads, ...(session ? conversationEntries(session) : []), ...actions, ...projectItems];
  }

  function buildItems(): SearchDialogItem[] {
    const ranked = rankPalette(buildEntries(), query, { Conversations: query ? 30 : 5, Projects: 20 }) as Array<Entry & { matches: number[] }>;
    const rows: SearchDialogItem[] = ranked.map((entry) => ({
      id: entry.id, label: entry.label, detail: entry.detail, group: entry.group, icon: entry.icon, matches: entry.matches,
      shortcut: entry.command ? shortcutLabel(entry.command, keymap) : undefined, disabledReason: entry.disabledReason,
      keepOpen: entry.keepOpen, onSelect: entry.run,
    }));
    if (!searchesMessages) return rows;
    const messages: SearchDialogItem[] = (currentSearch?.hits?.messages ?? []).slice(0, 30).map((message) => ({
      id: `message-${message.id}`, label: message.sessionTitle, detail: message.excerpt, group: "Messages", icon: icon(SearchIcon),
      onSelect: () => { setProjectId(message.projectId, message.sessionId); setView("chat"); },
    }));
    return [...rows, ...messages];
  }

  const items = buildItems();

  const close = () => { setPalette(false); setPaletteQuery(""); };
  if (page === "new-in") {
    return <SearchDialog className="command-palette" title="New conversation in" placeholder="Choose a project…" query={paletteQuery}
      onQueryChange={setPaletteQuery} items={items} selectLabel="Start" onBack={() => openPage("root")}
      empty={projects.length ? "No matching projects." : "No projects yet."} onClose={close} />;
  }
  return <SearchDialog className="command-palette" title="Search workspace" placeholder="Search commands, projects, conversations…" query={paletteQuery}
    onQueryChange={setPaletteQuery} items={items} status={searchesMessages && !currentSearch ? "Searching messages…" : undefined}
    error={currentSearch?.error} onRetry={() => setRetry((value) => value + 1)} empty="No matching commands, projects, or conversations."
    onClose={close} />;
}
