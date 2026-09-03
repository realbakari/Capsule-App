import { useEffect, useMemo, useState } from "react";
import type { SearchResults } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { SearchIcon } from "./icons";

export function Palette() {
  const {
    api,
    palette,
    paletteQuery,
    setPalette,
    setPaletteQuery,
    setView,
    createTask,
    createProjectFromFolder,
    pickProjectDirectory,
    pickFilesToMention,
    projects,
    sessions,
    setProjectId,
    setAboutOpen,
  } = useWorkspace();
  const [index, setIndex] = useState(0);
  const [hits, setHits] = useState<SearchResults>();

  useEffect(() => {
    if (!palette || paletteQuery.trim().length < 2) {
      setHits(undefined);
      return;
    }
    void api.search(paletteQuery).then((result: SearchResults) => setHits(result));
  }, [api, palette, paletteQuery]);

  const commands = useMemo(() => {
    const query = paletteQuery.toLowerCase();
    const actions = [
      { id: "new", label: "New conversation", run: () => createTask() },
      { id: "new-project", label: "New project from folder", run: () => createProjectFromFolder() },
      { id: "open-folder", label: "Open folder", run: () => pickProjectDirectory() },
      { id: "open-files", label: "Open files", run: () => pickFilesToMention() },
      { id: "chat", label: "Open conversation", run: () => setView("chat") },
      { id: "skills", label: "Open skills & packs", run: () => setView("skills") },
      { id: "harness", label: "Open ACP harnesses", run: () => setView("runtimes") },
      { id: "runs", label: "Open active runs", run: () => setView("history") },
      { id: "approvals", label: "Open approvals", run: () => setView("approvals") },
      { id: "connect", label: "Connect OpenClaw", run: () => api.connectGateway() },
      { id: "settings", label: "Open settings", run: () => setView("settings") },
      { id: "update", label: "Check for updates", run: () => setAboutOpen(true) },
      { id: "about", label: "About Capsule", run: () => setAboutOpen(true) },
    ].filter((command) => command.label.toLowerCase().includes(query));
    const projectHits = projects
      .filter((item) => item.name.toLowerCase().includes(query))
      .map((item) => ({
        id: `project-${item.id}`,
        label: `Project · ${item.name}`,
        run: () => {
          setProjectId(item.id);
          setView("chat");
        },
      }));
    const sessionHits = sessions
      .filter((item) => item.title.toLowerCase().includes(query) && item.state === "active")
      .map((item) => ({
        id: `session-${item.id}`,
        label: `Thread · ${item.title}`,
        run: () => {
          setProjectId(item.projectId, item.id);
          setView("chat");
        },
      }));
    const messageHits =
      hits?.messages.map((item) => ({
        id: `msg-${item.id}`,
        label: `Message · ${item.sessionTitle} — ${item.excerpt}`,
        run: () => {
          setProjectId(item.projectId, item.sessionId);
          setView("chat");
        },
      })) ?? [];
    return query ? [...actions, ...projectHits, ...sessionHits, ...messageHits] : actions;
  }, [
    api,
    createProjectFromFolder,
    pickProjectDirectory,
    pickFilesToMention,
    createTask,
    hits,
    paletteQuery,
    projects,
    sessions,
    setProjectId,
    setView,
  ]);

  useEffect(() => {
    setIndex(0);
  }, [paletteQuery, palette]);

  function run(command: (typeof commands)[number]) {
    void command.run();
    setPalette(false);
    setPaletteQuery("");
  }

  if (!palette) return null;
  return (
    <div className="palette-backdrop" onClick={() => setPalette(false)}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <div className="palette-search-row">
          <SearchIcon size={16} />
          <input
            autoFocus
            placeholder="Search commands, projects, threads…"
            value={paletteQuery}
            onChange={(event) => setPaletteQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((current) => Math.min(commands.length - 1, current + 1));
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((current) => Math.max(0, current - 1));
              }
              if (event.key === "Enter" && commands[index]) {
                event.preventDefault();
                run(commands[index]);
              }
              if (event.key === "Escape") {
                setPalette(false);
              }
            }}
          />
        </div>
        <div className="palette-list">
          {commands.length === 0 && (
            <p className="palette-empty">No command matches that.</p>
          )}
          {commands.map((command, commandIndex) => (
            <button
              key={command.id}
              className={commandIndex === index ? "active" : ""}
              onMouseEnter={() => setIndex(commandIndex)}
              onClick={() => run(command)}
            >
              {command.label}
            </button>
          ))}
        </div>
        {/* The palette is keyboard-first, but nothing said so. These are the
            keys the handler above already implements. */}
        <div className="palette-hints" aria-hidden>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>Enter</kbd> Select
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </div>
      </div>
    </div>
  );
}
