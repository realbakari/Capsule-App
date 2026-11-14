import { useEffect, useMemo, useState } from "react";
import { DIFF_SCOPES, searchSessionTitles, type DiffScope, type SearchResults } from "@capsule/shared";
import { setReviewScope } from "../../lib/review-scope";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { SHOW_SHORTCUTS_EVENT } from "../../lib/shortcuts-event";
import { CYCLE_FAVORITE_MODEL_EVENT } from "../../lib/turn-mode";
import { requestNewBoardCard } from "../../lib/board";
import { requestRunOn } from "../../lib/best-of-n";
import { CompareIcon, CopyIcon, FileIcon, GitBranchIcon, GitMergeIcon, RedoIcon, ArrowLeftIcon, ArrowRightIcon, ColumnsIcon, CpuIcon, ListTodoIcon, StarIcon, DiffIcon, FolderIcon, GlobeIcon, HistoryIcon, InfoIcon, RefreshIcon, KeyboardIcon, LinkIcon, MessageSquareIcon, PlusIcon, SearchIcon, SettingsIcon, ShieldIcon, SmartphoneIcon, SmilePlusIcon, SparkIcon, TerminalIcon } from "./icons";
import { SearchDialog, type SearchDialogItem } from "./SearchDialog";
import { useBranching } from "../conversation/branching/use-branching";
import { useApplyToLocal } from "../apply/ApplyToLocal";
import { useThreadShare } from "../share/ThreadShare";
import { initPrompt } from "@capsule/shared";
import { currentSelection, NO_SELECTION, selectionContext } from "../../lib/selection-share";
import { detectInstructionFiles } from "../project/ProjectInstructions";

const REVIEW_SCOPE_LABEL: Record<DiffScope, string> = {
  uncommitted: "Review uncommitted changes",
  staged: "Review staged changes",
  unstaged: "Review unstaged changes",
  turn: "Review this turn's changes",
  branch: "Review branch changes",
};

