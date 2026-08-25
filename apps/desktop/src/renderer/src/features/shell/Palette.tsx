import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../../lib/workspace";

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
    projects,
    sessions,
    setProjectId,
    setSessionId,
  } = useWorkspace();
  const [index, setIndex] = useState(0);

  const commands = useMemo(() => {
    const query = paletteQuery.toLowerCase();
    const actions = [
      { id: "new", label: "New conversation", run: () => createTask() },
      { id: "new-project", label: "New project from folder", run: () => createProjectFromFolder() },
      { id: "chat", label: "Open conversation", run: () => setView("chat") },
      { id: "harness", label: "Open Claude / Codex harnesses", run: () => setView("runtimes") },
      { id: "skills", label: "Open skills", run: () => setView("skills") },
      { id: "runs", label: "Open active runs", run: () => setView("history") },
      { id: "approvals", label: "Open approvals", run: () => setView("approvals") },
      { id: "connect", label: "Connect OpenClaw", run: () => api.connectGateway() },
      { id: "settings", label: "Open settings", run: () => setView("settings") },
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
          setProjectId(item.projectId);
          setSessionId(item.id);
          setView("chat");
        },
      }));
    return query ? [...actions, ...projectHits, ...sessionHits] : actions;
  }, [
    api,
    createProjectFromFolder,
    createTask,
    paletteQuery,
    projects,
    sessions,
    setProjectId,
    setSessionId,
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
    </div>
  );
}
