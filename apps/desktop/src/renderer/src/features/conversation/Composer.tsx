import { contextTone } from "../../lib/context-window";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { harnessDisplayName } from "../../lib/harness";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { searchProjectFiles } from "../../lib/bridge";
import {
  MORE_MODES,
  PERMISSION_OPTIONS,
  PRIMARY_MODES,
  useWorkspace,
  type View,
} from "../../lib/workspace";
import { formatProjectRoot, projectFolderName } from "../../lib/paths";
import { MenuSelect } from "../shell/MenuSelect";
import { ArrowUpIcon, FolderIcon, GitBranchIcon, PaperclipIcon, StopIcon, TerminalIcon } from "../shell/icons";
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

function slashCommands(input: {
  harnesses: Array<{ id: string; name: string }>;
  query: string;
  createTask: () => void;
  setMode: (mode: "plan" | "chat" | "code") => void;
  spawnHarness: (id: string) => void;
  toggleInspector: () => void;
  openTerminal: () => void;
  openInspector: (tab?: "term") => void;
  pickProjectDirectory: () => void;
  setView: (view: View) => void;
}): SuggestItem[] {
  const targets =
    input.harnesses.length > 0
      ? input.harnesses
      : [
          { id: "claude", name: "Claude Code" },
          { id: "codex", name: "Codex" },
        ];
  return [
    { id: "new", label: "/new", detail: "New conversation", run: () => input.createTask() },
    { id: "plan", label: "/plan", detail: "Plan mode", run: () => input.setMode("plan") },
    { id: "chat", label: "/chat", detail: "Chat mode", run: () => input.setMode("chat") },
    { id: "code", label: "/code", detail: "Code mode", run: () => input.setMode("code") },
    ...targets.map((harness) => ({
      id: `spawn-${harness.id}`,
      label: `/${harness.id}`,
      detail: `Spawn ${harness.name}`,
      run: () => input.spawnHarness(harness.id),
    })),
    { id: "inspect", label: "/inspect", detail: "Toggle inspector", run: () => input.toggleInspector() },
    { id: "open", label: "/open", detail: "Open a code folder", run: () => input.pickProjectDirectory() },
    { id: "term", label: "/term", detail: "Project terminal", run: () => input.openInspector("term") },
    { id: "runtimes", label: "/runtimes", detail: "Open harnesses", run: () => input.setView("runtimes") },
    { id: "approvals", label: "/approvals", detail: "Open approvals", run: () => input.setView("approvals") },
    { id: "settings", label: "/settings", detail: "Open settings", run: () => input.setView("settings") },
  ].filter((item) => item.label.includes(input.query || "___"));
}

