import { useEffect, useRef } from "react";
import { MORE_MODES, PRIMARY_MODES, useWorkspace } from "../../lib/workspace";
import { ArrowUpIcon, GitBranchIcon, StopIcon } from "../shell/icons";

const SUGGESTIONS = [
  {
    label: "Review this repo",
    mode: "code" as const,
    text: "Review the working directory and summarize the main risks.",
  },
  {
    label: "Plan a change",
    mode: "plan" as const,
    text: "Help me plan the next change for this project.",
  },
  {
    label: "Research options",
    mode: "research" as const,
    text: "Research options for this problem and cite sources.",
  },
];

export function Composer({ showSuggestions = false }: { showSuggestions?: boolean }) {
  const {
    draft,
    setDraft,
    send,
    busy,
    mode,
    setMode,
    agentId,
    setAgentId,
    agents,
    session,
    project,
    git,
    steerDraft,
    setSteerDraft,
    steerHarness,
    pickProjectDirectory,
    activeRun,
    stopRun,
  } = useWorkspace();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const folder = project?.workingDirectory?.split("/").filter(Boolean).pop();

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [draft]);

  return (
    <div className="composer">
      {showSuggestions && (
        <div className="suggestions">
          {SUGGESTIONS.map((item) => (
            <button
              key={item.label}
              className="chip"
              onClick={() => {
                setMode(item.mode);
                setDraft(item.text);
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
      <div className="composer-glass">
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          placeholder={
            harnessLive
              ? `Continue with ${session?.harnessId === "codex" ? "Codex" : "Claude Code"}…`
              : "Ask Capsule to work on something…"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {harnessLive && (
          <div className="steer-row">
            <input
              type="text"
              placeholder="Steer this turn without replacing context"
              value={steerDraft}
              onChange={(event) => setSteerDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void steerHarness();
                }
              }}
            />
            <button className="chip" disabled={!steerDraft.trim()} onClick={() => void steerHarness()}>
              Steer
            </button>
          </div>
        )}
        <div className="composer-row">
          <div className="chips">
            <div className="seg" role="tablist" aria-label="Mode">
              {PRIMARY_MODES.map((item) => (
                <button
                  key={item}
                  type="button"
                  role="tab"
                  aria-selected={mode === item}
                  className={mode === item ? "active" : ""}
                  onClick={() => setMode(item)}
                >
                  {item}
                </button>
              ))}
            </div>
            <select
              className="select-quiet"
              aria-label="More modes"
              value={MORE_MODES.includes(mode) ? mode : ""}
              onChange={(event) => {
                const next = event.target.value;
                if (next) setMode(next as typeof mode);
              }}
            >
              <option value="" disabled>
                More
              </option>
              {MORE_MODES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
            <select
              className="select-quiet"
              aria-label="Agent"
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
            >
              {agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </div>
          {activeRun ? (
            <button className="send-btn stop" title="Stop" onClick={() => void stopRun()}>
              <StopIcon size={12} />
            </button>
          ) : (
            <button
              className="send-btn"
              disabled={busy || !draft.trim()}
              title="Send"
              onClick={() => void send()}
            >
              <ArrowUpIcon size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="composer-context">
        <button type="button" onClick={() => void pickProjectDirectory()} title="Choose folder">
          {folder ?? "No folder"}
        </button>
        {git?.isRepo && (
          <span className="inline-icon">
            <GitBranchIcon size={12} />
            {git.branch}
            {git.dirty ? "*" : ""}
          </span>
        )}
        {project?.defaultAgentId && (
          <span>{project.defaultAgentId === "codex" ? "Codex" : "Claude Code"}</span>
        )}
      </div>
    </div>
  );
}
