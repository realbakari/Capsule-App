import { useMemo, useState, type ReactNode } from "react";
import { APPROVAL_PRESETS, approvalPreset, BROWSER_DEVICES, DIFF_SCOPES, initPrompt, threadShelf, type AppearanceTheme, type DiffScope, type HarnessPermissionProfile, type Session } from "@capsule/shared";
import { requestBrowserCommand } from "../../lib/browser-commands";
import { chooseReview } from "../../lib/review-scope";
import { requestPluginIntent } from "../plugins/plugin-intent";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { KEY_COMMAND_EVENT, shortcutLabel } from "../../lib/keybindings";
import { rankPalette, type PaletteEntry } from "../../lib/palette";
import { OPEN_IN_EVENT, SHOW_SHORTCUTS_EVENT } from "../../lib/shortcuts-event";
import { TOGGLE_DICTATION_EVENT } from "../../lib/dictation";
import { CYCLE_FAVORITE_MODEL_EVENT } from "../../lib/turn-mode";
import { requestNewBoardCard } from "../../lib/board";
import { requestRunOn } from "../../lib/best-of-n";
import { currentSelection, NO_SELECTION, selectionContext } from "../../lib/selection-share";
import { useThreadTriage } from "../../lib/thread-triage";
import { useToasts } from "../../lib/toasts";
import { updateOutcomeToast, useUpdates } from "../../lib/updates";
import { compactRelativeTime, latestSidebarRuns, threadActivityAt } from "../../lib/sidebar";
import { useMessageSearch } from "../../lib/message-search";
import { SETTINGS_SEARCH_ITEMS, SETTINGS_SECTION_LABELS } from "../settings/settings-search";
import { revealSetting } from "../settings/reveal";
import { useSessionActions } from "../triage/session-actions";
import { REOPEN_PANEL_EVENT } from "../triage/useReopenPanel";
import { ACTION_ICONS } from "./ActionMenu";
import { ArrowDownIcon, ArrowLeftIcon, ArrowRightIcon, ArrowUpIcon, ChartIcon, ColumnsIcon, CompareIcon, CpuIcon, DiffIcon, FileIcon, FolderIcon, GitBranchIcon, GitCommitIcon, GitPullRequestIcon, GlobeIcon, HistoryIcon, InfoIcon, LaptopIcon, ListIcon, ListTodoIcon, MessageSquareIcon, MessageSquarePlusIcon, MoonIcon, MousePointerClickIcon, PanelLeftIcon, PanelRightIcon, PlusIcon, RedoIcon, RefreshIcon, KeyboardIcon, LinkIcon, SearchIcon, SettingsIcon, ShieldIcon, SmartphoneIcon, SmilePlusIcon, SparkIcon, StarIcon, StopIcon, SunIcon, TerminalIcon } from "./icons";
import { SearchDialog, type SearchDialogItem } from "./SearchDialog";
import { useGitActions } from "./use-git-actions";
import { gitPaletteRows, OPEN_GIT_MENU_EVENT, type GitMenu, type GitPaletteAction } from "../../lib/git-palette";
import { requestRename } from "./ThreadTitleMenu";
import { useBranching } from "../conversation/branching/use-branching";
import { HANDOFF_LABEL } from "../handoff/Handoff";
import { useThreadActions } from "../threads/ThreadActions";
import { useImportSessions } from "../import/ImportSessions";
import { detectInstructionFiles } from "../project/ProjectInstructions";
import { commandDetail } from "../../lib/commands";
import { customizationCommands } from "../customization/customization-commands";
import { requestFirstRun } from "../onboarding/setup-progress";
import "./palette.css";

/*
 * Every palette row is a PaletteEntry with an icon. A feature adds its
 * commands by adding a group builder below and spreading it into `entries`;
 * ranking, shortcuts, highlighting and the disabled state come for free.
 */
type Entry = PaletteEntry & { icon: ReactNode; /** A fixed key outside the keymap, such as ⇧Tab in the composer. */ shortcut?: string; meta?: string };