export function Composer({ showSuggestions = false }: { showSuggestions?: boolean }) {
  const workspace = useWorkspace();
  const { contextUsage } = workspace;
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
    setFilePicker,
    checkoutBranch,
    mentionFile,
    openInspector,
    openTerminal,
    settings,
  } = workspace;
  const harnesses = workspace.harnesses ?? [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dropping, setDropping] = useState(false);
  const [caret, setCaret] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const folderPath = session?.workingDirectory || project?.workingDirectory;
  const folder = projectFolderName(folderPath);
  const trigger = detectTrigger(draft, caret);
  const menuOpen = Boolean(trigger) && !menuDismissed;

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
    void searchProjectFiles(projectId, trigger.query)
      .then((entries) => setFiles(entries))
      .catch(() => setFiles([]));
  }, [projectId, trigger?.kind, trigger?.query]);

  const slashItems = useMemo<SuggestItem[]>(
    () =>
      slashCommands({
        harnesses,
        query: trigger?.kind === "slash" ? trigger.query : "___",
        createTask,
        setMode,
        spawnHarness,
        toggleInspector,
        openTerminal: () => void openTerminal(),
        openInspector,
        pickProjectDirectory,
        setView,
      }),
    [
      createTask,
      harnesses,
      openInspector,
      openTerminal,
      pickProjectDirectory,
      setMode,
      setView,
      spawnHarness,
      toggleInspector,
      trigger,
    ],
  );

  const skillItems = useMemo<SuggestItem[]>(
    () =>
      skills
        .filter((item) => {
          if (trigger?.kind !== "skill") return false;
          const needle = trigger.query.toLowerCase();
          return (
            item.name.toLowerCase().includes(needle) ||
            item.id.toLowerCase().includes(needle) ||
            item.packName?.toLowerCase().includes(needle) ||
            item.description?.toLowerCase().includes(needle)
          );
        })
        .slice(0, 12)
        .map((item) => ({
          id: item.id,
          label: `$${item.name}`,
          detail: item.packName ? `${item.packName} · ${item.source}` : item.source,
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

  const items = !menuOpen
    ? []
    : trigger?.kind === "slash"
      ? slashItems
      : trigger?.kind === "skill"
        ? skillItems
        : trigger?.kind === "file"
          ? fileItems
          : [];

  useEffect(() => {
    setMenuIndex(0);
    setMenuDismissed(false);
  }, [trigger?.kind, trigger?.query]);

  function syncCaret() {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart);
  }

  function applyItem(item: SuggestItem) {
    if (item.run) void item.run();
    if (item.insert && trigger) {
      const next = `${draft.slice(0, trigger.start)}${item.insert}${draft.slice(textareaRef.current?.selectionStart ?? draft.length)}`;
      setDraft(next);
      setCaret(trigger.start + item.insert.length);
    } else if (trigger?.kind === "slash") {
      const next = draft.slice(0, trigger.start) + draft.slice(textareaRef.current?.selectionStart ?? draft.length);
      setDraft(next);
      setCaret(trigger.start);
    }
    setMenuDismissed(true);
  }

  function composing(event: { nativeEvent: { isComposing?: boolean }; keyCode?: number }) {
    return Boolean(event.nativeEvent.isComposing) || event.keyCode === 229;
  }

  const permission = session?.permissionProfile ?? settings?.defaultPermission ?? "default";
  const sendOnEnter = settings?.composerSendKey !== "cmd-enter";

  return (
    <div className={`composer composer-dock composer-overlay-corner-masks${busy ? " composer-dock--with-activity" : ""}`}>
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
      <div
        className={`composer-glass ${dropping ? "dropping" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          const root = project?.workingDirectory?.replace(/\/$/, "");
          Array.from(event.dataTransfer.files).forEach((file) => {
            const absolute = (file as File & { path?: string }).path;
            if (root && absolute?.startsWith(`${root}/`)) mentionFile(absolute.slice(root.length + 1));
            else mentionFile(file.name);
          });
        }}
      >
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
            !connected
              ? "Gateway offline — replies are mock and will not edit files"
              : harnessLive
                ? `Continue with ${harnessDisplayName(harnesses, session?.harnessId)}…`
                : "Ask Capsule…"
          }
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onClick={syncCaret}
          onKeyUp={syncCaret}
          onSelect={syncCaret}
          onKeyDown={(event) => {
            if (composing(event)) return;
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
              if (event.key === "Tab") {
                event.preventDefault();
                if (items[menuIndex]) applyItem(items[menuIndex]);
                return;
              }
              if (event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
                const token = trigger ? draft.slice(trigger.start).split(/\s/)[0] : "";
                const onlyToken = Boolean(trigger && draft.trim() === token);
                if (trigger?.kind === "slash" && onlyToken && items[menuIndex]) {
                  event.preventDefault();
                  applyItem(items[menuIndex]);
                  return;
                }
                if ((trigger?.kind === "file" || trigger?.kind === "skill") && items[menuIndex] && onlyToken) {
                  event.preventDefault();
                  applyItem(items[menuIndex]);
                  return;
                }
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMenuDismissed(true);
                return;
              }
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (event.shiftKey || sendOnEnter) void sendAndContinue();
              else void send();
              return;
            }
            if (event.key === "Enter" && !event.shiftKey) {
              if (!sendOnEnter) return;
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
        {harnessLive && busy && (
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
            <button className="icon-btn" title="Mention a file (⌘P)" aria-label="Mention a file (⌘P)" onClick={() => setFilePicker(true)}>
              <PaperclipIcon size={14} />
            </button>
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
              options={PERMISSION_OPTIONS.map((item) => ({
                id: item.id,
                label: item.label,
                detail: item.detail,
              }))}
              onChange={(id) => void setPermissionProfile(id)}
            />
            <MenuSelect
              ariaLabel="Agent"
              value={agentId}
              options={agents.map((item) => ({ id: item.id, label: item.name }))}
              onChange={setAgentId}
            />
          </div>
          <div className="composer-actions-right">
            {contextUsage && (
              <ContextWindowMeter
                used={contextUsage.used}
                limit={contextUsage.limit}
                fraction={contextUsage.fraction}
                tone={contextTone(contextUsage.fraction)}
                size={22}
                onCompact={() => {
                  setDraft("/compact");
                }}
              />
            )}
            {activeRun ? (
              <button className="send-btn stop" title="Stop" aria-label="Stop" onClick={() => void stopRun()}>
                <StopIcon size={16} />
              </button>
            ) : (
              <button
                className="send-btn"
                disabled={busy || !draft.trim()}
                title={
                  sendOnEnter
                    ? "Send · Enter · ⌘Enter starts another thread"
                    : "Send · ⌘Enter · ⌘⇧Enter starts another thread"
                }
                onClick={() => void send()}
              >
                <ArrowUpIcon size={14} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="composer-context">
        <button
          type="button"
          className={!folder ? "missing" : ""}
          onClick={() => void pickProjectDirectory()}
          title={
            folderPath
              ? formatProjectRoot(folderPath, { home: window.capsule.homeDir })
              : "Attach a folder (⌘O)"
          }
        >
          <FolderIcon size={12} />
          {folder ?? "No folder"}
        </button>
        <button type="button" onClick={() => void openTerminal()} title="Open Terminal in this folder">
          <span className="inline-icon">
            <TerminalIcon size={12} />
            Terminal
          </span>
        </button>
        {git?.isRepo && git.branches.length > 0 && (
          <span className="inline-icon">
            <GitBranchIcon size={12} />
            <MenuSelect
              ariaLabel="Branch"
              value={git.branch ?? git.branches[0] ?? ""}
              options={git.branches.map((item) => ({ id: item, label: item }))}
              onChange={(id) => void checkoutBranch(id)}
            />
            {git.dirty ? (
              <button type="button" title="Open changes" aria-label="Open changes" onClick={() => openInspector("changes")}>
                *
              </button>
            ) : null}
          </span>
        )}
        {!connected && <span>Gateway offline</span>}
        <span className="faint">/  @  $</span>
      </div>
      {busy && (
        <div className="composer-dock-activity" aria-live="polite">
          <span className="dot on live" />
          <span className="shimmer-text">
            Agent working…
            <span className="shimmer-overlay" aria-hidden>Agent working…</span>
          </span>
        </div>
      )}
    </div>
  );
}
