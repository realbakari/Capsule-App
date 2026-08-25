import { useMemo } from "react";
import { useWorkspace } from "../../lib/workspace";

export function Palette() {
  const { api, palette, paletteQuery, setPalette, setPaletteQuery, setView, createTask } =
    useWorkspace();
  const commands = useMemo(
    () =>
      [
        { id: "new", label: "New task", run: () => createTask() },
        { id: "chat", label: "Open conversation", run: () => setView("chat") },
        { id: "harness", label: "Open Claude / Codex harnesses", run: () => setView("runtimes") },
        { id: "skills", label: "Open skills", run: () => setView("skills") },
        { id: "runs", label: "Open active runs", run: () => setView("history") },
        { id: "approvals", label: "Open approvals", run: () => setView("approvals") },
        { id: "connect", label: "Connect OpenClaw", run: () => api.connectGateway() },
        { id: "settings", label: "Open settings", run: () => setView("settings") },
      ].filter((command) => command.label.toLowerCase().includes(paletteQuery.toLowerCase())),
    [api, createTask, paletteQuery, setView],
  );

  if (!palette) return null;
  return (
    <div className="palette-backdrop" onClick={() => setPalette(false)}>
      <div className="palette" onClick={(event) => event.stopPropagation()}>
        <input
          autoFocus
          placeholder="Search commands..."
          value={paletteQuery}
          onChange={(event) => setPaletteQuery(event.target.value)}
        />
        {commands.map((command) => (
          <button
            key={command.id}
            onClick={() => {
              void command.run();
              setPalette(false);
              setPaletteQuery("");
            }}
          >
            {command.label}
          </button>
        ))}
      </div>
    </div>
  );
}