/* The order groups take on an empty query. Each group is listed once, so a builder may emit its rows in any order. */
const GROUP_ORDER = ["Recent conversations", "Actions", "This conversation", "Go to", "Workspace", "Profiles", "Theme", "Settings", "Customization", "Commands", "Conversations", "Projects"];
const groupRank = (group: string) => { const index = GROUP_ORDER.indexOf(group); return index < 0 ? GROUP_ORDER.length : index; };
/* Things to open rather than commands to run: they lose ties to commands, and `>` hides them. */
const CONTENT_GROUPS = ["Recent conversations", "Conversations", "Projects"];

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
  "copy-branch": "Copy branch name",
  "copy-markdown": "Copy conversation as Markdown",
  "export-markdown": "Export conversation as Markdown…",
  "share-link": "Share read-only link…",
  handoff: HANDOFF_LABEL,
  "apply-to-local": "Apply worktree to local checkout",
  keep: "Keep this conversation",
  tags: "Tag conversation…",
  pause: "Pause conversation",
  resume: "Resume conversation",
};

const REVIEW_SCOPE_LABEL: Record<DiffScope, string> = {
  uncommitted: "Review uncommitted changes",
  staged: "Review staged changes",
  unstaged: "Review unstaged changes",
  turn: "Review this turn's changes",
  branch: "Review branch changes",
  commit: "Review the latest commit",
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
  const { palette, api } = useWorkspace();
  if (!palette) return null;
  /* Only the desktop drives its own updates; a paired device never subscribes. */
  return api.isDesktop === true ? <DesktopPaletteDialog /> : <PaletteDialog />;
}

function DesktopPaletteDialog() {
  const toasts = useToasts();
  const updates = useUpdates((outcome) => {
    const toast = updateOutcomeToast(outcome);
    if (toast) toasts.show(toast);
  });
  return <PaletteDialog updates={updates} />;
}

