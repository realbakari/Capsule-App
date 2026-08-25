import { useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { MORE_MODES, PERMISSION_OPTIONS, PRIMARY_MODES, useWorkspace } from "../../lib/workspace";
import { MenuSelect } from "../shell/MenuSelect";
import { ArrowUpIcon, GitBranchIcon, StopIcon } from "../shell/icons";
import { ComposerMenu, detectTrigger, type SuggestItem } from "./ComposerMenu";

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
    sendAndContinue,
    busy,
    mode,
    setMode,
    agentId,
    setAgentId,
    agents,
    skills,
    session,
    project,
    git,
    steerDraft,
    setSteerDraft,
    steerHarness,
    pickProjectDirectory,
    activeRun,
    stopRun,
    spawnHarness,
    createTask,
    setView,
    toggleInspector,
    setSkillId,
    skillId,
    setPermissionProfile,
    api,
    projectId,
    connected,
  } = useWorkspace();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const folder = project?.workingDirectory?.split("/").filter(Boolean).pop();
  const caret = textareaRef.current?.selectionStart ?? draft.length;
  const trigger = detectTrigger(draft, caret);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [draft]);

  useEffect(() => {
    if (trigger?.kind !== "file" || !projectId) {
      setFiles([]);
      return;
    }
    void api.searchFiles(projectId, trigger.query).then((entries: FileEntry[]) => setFiles(entries));
  }, [api, projectId, trigger?.kind, trigger?.query]);

  const slashItems = useMemo<SuggestItem[]>(
    () =>
      [
        { id: "new", label: "/new", detail: "New conversation", run: () => createTask() },
        { id: "plan", label: "/plan", detail: "Plan mode", run: () => setMode("plan") },
        { id: "chat", label: "/chat", detail: "Chat mode", run: () => setMode("chat") },
        { id: "code", label: "/code", detail: "Code mode", run: () => setMode("code") },
        {
          id: "claude",
          label: "/claude",
          detail: "Spawn Claude Code",
          run: () => spawnHarness("claude"),
        },
        { id: "codex", label: "/codex", detail: "Spawn Codex", run: () => spawnHarness("codex") },
        { id: "inspect", label: "/inspect", detail: "Toggle inspector", run: () => toggleInspector() },
        { id: "runtimes", label: "/runtimes", detail: "Open runtimes", run: () => setView("runtimes") },
        {
          id: "approvals",
          label: "/approvals",
          detail: "Open approvals",
          run: () => setView("approvals"),
        },
        { id: "settings", label: "/settings", detail: "Open settings", run: () => setView("settings") },
      ].filter((item) => item.label.includes(trigger?.kind === "slash" ? trigger.query : "___")),
    [createTask, setMode, setView, spawnHarness, toggleInspector, trigger],
  );

  const skillItems = useMemo<SuggestItem[]>(
    () =>
      skills
        .filter((item) => {
          if (trigger?.kind !== "skill") return false;
          const needle = trigger.query.toLowerCase();
          return (
            item.name.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle)
          );
        })
        .slice(0, 12)
        .map((item) => ({
          id: item.id,
          label: `$${item.name}`,
          detail: item.source,
          insert: `$${item.name} `,
          run: () => setSkillId(item.id),
        })),
    [setSkillId, skills, trigger],
  );

  const fileItems = useMemo<SuggestItem[]>(
    () =>
      files.slice(0, 12).map((item) => ({
        id: item.path,
        label: item.path,
        insert: `@${item.path} `,
      })),
    [files],
  );

  const items =
    trigger?.kind === "slash" ? slashItems : trigger?.kind === "skill" ? skillItems : trigger?.kind === "file" ? fileItems : [];

  useEffect(() => {
    setMenuIndex(0);
  }, [trigger?.kind, trigger?.query]);

  function applyItem(item: SuggestItem) {
    if (item.run) void item.run();
    if (item.insert && trigger) {
      const next = `${draft.slice(0, trigger.start)}${item.insert}${draft.slice(textareaRef.current?.selectionStart ?? draft.length)}`;
      setDraft(next);
    } else if (trigger?.kind === "slash") {
      setDraft(draft.slice(0, trigger.start) + draft.slice(textareaRef.current?.selectionStart ?? draft.length));
    }
  }

  const permission = session?.permissionProfile ?? "default";

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
        <ComposerMenu
          items={items}
          index={menuIndex}
          onHover={setMenuIndex}
          onPick={applyItem}
        />
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          placeholder={
            harnessLive
              ? `Continue with ${session?.harnessId === "codex" ? "Codex" : "Claude Code"}…`
              : "Ask Capsule…"
          }
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (items.length > 0) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setMenuIndex((current) => Math.min(items.length - 1, current + 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setMenuIndex((current) => Math.max(0, current - 1));
                return;
              }
              if (event.key === "Tab" || (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey)) {
                event.preventDefault();
                if (items[menuIndex]) applyItem(items[menuIndex]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                return;
              }
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void sendAndContinue();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send();
            }
          }}
        />
        {skillId && (
          <div className="steer-row">
            <span className="chip">Skill {skills.find((item) => item.id === skillId)?.name ?? skillId}</span>
            <button className="chip" onClick={() => setSkillId(undefined)}>
              Clear
            </button>
          </div>
        )}
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
            <MenuSelect
              ariaLabel="More modes"
              placeholder="More"
              value={MORE_MODES.includes(mode) ? mode : ""}
              options={MORE_MODES.map((item) => ({ id: item, label: item }))}
              onChange={(id) => setMode(id as typeof mode)}
            />
            <MenuSelect
              ariaLabel="Permission mode"
              value={permission}
              options={PERMISSION_OPTIONS.map((item) => ({ id: item.id, label: item.label }))}
              onChange={(id) => void setPermissionProfile(id)}
            />
            <MenuSelect
              ariaLabel="Agent"
              value={agentId}
              options={agents.map((item) => ({ id: item.id, label: item.name }))}
              onChange={setAgentId}
            />
          </div>
          {activeRun ? (
            <button className="send-btn stop" title="Stop" onClick={() => void stopRun()}>
              <StopIcon size={12} />
            </button>
          ) : (
            <button
              className="send-btn"
              disabled={busy || !draft.trim()}
              title="Send · ⌘Enter starts another thread"
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
        {!connected && <span>Gateway offline</span>}
        <span className="faint">/  @  $</span>
      </div>
    </div>
  );
}
