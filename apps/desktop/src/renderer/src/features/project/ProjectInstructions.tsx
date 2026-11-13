import { useEffect, useState } from "react";
import { useWorkspace } from "../../lib/workspace";
import { FileIcon } from "../shell/icons";

/** Instruction files coding agents look for at a project's root. */
export const INSTRUCTION_FILES = ["AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", ".claude/CLAUDE.md", "GEMINI.md"] as const;

/** Past this, an instruction file costs context on every turn and its rules start to get lost. */
export const INSTRUCTION_LINE_BUDGET = 200;

interface Found { path: string; lines: number }

/**
 * Which instruction files this project has, how long each is, and a way to
 * open them. Agents read these on every turn, so a short file is a better one.
 */
export function ProjectInstructions({ projectId }: { projectId: string }) {
  const { api, openFile } = useWorkspace();
  const [found, setFound] = useState<Found[]>();
  useEffect(() => {
    let live = true;
    setFound(undefined);
    void Promise.all(INSTRUCTION_FILES.map(async (path): Promise<Found | undefined> => {
      try {
        const text = String(await api.readFile(projectId, path));
        return { path, lines: text.replace(/\n$/, "").split("\n").length };
      } catch {
        return undefined;
      }
    })).then((results) => { if (live) setFound(results.filter((item): item is Found => Boolean(item))); });
    return () => { live = false; };
  }, [api, projectId]);

  return (
    <div className="card project-instructions">
      <h3>Instructions</h3>
      <p className="muted">
        Files agents read at the start of every turn: test commands, conventions, and anything they cannot work out from the code. Keep each under {INSTRUCTION_LINE_BUDGET} lines.
      </p>
      {found === undefined ? <p className="faint" role="status">Looking for instruction files…</p> : found.length === 0 ? (
        <p className="faint">None yet. An AGENTS.md at the project root is read by most coding agents.</p>
      ) : found.map((file) => (
        <div className="row project-instruction-row" key={file.path}>
          <span className="inline-icon"><FileIcon size={12} /><code className="mono">{file.path}</code></span>
          <span className={file.lines > INSTRUCTION_LINE_BUDGET ? "project-instruction-lines over" : "project-instruction-lines"}>
            {file.lines} {file.lines === 1 ? "line" : "lines"}{file.lines > INSTRUCTION_LINE_BUDGET ? " · worth trimming" : ""}
          </span>
          <button type="button" className="chip" onClick={() => openFile(file.path)}>Open</button>
        </div>
      ))}
    </div>
  );
}
