import { useEffect, useState } from "react";
import { INSTRUCTION_FILES, initPrompt } from "@capsule/shared";
import { useWorkspace } from "../../lib/workspace";
import { FileIcon, SparkIcon } from "../shell/icons";

/** Past this, an instruction file costs context on every turn and its rules start to get lost. */
export const INSTRUCTION_LINE_BUDGET = 200;

interface Found { path: string; lines: number }

async function readInstructionFiles(api: { readFile: (projectId: string, path: string) => Promise<unknown> }, projectId: string): Promise<Found[]> {
  const results = await Promise.all(INSTRUCTION_FILES.map(async (path): Promise<Found | undefined> => {
    try {
      const text = String(await api.readFile(projectId, path));
      return { path, lines: text.replace(/\n$/, "").split("\n").length };
    } catch {
      return undefined;
    }
  }));
  return results.filter((item): item is Found => Boolean(item));
}

/** The instruction files a project has, by path: what `/init` tells the agent to read first. */
export async function detectInstructionFiles(api: { readFile: (projectId: string, path: string) => Promise<unknown> }, projectId: string): Promise<string[]> {
  return (await readInstructionFiles(api, projectId)).map((file) => file.path);
}

/**
 * Which instruction files this project has, how long each is, and a way to
 * open them. Agents read these on every turn, so a short file is a better one.
 */
export function ProjectInstructions({ projectId }: { projectId: string }) {
  const { api, openFile, createTask } = useWorkspace();
  const [found, setFound] = useState<Found[]>();
  useEffect(() => {
    let live = true;
    setFound(undefined);
    void readInstructionFiles(api, projectId).then((results) => { if (live) setFound(results); });
    return () => { live = false; };
  }, [api, projectId]);

  return (
    <div className="card project-instructions">
      <div className="row">
        <h3>Instructions</h3>
        {/* The same prompt as /init, drafted in a new conversation so it can be read before it is sent. */}
        <button type="button" className="chip" disabled={found === undefined || api.isDesktop === false}
          title={api.isDesktop === false ? "Available in the desktop app." : "Start a conversation that asks the agent to write or refresh AGENTS.md"}
          onClick={() => void createTask(projectId, initPrompt((found ?? []).map((file) => file.path)))}>
          <SparkIcon size={12} /> {found?.some((file) => file.path === "AGENTS.md") ? "Refresh AGENTS.md" : "Write AGENTS.md"}
        </button>
      </div>
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