export function Palette() {
  const {
    api, palette, paletteQuery, setPalette, setPaletteQuery, setView, createTask, canGoBack, canGoForward, goBack, goForward, setThreadFind,
    createProjectFromFolder, pickProjectDirectory, pickFilesToMention, projects,
    sessions, session, setProjectId, setAboutOpen, openInspector, setAgentCommandsOpen,
    project, terminalOpen, setTerminalOpen, runs, turnMode, setTurnMode, attachContext, setNotice,
  } = useWorkspace();
  const branching = useBranching();
  const lastTurn = useMemo(() => runs
    .filter((run) => run.sessionId === session?.id && !["queued", "running", "waiting", "approval_required"].includes(run.status))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0], [runs, session?.id]);
  const applyToLocal = useApplyToLocal();
  const share = useThreadShare();
  const query = paletteQuery.trim().toLowerCase();
  const [retry, setRetry] = useState(0);
  const [search, setSearch] = useState<{ query: string; hits?: SearchResults; error?: string }>();
  const currentSearch = search?.query === query ? search : undefined;

  useEffect(() => {
    if (!palette || query.length < 2) return;
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
  }, [api, palette, query, retry]);

  const items = useMemo<SearchDialogItem[]>(() => {
    const desktopOnly = api.isDesktop === false ? "Available in the desktop app." : undefined;
    const readOnly = api.isDesktop === false && api.remoteMode !== "control" ? "Read only on this device." : undefined;
    const actions: SearchDialogItem[] = [
      { id: "new", label: "New conversation", group: "Actions", icon: <PlusIcon size={15} />, shortcut: "⌘N", disabledReason: desktopOnly, onSelect: () => createTask() },
      { id: "run-on-several", label: "Run on several agents…", detail: "One prompt, two to four agents, each in its own worktree", group: "Actions", icon: <CompareIcon size={15} />,
        disabledReason: desktopOnly ?? (projects.length === 0 ? "Add a project first." : undefined),
        onSelect: () => {
          setView("chat");
          requestRunOn();
          /* An untouched new conversation is where the prompt goes; anything else gets a fresh one. */
          if (!session || runs.some((run) => run.sessionId === session.id)) void createTask();
        } },
      ...(session?.groupId ? [{ id: "compare", label: "Compare candidates", group: "Workspace", icon: <CompareIcon size={15} />, onSelect: () => { setView("chat"); openInspector("compare"); } }] : []),
      { id: "new-board-card", label: "New board card", group: "Actions", icon: <ColumnsIcon size={15} />, disabledReason: desktopOnly ?? (projects.length === 0 ? "Add a project first." : undefined), onSelect: () => { setView("board"); requestNewBoardCard(); } },
      { id: "new-project", label: "New project from folder", group: "Actions", icon: <FolderIcon size={15} />, disabledReason: desktopOnly, onSelect: createProjectFromFolder },
      { id: "open-folder", label: "Open folder", group: "Actions", icon: <FolderIcon size={15} />, disabledReason: desktopOnly, onSelect: pickProjectDirectory },
      turnMode === "plan"
        ? { id: "turn-act", label: "Switch to Act mode", group: "Actions", icon: <ListTodoIcon size={15} />, shortcut: "⇧Tab", disabledReason: readOnly, onSelect: () => { setView("chat"); void setTurnMode("act"); } }
        : { id: "turn-plan", label: "Switch to Plan mode", group: "Actions", icon: <ListTodoIcon size={15} />, shortcut: "⇧Tab", disabledReason: readOnly, onSelect: () => { setView("chat"); void setTurnMode("plan"); } },
      { id: "cycle-favorite-model", label: "Next favorite model", group: "Actions", icon: <StarIcon size={15} />, shortcut: "⌥⌘M", disabledReason: readOnly, onSelect: () => { setView("chat"); window.dispatchEvent(new CustomEvent(CYCLE_FAVORITE_MODEL_EVENT)); } },
      { id: "open-files", label: "Open files", group: "Actions", icon: <FolderIcon size={15} />, disabledReason: desktopOnly, onSelect: pickFilesToMention },
      { id: "terminal", label: terminalOpen ? "Hide terminal" : "Show terminal", group: "Workspace", icon: <TerminalIcon size={15} />, shortcut: "⌘J", disabledReason: desktopOnly ?? (!(session?.workingDirectory ?? project?.workingDirectory) ? "Open a folder first." : undefined), onSelect: () => { setView("chat"); setTerminalOpen(!terminalOpen); } },
      ...DIFF_SCOPES.map((scope) => ({
        id: `review-${scope.id}`, label: REVIEW_SCOPE_LABEL[scope.id], detail: scope.detail, group: "Workspace", icon: <DiffIcon size={15} />,
        disabledReason: !project ? "Open a project first." : scope.id === "turn" && !session ? "Open a conversation first." : undefined,
        onSelect: () => { if (project) setReviewScope(project.id, scope.id); openInspector("changes"); },
      })),
      ...(applyToLocal.offered ? [{ id: "apply-to-local", label: "Apply worktree to local checkout", group: "Workspace", icon: <GitMergeIcon size={15} />, disabledReason: applyToLocal.disabledReason, onSelect: applyToLocal.apply }] : []),
      { id: "send-selection", label: "Send selection to thread", detail: "Quote the selected terminal, file or browser text in the composer", group: "Workspace", icon: <MessageSquareIcon size={15} />,
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : undefined),
        onSelect: () => { void currentSelection().then((selection) => { if (selection) { setView("chat"); void attachContext(selectionContext(selection)); } else setNotice(NO_SELECTION); }); } },
      { id: "init", label: "Write or refresh AGENTS.md", detail: "Start a conversation with the /init prompt drafted", group: "Actions", icon: <SparkIcon size={15} />,
        disabledReason: desktopOnly ?? (!project?.workingDirectory ? "Open a project folder first." : undefined),
        onSelect: () => { if (project) void detectInstructionFiles(api, project.id).then((found) => createTask(project.id, initPrompt(found))); } },
      { id: "browser", label: "Open browser", group: "Workspace", icon: <GlobeIcon size={15} />, onSelect: () => openInspector("browser") },
      { id: "simulator", label: "Open iOS Simulator", group: "Workspace", icon: <SmartphoneIcon size={15} />, disabledReason: desktopOnly ?? (api.platform && api.platform !== "darwin" ? "Available on macOS with Xcode." : undefined), onSelect: () => openInspector("simulator") },
      { id: "fork-last-turn", label: "Fork conversation from last turn", group: "Actions", icon: <GitBranchIcon size={15} />,
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : !lastTurn ? "This conversation has no finished turn to fork from." : undefined),
        onSelect: () => { if (lastTurn) void branching.fork(lastTurn.id, "same"); } },
      { id: "redo-restore", label: "Redo last restore", group: "Actions", icon: <RedoIcon size={15} />,
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : !branching.redo ? "Nothing to redo. Redo lasts until the next message after a restore." : undefined),
        onSelect: () => void branching.redoLast() },
      { id: "export-markdown", label: "Export conversation as Markdown…", group: "Actions", icon: <FileIcon size={15} />,
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : undefined), onSelect: () => { if (session) share.openExport(session.id); } },
      { id: "copy-markdown", label: "Copy conversation as Markdown", group: "Actions", icon: <CopyIcon size={15} />,
        disabledReason: !session ? "Open a conversation first." : undefined, onSelect: () => { if (session) share.copyMarkdown(session.id); } },
      { id: "share-link", label: "Share read-only link…", group: "Actions", icon: <LinkIcon size={15} />,
        disabledReason: desktopOnly ?? (!session ? "Open a conversation first." : undefined), onSelect: () => { if (session) share.openShare(session.id); } },
      { id: "back", label: "Back", group: "Go to", icon: <ArrowLeftIcon size={15} />, shortcut: "⌘[", disabledReason: canGoBack ? undefined : "No earlier conversation to go back to.", onSelect: goBack },
      { id: "forward", label: "Forward", group: "Go to", icon: <ArrowRightIcon size={15} />, shortcut: "⌘]", disabledReason: canGoForward ? undefined : "No later conversation to go forward to.", onSelect: goForward },
      { id: "find-in-thread", label: "Find in conversation", group: "Workspace", icon: <SearchIcon size={15} />, shortcut: "⌘F", disabledReason: !session ? "Open a conversation first." : undefined, onSelect: () => { setView("chat"); setThreadFind(true); } },
      { id: "board", label: "Board", group: "Go to", icon: <ColumnsIcon size={15} />, onSelect: () => setView("board") },
      { id: "chat", label: "Open conversation", group: "Go to", icon: <MessageSquareIcon size={15} />, onSelect: () => setView("chat") },
      { id: "channels", label: "Shared channels", group: "Go to", icon: <MessageSquareIcon size={15} />, disabledReason: desktopOnly, onSelect: () => setView("channels") },
      { id: "skills", label: "Skills & packs", group: "Go to", icon: <SparkIcon size={15} />, onSelect: () => setView("skills") },
      { id: "harness", label: "Agents", group: "Go to", icon: <CpuIcon size={15} />, onSelect: () => setView("runtimes") },
      { id: "shortcuts", label: "Keyboard shortcuts", group: "Go to", icon: <KeyboardIcon size={15} />, shortcut: "⌘/", onSelect: () => window.dispatchEvent(new CustomEvent(SHOW_SHORTCUTS_EVENT)) },
      { id: "runs", label: "Run history", group: "Go to", icon: <HistoryIcon size={15} />, onSelect: () => setView("history") },
      { id: "thread-agents", label: "Thread agents", group: "Go to", icon: <CpuIcon size={15} />, onSelect: () => openInspector("agents") },
      { id: "agent-commands", label: "Agent commands", group: "Go to", icon: <TerminalIcon size={15} />, disabledReason: !session?.harnessId ? "Start an agent conversation first." : undefined, onSelect: () => { setView("chat"); setAgentCommandsOpen(true); } },
      { id: "approvals", label: "Approvals", group: "Go to", icon: <ShieldIcon size={15} />, onSelect: () => setView("approvals") },
      { id: "settings", label: "Settings", group: "Go to", icon: <SettingsIcon size={15} />, onSelect: () => setView("settings") },
      { id: "connect", label: "Connect OpenClaw", group: "Workspace", icon: <LinkIcon size={15} />, disabledReason: desktopOnly, onSelect: () => api.connectGateway() },
      ...(api.isDesktop === true ? [
        { id: "pet-show", label: "Show desktop companion", group: "Workspace", icon: <SmilePlusIcon size={15} />, onSelect: () => api.togglePet(true) },
        { id: "pet-hide", label: "Hide desktop companion", group: "Workspace", icon: <SmilePlusIcon size={15} />, onSelect: () => api.togglePet(false) },
      ] : []),
      { id: "update", label: "Check for updates", group: "Workspace", icon: <RefreshIcon size={15} />, onSelect: () => setAboutOpen(true) },
      { id: "about", label: "About Capsule", group: "Workspace", icon: <InfoIcon size={15} />, onSelect: () => setAboutOpen(true) },
    ].filter((item) => item.label.toLowerCase().includes(query));
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const matchingThreads = searchSessionTitles(sessions.filter((session) => session.state === "active"), query).slice(0, query ? 30 : 5);
    const threads: SearchDialogItem[] = matchingThreads.map((session) => ({
      id: `session-${session.id}`, label: session.title, detail: projectNames.get(session.projectId),
      group: query ? "Conversations" : "Recent conversations", icon: <MessageSquareIcon size={15} />,
      onSelect: () => { setProjectId(session.projectId, session.id); setView("chat"); },
    }));
    if (!query) return [...threads, ...actions];
    const projectItems: SearchDialogItem[] = projects.filter((project) => project.name.toLowerCase().includes(query)).slice(0, 20).map((project) => ({
      id: `project-${project.id}`, label: project.name, group: "Projects", icon: <FolderIcon size={15} />,
      onSelect: () => { setProjectId(project.id); setView("chat"); },
    }));
    const messages: SearchDialogItem[] = (currentSearch?.hits?.messages ?? []).slice(0, 30).map((message) => ({
      id: `message-${message.id}`, label: message.sessionTitle, detail: message.excerpt, group: "Messages", icon: <SearchIcon size={15} />,
      onSelect: () => { setProjectId(message.projectId, message.sessionId); setView("chat"); },
    }));
    return [...actions, ...projectItems, ...threads, ...messages];
  }, [api, query, currentSearch, projects, sessions, session, project, terminalOpen, setTerminalOpen, attachContext, setNotice, createTask, createProjectFromFolder, pickProjectDirectory, pickFilesToMention, setView, setProjectId, setAboutOpen, openInspector, setAgentCommandsOpen, canGoBack, canGoForward, goBack, goForward, setThreadFind, lastTurn, branching.fork, branching.redo, branching.redoLast, applyToLocal, share, turnMode, setTurnMode, runs]);

  if (!palette) return null;
  return <SearchDialog title="Search workspace" placeholder="Search commands, projects, conversations…" query={paletteQuery}
    onQueryChange={setPaletteQuery} items={items} status={query.length >= 2 && !currentSearch ? "Searching messages…" : undefined}
    error={currentSearch?.error} onRetry={() => setRetry((value) => value + 1)} empty="No matching commands, projects, or conversations."
    onClose={() => { setPalette(false); setPaletteQuery(""); }} />;
}
