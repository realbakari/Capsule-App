import { useEffect, useMemo, useState } from "react";
import type { SearchResults } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { formatUserError } from "../../lib/errors";
import { CpuIcon, FolderIcon, MessageSquareIcon, PlusIcon, SearchIcon, SettingsIcon } from "./icons";
import { SearchDialog, type SearchDialogItem } from "./SearchDialog";

export function Palette() {
  const {
    api, palette, paletteQuery, setPalette, setPaletteQuery, setView, createTask,
    createProjectFromFolder, pickProjectDirectory, pickFilesToMention, projects,
    sessions, setProjectId, setAboutOpen, openInspector,
  } = useWorkspace();
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
    const actions: SearchDialogItem[] = [
      { id: "new", label: "New conversation", group: "Actions", icon: <PlusIcon size={15} />, shortcut: "⌘N", disabledReason: desktopOnly, onSelect: createTask },
      { id: "new-project", label: "New project from folder", group: "Actions", icon: <FolderIcon size={15} />, disabledReason: desktopOnly, onSelect: createProjectFromFolder },
      { id: "open-folder", label: "Open folder", group: "Actions", icon: <FolderIcon size={15} />, disabledReason: desktopOnly, onSelect: pickProjectDirectory },
      { id: "open-files", label: "Open files", group: "Actions", icon: <FolderIcon size={15} />, disabledReason: desktopOnly, onSelect: pickFilesToMention },
      { id: "chat", label: "Open conversation", group: "Go to", icon: <MessageSquareIcon size={15} />, onSelect: () => setView("chat") },
      { id: "skills", label: "Skills & packs", group: "Go to", onSelect: () => setView("skills") },
      { id: "harness", label: "Agents, harnesses & capabilities", group: "Go to", icon: <CpuIcon size={15} />, onSelect: () => setView("runtimes") },
      { id: "runs", label: "Run history", group: "Go to", onSelect: () => setView("history") },
      { id: "thread-agents", label: "Thread agents", group: "Go to", onSelect: () => openInspector("agents") },
      { id: "approvals", label: "Approvals", group: "Go to", onSelect: () => setView("approvals") },
      { id: "settings", label: "Settings", group: "Go to", icon: <SettingsIcon size={15} />, onSelect: () => setView("settings") },
      { id: "connect", label: "Connect OpenClaw", group: "Workspace", disabledReason: desktopOnly, onSelect: () => api.connectGateway() },
      ...(api.isDesktop === true ? [
        { id: "pet-show", label: "Show desktop companion", group: "Workspace", onSelect: () => api.togglePet(true) },
        { id: "pet-hide", label: "Hide desktop companion", group: "Workspace", onSelect: () => api.togglePet(false) },
      ] : []),
      { id: "update", label: "Check for updates", group: "Workspace", onSelect: () => setAboutOpen(true) },
      { id: "about", label: "About Capsule", group: "Workspace", onSelect: () => setAboutOpen(true) },
    ].filter((item) => item.label.toLowerCase().includes(query));
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const matchingThreads = sessions.filter((session) => session.state === "active" && session.title.toLowerCase().includes(query))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, query ? 30 : 5);
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
  }, [api, query, currentSearch, projects, sessions, createTask, createProjectFromFolder, pickProjectDirectory, pickFilesToMention, setView, setProjectId, setAboutOpen, openInspector]);

  if (!palette) return null;
  return <SearchDialog title="Search workspace" placeholder="Search commands, projects, conversations…" query={paletteQuery}
    onQueryChange={setPaletteQuery} items={items} status={query.length >= 2 && !currentSearch ? "Searching messages…" : undefined}
    error={currentSearch?.error} onRetry={() => setRetry((value) => value + 1)} empty="No matching commands, projects, or conversations."
    onClose={() => { setPalette(false); setPaletteQuery(""); }} />;
}