function PaletteDialog({ updates }: { updates?: ReturnType<typeof useUpdates> }) {
  const workspace = useWorkspace();
  const {
    api, paletteQuery, setPalette, setPaletteQuery, setView, createTask, canGoBack, canGoForward, goBack, goForward, setThreadFind,
    createProjectFromFolder, pickProjectDirectory, pickFilesToMention, projects, settings, updateSettings,
    sessions, session, setProjectId, setAboutOpen, openInspector, setAgentCommandsOpen, setFilePicker, setContentSearch,
    project, terminalOpen, setTerminalOpen, sidebarCollapsed, setSidebarCollapsed, inspectorOpen, setInspectorOpen, inspectorTab, refresh,
    setPromptJump, runs, turnMode, setTurnMode, attachContext, setNotice, setPermissionProfile, draftApproval, setDraftApproval,
    setDraft, commands, config, setSettingsTab, startWithProfile, keyBindings, projectRuns, findInThread,
  } = workspace;
  const branching = useBranching();
  const lastTurn = useMemo(() => runs
    .filter((run) => run.sessionId === session?.id && !["queued", "running", "waiting", "approval_required"].includes(run.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0], [runs, session?.id]);
  const threadActions = useThreadActions();
  const gitActions = useGitActions();
  const importSessions = useImportSessions();
  const sessionActions = useSessionActions();
  const triage = useThreadTriage();
  const toasts = useToasts();
  const [page, setPage] = useState<"root" | "new-in" | "archived">("root");
  const typed = paletteQuery.trim();
  /* A leading ">" searches commands only, leaving out conversations, projects and messages. */
  const commandsOnly = page === "root" && typed.startsWith(">");
  const query = (commandsOnly ? typed.slice(1) : typed).trim().toLowerCase();
  const messageSearch = useMessageSearch(api, query, page === "root" && !commandsOnly);
  const latestRuns = useMemo(() => latestSidebarRuns(projectRuns), [projectRuns]);

  const desktopOnly = api.isDesktop === false ? "Available in the desktop app." : undefined;
  /* Starting and steering conversations also works from a device paired with control. */
  const readOnly = api.isDesktop === false && api.remoteMode !== "control" ? "Read only on this device." : undefined;
  const folder = session?.workingDirectory ?? project?.workingDirectory;
  const archived = sessions.filter((item) => item.state === "archived");

  function openPage(next: "root" | "new-in" | "archived") {
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

  /* Commit, push, pull, pull request and branches for the open project, through the same guards as the commit menu. */
  function gitEntries(): Entry[] {
    const openMenu = (menu: GitMenu) => { setView("chat"); window.dispatchEvent(new CustomEvent<GitMenu>(OPEN_GIT_MENU_EVENT, { detail: menu })); };
    const handlers: Record<GitPaletteAction, () => void> = {
      "commit-menu": () => openMenu("commit"),
      "branch-menu": () => openMenu("branch"),
      push: () => void gitActions.push(),
      pull: () => void workspace.gitPull("ff-only"),
      rebase: () => void workspace.gitPull("rebase"),
      "pull-request": () => void gitActions.createPullRequest(),
    };
    const icons: Record<GitPaletteAction, ReactNode> = {
      "commit-menu": icon(GitCommitIcon), push: icon(ArrowUpIcon), pull: icon(ArrowDownIcon), rebase: icon(ArrowDownIcon),
      "pull-request": icon(GitPullRequestIcon), "branch-menu": icon(GitBranchIcon),
    };
    return gitPaletteRows(workspace.git, { hasProject: Boolean(project), desktop: api.isDesktop !== false }).map((row) => ({
      id: row.id, label: row.label, detail: row.detail, keywords: row.keywords, group: "Workspace", icon: icons[row.action],
      disabledReason: row.disabledReason, run: handlers[row.action],
    }));
  }

  /* Board, plan mode, best-of-N, Review scopes, approvals, branching and the other workflow commands. */
  function workflowEntries(): Entry[] {
    const noProject = projects.length === 0 ? "Add a project first." : undefined;
    const reviewThread = session?.id ?? `project:${project?.id ?? ""}`;
    const { activeRun, stopRun } = workspace;
    return [
      ...(activeRun ? [{ id: "stop-turn", label: "Stop the running turn", group: "Actions", icon: icon(StopIcon), command: "stop-turn", keywords: "cancel interrupt run",
        disabledReason: readOnly ?? (workspace.stoppingRunIds.includes(activeRun.id) ? "Stopping. Waiting for the agent to finish its current step." : undefined),
        run: () => void stopRun() }] : []),
      ...(readOnly ? [] : [{ id: "new-temporary", label: "New temporary conversation", detail: "Not saved, with no checkpoints; gone when Capsule quits", group: "Actions", icon: icon(MessageSquareIcon),
        disabledReason: noProject, run: () => void createTask(undefined, undefined, { temporary: true }) }]),
      ...(threadActions.writable ? [{ id: "new-from-issue", label: "New conversation from a GitHub issue…", detail: "Its own worktree on a branch named after the issue", group: "Actions", icon: icon(GitBranchIcon),
        disabledReason: !project ? "Open a project first." : undefined, run: () => { setPalette(false); threadActions.openIssuePicker(project?.id); } }] : []),
      { id: "run-on-several", label: "Run on several agents…", detail: "One prompt, two to four agents, each in its own worktree", group: "Actions", icon: icon(CompareIcon), keywords: "best of compare",
        disabledReason: desktopOnly ?? noProject,
        run: () => {
          setView("chat");
          requestRunOn();
          /* An untouched new conversation is where the prompt goes; anything else gets a fresh one. */
          if (!session || runs.some((run) => run.sessionId === session.id)) void createTask();
        } },
      ...(session?.groupId ? [{ id: "compare", label: "Compare candidates", group: "Workspace", icon: icon(CompareIcon), run: () => { setView("chat"); openInspector("compare"); } }] : []),
      { id: "new-board-card", label: "New board card", group: "Actions", icon: icon(ColumnsIcon), keywords: "task", disabledReason: desktopOnly ?? noProject, run: () => { setView("board"); requestNewBoardCard(); } },
      turnMode === "plan"
        ? { id: "turn-act", label: "Switch to Act mode", group: "Actions", icon: icon(ListTodoIcon), shortcut: "⇧Tab", disabledReason: readOnly, run: () => { setView("chat"); void setTurnMode("act"); } }
        : { id: "turn-plan", label: "Switch to Plan mode", group: "Actions", icon: icon(ListTodoIcon), shortcut: "⇧Tab", disabledReason: readOnly, run: () => { setView("chat"); void setTurnMode("plan"); } },
      { id: "cycle-favorite-model", label: "Next favorite model", group: "Actions", icon: icon(StarIcon), command: "cycle-favorite-model", disabledReason: readOnly, run: () => { setView("chat"); window.dispatchEvent(new CustomEvent(CYCLE_FAVORITE_MODEL_EVENT)); } },
      ...DIFF_SCOPES.map((scope): Entry => ({
        id: `review-${scope.id}`, label: REVIEW_SCOPE_LABEL[scope.id], detail: scope.detail, group: "Workspace", icon: icon(DiffIcon), keywords: "diff changes", searchOnly: true,
        disabledReason: !project ? "Open a project first." : scope.id === "turn" && !session ? "Open a conversation first." : undefined,
        run: () => { if (project) chooseReview(project.id, reviewThread, scope.id); openInspector("changes"); },
      })),
      { id: "send-selection", label: "Send selection to thread", detail: "Quote the selected terminal, file or browser text in the composer", group: "Workspace", icon: icon(MessageSquareIcon),
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : undefined),
        run: () => { void currentSelection().then((selection) => { if (selection) { setView("chat"); void attachContext(selectionContext(selection)); } else setNotice(NO_SELECTION); }); } },
      { id: "init", label: "Write or refresh AGENTS.md", detail: "Start a conversation with the /init prompt drafted", group: "Actions", icon: icon(SparkIcon),
        disabledReason: desktopOnly ?? (!project?.workingDirectory ? "Open a project folder first." : undefined),
        run: () => { if (project) void detectInstructionFiles(api, project.id).then((found) => createTask(project.id, initPrompt(found))); } },
      { id: "follow-agent", label: settings?.followAgent ? "Stop following the agent in Files" : "Follow the agent in Files", group: "Workspace", icon: icon(MousePointerClickIcon),
        disabledReason: readOnly ? "Read-only viewers cannot change this." : undefined,
        run: () => {
          const on = !settings?.followAgent;
          void updateSettings({ followAgent: on }).then(() => { if (on) openInspector("files"); }, (error: unknown) => setNotice(formatUserError(error)));
        } },
      { id: "browser-inspect", label: "Inspect element in browser", detail: "Pick an element and attach its selector, HTML, styles and a screenshot", group: "Workspace", icon: icon(MousePointerClickIcon),
        disabledReason: desktopOnly, run: () => { openInspector("browser"); requestBrowserCommand({ type: "inspect" }); } },
      ...BROWSER_DEVICES.map((device): Entry => ({
        id: `browser-device-${device.id}`, label: `Browser size: ${device.label}`, detail: device.width ? `${device.width} × ${device.height} at ${device.scale}x` : "Fill the panel", group: "Workspace", icon: icon(SmartphoneIcon),
        searchOnly: true, disabledReason: desktopOnly, run: () => { openInspector("browser"); requestBrowserCommand({ type: "device", device: device.id }); },
      })),
      ...APPROVAL_PRESETS.map((preset): Entry => ({
        id: `approvals-${preset.label.toLowerCase()}`, label: `Approvals: ${preset.label}`, detail: preset.summary, group: "Actions", icon: icon(ShieldIcon), keywords: "permissions", searchOnly: true,
        disabledReason: readOnly ?? (approvalPreset(session ? session.permissionProfile ?? settings?.defaultPermission : draftApproval ?? settings?.defaultPermission).id === preset.id ? "Already in use for this conversation." : undefined),
        run: () => { if (session) void setPermissionProfile(preset.id); else setDraftApproval(preset.id); },
      })),
      { id: "fork-last-turn", label: "Fork conversation from last turn", group: "Actions", icon: icon(GitBranchIcon),
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : !lastTurn ? "This conversation has no finished turn to fork from." : undefined),
        run: () => { if (lastTurn) void branching.fork(lastTurn.id, "same"); } },
      { id: "import-sessions", label: "Import sessions from Claude Code or Codex…", detail: "Sessions those agents ran in this project's folder", group: "Actions", icon: icon(HistoryIcon),
        disabledReason: importSessions.disabledReason ?? (!project ? "Open a project first." : !project.workingDirectory ? "Attach a folder first. Sessions are matched to the folder they ran in." : undefined),
        run: () => { if (project) importSessions.openImport(project.id); } },
      { id: "redo-restore", label: "Redo last restore", group: "Actions", icon: icon(RedoIcon),
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : !branching.redo ? "Nothing to redo. Redo lasts until the next message after a restore." : undefined),
        run: () => void branching.redoLast() },
    ];
  }

  /* Settings files, plugins, profiles, automations and Capsule commands. */
  function customizationEntries(): Entry[] {
    const goTo = (tab: Parameters<typeof setSettingsTab>[0]) => () => { setSettingsTab(tab); setView("settings"); };
    const files = customizationCommands({
      api, config, onError: setNotice,
      showProblems: goTo("diagnostics"),
      openPlugins: (intent) => { if (intent) requestPluginIntent(intent); goTo("plugins")(); },
    }).map(({ onSelect, icon: glyph, ...item }): Entry => ({ ...item, icon: glyph, searchOnly: true, run: onSelect }));
    return [
      ...files,
      ...(config?.profiles ?? []).map((profile): Entry => ({
        id: `profile-${profile.id}`, label: `New conversation with ${profile.name}`, detail: profile.description, group: "Profiles",
        icon: icon(MessageSquarePlusIcon), disabledReason: readOnly, run: () => void startWithProfile(profile.id),
      })),
      /* Every row of Settings by name, opened at the row itself. */
      ...SETTINGS_SEARCH_ITEMS.map((item): Entry => ({
        id: `setting-${item.section}-${item.title}`, label: item.title, detail: `Settings › ${SETTINGS_SECTION_LABELS[item.section]}`, group: "Settings",
        keywords: `settings ${SETTINGS_SECTION_LABELS[item.section]} ${item.keywords?.join(" ") ?? ""}`, searchOnly: true, icon: icon(SettingsIcon),
        run: () => { revealSetting(item.title); goTo(item.section)(); },
      })),
      /* A command takes arguments, so choosing one puts it in the message box rather than sending it. */
      ...(commands?.list?.commands ?? []).map((command): Entry => ({
        id: `command-${command.name}`, label: `Run command: /${command.name}`, detail: commandDetail(command), group: "Commands",
        icon: icon(TerminalIcon), disabledReason: readOnly, searchOnly: true, run: () => { setView("chat"); setDraft(`/${command.name} `); },
      })),
      /* The same run as Conversation details: a tab of its own in the terminal dock. */
      ...(project?.workingDirectory ? project.actions ?? [] : []).map((action): Entry => ({
        id: `project-action-${action.id}`, label: `Run project action: ${action.name}`, detail: action.command, group: "Actions",
        icon: icon(TerminalIcon), keywords: "script task terminal", searchOnly: true,
        disabledReason: desktopOnly ?? (settings?.sandbox === "strict" ? "Strict sandbox blocks terminal commands." : undefined),
        run: () => workspace.runProjectAction(action),
      })),
    ];
  }

  /* Rebuilt per render: ranking a few hundred rows is cheaper than keeping a memo honest. */
  function buildEntries(): Entry[] {
    if (page === "new-in") {
      return projects.map((item) => ({
        id: `new-in-${item.id}`, label: item.name, detail: item.workingDirectory, group: "New conversation in",
        icon: icon(FolderIcon), disabledReason: readOnly, run: () => createTask(item.id),
      }));
    }
    if (page === "archived") {
      return archived.map((item) => ({
        id: `archived-${item.id}`, label: item.title, detail: projects.find((entry) => entry.id === item.projectId)?.name, group: "Archived conversations",
        icon: icon(HistoryIcon), disabledReason: desktopOnly,
        run: () => void workspace.restoreSession(item.id).then(() => { setProjectId(item.projectId, item.id); setView("chat"); }),
      }));
    }
    const current = settings?.appearanceTheme ?? "system";
    /* createTask and pickProjectDirectory fall back to the first project; say which one a row acts on. */
    const target = project ?? projects[0];
    const showing = (tab: "changes" | "browser") => inspectorOpen && inspectorTab === tab;
    const togglePanel = (tab: "changes" | "browser") => { if (showing(tab)) setInspectorOpen(false); else openInspector(tab); };
    const actions: Entry[] = [
      { id: "new", label: target ? `New conversation in ${target.name}` : "New conversation", group: "Actions", icon: icon(PlusIcon), command: "new-conversation", keywords: "create start thread",
        disabledReason: readOnly ?? (target ? undefined : "Add a project first."), run: () => createTask() },
      { id: "new-in", label: "New conversation in…", group: "Actions", icon: icon(MessageSquarePlusIcon), keywords: "project", keepOpen: true,
        disabledReason: readOnly ?? (projects.length ? undefined : "Add a project first."), run: () => openPage("new-in") },
      { id: "new-project", label: "New project from folder", group: "Actions", icon: icon(FolderIcon), disabledReason: desktopOnly, run: createProjectFromFolder },
      { id: "set-up-capsule", label: "Set up Capsule", detail: "Choose an agent and a folder", group: "Actions", icon: icon(SparkIcon), keywords: "onboarding first run welcome install sign in", disabledReason: desktopOnly, run: () => requestFirstRun() },
      { id: "open-folder", label: "Open folder", detail: !target || target.name === "Inbox" ? "Add it as a project" : `Use it as ${target.name}’s folder`, group: "Actions", icon: icon(FolderIcon), command: "open-folder",
        disabledReason: desktopOnly, run: () => pickProjectDirectory() },
      { id: "open-files", label: "Open files", group: "Actions", icon: icon(FolderIcon), command: "open-files", disabledReason: desktopOnly, run: pickFilesToMention },
      { id: "go-to-file", label: "Go to file…", group: "Go to", icon: icon(FileIcon), command: "search-files", keywords: "open search find",
        disabledReason: folder ? undefined : "Open a folder first.", run: () => setFilePicker(true) },
      { id: "search-in-files", label: "Search in files…", group: "Go to", icon: icon(SearchIcon), command: "search-in-files", keywords: "grep find text",
        disabledReason: folder ? undefined : "Open a folder first.", run: () => setContentSearch(true) },
      { id: "terminal", label: terminalOpen ? "Hide terminal" : "Show terminal", group: "Workspace", icon: icon(TerminalIcon), command: "toggle-terminal",
        disabledReason: desktopOnly ?? (folder ? undefined : "Open a folder first."), run: () => { setView("chat"); setTerminalOpen(!terminalOpen); } },
      { id: "sidebar", label: sidebarCollapsed ? "Show sidebar" : "Hide sidebar", group: "Workspace", icon: icon(PanelLeftIcon), command: "toggle-sidebar", run: () => setSidebarCollapsed(!sidebarCollapsed) },
      { id: "panel", label: inspectorOpen ? "Hide panel" : "Show panel", group: "Workspace", icon: icon(PanelRightIcon), command: "toggle-inspector", keywords: "inspector", run: () => setInspectorOpen(!inspectorOpen) },
      /* Review and Browser toggle like their keys: shown on their own surface, the row hides the panel. */
      { id: "review", label: showing("changes") ? "Hide Review" : "Open Review", group: "Workspace", icon: icon(DiffIcon), command: "open-review", keywords: "diff changes toggle",
        run: () => togglePanel("changes") },
      { id: "reopen-panel", label: "Reopen the closed panel", group: "Workspace", icon: icon(PanelRightIcon), command: "reopen-panel",
        disabledReason: inspectorOpen ? "The panel is open." : undefined, run: () => window.dispatchEvent(new CustomEvent(REOPEN_PANEL_EVENT)) },
      { id: "browser", label: showing("browser") ? "Hide browser" : "Open browser", group: "Workspace", icon: icon(GlobeIcon), command: "open-browser", keywords: "toggle",
        run: () => togglePanel("browser") },
      { id: "simulator", label: "Open iOS Simulator", group: "Workspace", icon: icon(SmartphoneIcon), searchOnly: true, disabledReason: desktopOnly ?? (api.platform && api.platform !== "darwin" ? "Available on macOS with Xcode." : undefined), run: () => openInspector("simulator") },
      { id: "open-in-favorite", label: "Open folder in favourite app", group: "Workspace", icon: icon(FolderIcon), command: "open-in-favorite", keywords: "editor open in",
        disabledReason: desktopOnly ?? (folder ? undefined : "Open a folder first."), run: () => { setView("chat"); window.dispatchEvent(new CustomEvent(OPEN_IN_EVENT)); } },
      { id: "open-in-settings", label: "Manage Open in apps", group: "Workspace", icon: icon(SettingsIcon), keywords: "editor open in", disabledReason: desktopOnly,
        run: () => { workspace.setSettingsTab("projects"); setView("settings"); } },
      { id: "dictation", label: "Start or finish dictation", group: "Workspace", icon: icon(MessageSquareIcon), command: "dictation", keywords: "voice microphone speak",
        disabledReason: !session ? "Open a conversation first." : undefined, run: () => { setView("chat"); window.dispatchEvent(new CustomEvent(TOGGLE_DICTATION_EVENT)); } },
      { id: "back", label: "Back", group: "Go to", icon: icon(ArrowLeftIcon), command: "history-back", disabledReason: canGoBack ? undefined : "No earlier conversation to go back to.", run: goBack },
      { id: "forward", label: "Forward", group: "Go to", icon: icon(ArrowRightIcon), command: "history-forward", disabledReason: canGoForward ? undefined : "No later conversation to go forward to.", run: goForward },
      { id: "find-in-thread", label: "Find in conversation", group: "Workspace", icon: icon(SearchIcon), command: "find-in-thread", disabledReason: !session ? "Open a conversation first." : undefined, run: () => { setView("chat"); setThreadFind(true); } },
      { id: "jump-to-prompt", label: "Jump to a prompt…", group: "Workspace", icon: icon(ListIcon), command: "jump-to-prompt", disabledReason: !session ? "Open a conversation first." : undefined, run: () => { setView("chat"); setPromptJump(true); } },
      ...(["previous-turn", "next-turn"] as const).map((id): Entry => ({
        id, label: id === "previous-turn" ? "Previous turn" : "Next turn", group: "Workspace", icon: icon(id === "previous-turn" ? ArrowUpIcon : ArrowDownIcon), command: id, keywords: "prompt scroll",
        disabledReason: !session ? "Open a conversation first." : undefined,
        /* The conversation's turn rail owns stepping; it listens once the conversation is on screen. */
        run: () => { setView("chat"); requestAnimationFrame(() => window.dispatchEvent(new CustomEvent(KEY_COMMAND_EVENT, { detail: { id } }))); },
      })),
      { id: "focus-composer", label: "Focus the composer", group: "Workspace", icon: icon(MessageSquareIcon), command: "focus-composer", keywords: "message type input",
        disabledReason: !session ? "Open a conversation first." : undefined,
        run: () => { setView("chat"); requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>("textarea.composer-field")?.focus()); } },
      ...workflowEntries(),
      ...gitEntries(),
      { id: "board", label: "Board", group: "Go to", icon: icon(ColumnsIcon), keywords: "tasks cards", run: () => setView("board") },
      { id: "chat", label: "Open conversation", group: "Go to", icon: icon(MessageSquareIcon), run: () => setView("chat") },
      { id: "channels", label: "Shared channels", group: "Go to", icon: icon(MessageSquareIcon), disabledReason: desktopOnly, run: () => setView("channels") },
      { id: "skills", label: "Skills", group: "Go to", icon: icon(SparkIcon), run: () => setView("skills") },
      { id: "harness", label: "Agents", group: "Go to", icon: icon(CpuIcon), keywords: "harness", run: () => setView("runtimes") },
      { id: "shortcuts", label: "Keyboard shortcuts", group: "Go to", icon: icon(KeyboardIcon), command: "show-shortcuts", keywords: "keys", run: () => window.dispatchEvent(new CustomEvent(SHOW_SHORTCUTS_EVENT)) },
      { id: "archived", label: "Archived conversations…", group: "Go to", icon: icon(HistoryIcon), keywords: "restore unarchive", keepOpen: true,
        disabledReason: archived.length ? undefined : "Nothing is archived.", run: () => openPage("archived") },
      { id: "thread-agents", label: "Thread agents", group: "Go to", icon: icon(CpuIcon), run: () => openInspector("agents") },
      { id: "agent-commands", label: "Agent commands", group: "Go to", icon: icon(TerminalIcon), disabledReason: !session?.harnessId ? "Start an agent conversation first." : undefined, run: () => { setView("chat"); setAgentCommandsOpen(true); } },
      { id: "approvals", label: "Approvals", group: "Go to", icon: icon(ShieldIcon), run: () => setView("approvals") },
      { id: "usage", label: "Usage", group: "Go to", icon: icon(ChartIcon), keywords: "tokens limits quota cost models projects", run: () => setView("usage") },
      { id: "settings", label: "Settings", group: "Go to", icon: icon(SettingsIcon), command: "settings", keywords: "preferences", run: () => setView("settings") },
      ...THEMES.map((theme): Entry => ({
        id: `theme-${theme.id}`, label: theme.label, group: "Theme", icon: theme.icon, keywords: "appearance colour color mode",
        detail: theme.id === current ? "Current" : undefined, disabledReason: desktopOnly,
        run: () => updateSettings({ appearanceTheme: theme.id }),
      })),
      ...(settings?.runtimeMode === "direct" ? [] : [{ id: "connect", label: "Connect Gateway", group: "Workspace", icon: icon(LinkIcon), disabledReason: desktopOnly, run: () => api.connectGateway() }]),
      ...(api.isDesktop === true ? [
        { id: "pet-show", label: "Show desktop companion", group: "Workspace", icon: icon(SmilePlusIcon), searchOnly: true, run: () => api.togglePet(true) },
        { id: "pet-hide", label: "Hide desktop companion", group: "Workspace", icon: icon(SmilePlusIcon), searchOnly: true, run: () => api.togglePet(false) },
      ] : []),
      /* The sidebar's update control, by name: it checks, downloads or restarts, whichever comes next. */
      ...(updates?.available ? [{ id: "update", label: updates.label, group: "Workspace", icon: icon(RefreshIcon), keywords: "check updates upgrade version download install restart",
        disabledReason: updates.status?.development ? updates.status.detail ?? "This build cannot update itself." : updates.busy ? "Already in progress." : undefined,
        run: updates.run }] : []),
      { id: "about", label: "About Capsule", detail: updates?.status?.current ? `Version ${updates.status.current}` : undefined, group: "Workspace", icon: icon(InfoIcon), keywords: "version release notes", run: () => setAboutOpen(true) },
      ...customizationEntries(),
    ];
    const projectNames = new Map(projects.map((item) => [item.id, item.name]));
    /* Activity is the latest turn, so a rename or a pin does not make a thread look new. */
    const threads: Entry[] = sessions.filter((item) => item.state === "active" && item.id !== session?.id)
      .map((item) => ({ item, active: threadActivityAt(item, latestRuns.get(item.id)) }))
      .sort((a, b) => b.active.localeCompare(a.active))
      .map(({ item, active }) => ({
        id: `session-${item.id}`, label: item.title, detail: projectNames.get(item.projectId), meta: compactRelativeTime(active),
        keywords: projectNames.get(item.projectId), recency: Date.parse(active) || undefined,
        group: query ? "Conversations" : "Recent conversations", icon: icon(MessageSquareIcon),
        run: () => { setProjectId(item.projectId, item.id); setView("chat"); },
      }));
    const projectItems: Entry[] = projects.map((item) => ({
      id: `project-${item.id}`, label: item.name, detail: item.workingDirectory, group: "Projects", icon: icon(FolderIcon), searchOnly: true,
      run: () => { setProjectId(item.id); setView("chat"); },
    }));
    /* "New conversation in <project>" for every project, typed straight from the root; the current one is the Actions row. */
    const newIn: Entry[] = projects.filter((item) => item.id !== target?.id).map((item) => ({
      id: `new-in-root-${item.id}`, label: `New conversation in ${item.name}`, group: "Actions", icon: icon(PlusIcon), keywords: "create start thread project",
      searchOnly: true, disabledReason: readOnly, run: () => createTask(item.id),
    }));
    return [...threads, ...(session ? conversationEntries(session) : []), ...actions, ...newIn, ...projectItems]
      .filter((entry) => !commandsOnly || !CONTENT_GROUPS.includes(entry.group))
      .sort((a, b) => groupRank(a.group) - groupRank(b.group));
  }

  function buildItems(): SearchDialogItem[] {
    const ranked = rankPalette(buildEntries(), query, { limits: { "Recent conversations": 5, Conversations: 30, Projects: 20 }, content: CONTENT_GROUPS }) as Array<Entry & { matches: number[] }>;
    const rows: SearchDialogItem[] = ranked.map((entry) => ({
      id: entry.id, label: entry.label, detail: entry.detail, meta: entry.meta, group: entry.group, icon: entry.icon, matches: entry.matches,
      shortcut: entry.command ? shortcutLabel(entry.command, keyBindings) : entry.shortcut, disabledReason: entry.disabledReason,
      keepOpen: entry.keepOpen, onSelect: entry.run,
    }));
    /* A hit opens its thread with find on the words, so it lands on the message rather than the top. */
    const messages: SearchDialogItem[] = messageSearch.messages.slice(0, 30).map((message) => ({
      id: `message-${message.id}`, label: message.sessionTitle, detail: message.excerpt, group: "Messages", icon: icon(SearchIcon),
      onSelect: () => findInThread(message.projectId, message.sessionId, query),
    }));
    return [...rows, ...messages];
  }

  const items = buildItems();

  const close = () => { setPalette(false); setPaletteQuery(""); };
  if (page === "archived") {
    return <SearchDialog className="command-palette" title="Archived conversations" placeholder="Choose a conversation to restore…" query={paletteQuery}
      onQueryChange={setPaletteQuery} items={items} selectLabel="Restore" onBack={() => openPage("root")}
      empty={archived.length ? "No matching conversations." : "Nothing is archived."} onClose={close} />;
  }
  if (page === "new-in") {
    return <SearchDialog className="command-palette" title="New conversation in" placeholder="Choose a project…" query={paletteQuery}
      onQueryChange={setPaletteQuery} items={items} selectLabel="Start" onBack={() => openPage("root")}
      empty={projects.length ? "No matching projects." : "No projects yet."} onClose={close} />;
  }
  return <SearchDialog className="command-palette" title="Search workspace" placeholder="Search commands, projects, conversations…" query={paletteQuery}
    onQueryChange={setPaletteQuery} items={items} status={messageSearch.pending && messageSearch.messages.length === 0 ? "Searching messages…" : undefined}
    error={messageSearch.error} onRetry={messageSearch.retry} empty={commandsOnly ? "No matching commands." : "No matching commands, projects, or conversations."}
    onClose={close} />;
}
