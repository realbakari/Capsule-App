import { contextTone } from "../../lib/context-window";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { agentPickerDetail, agentSwitchNotice, harnessDisplayName } from "../../lib/harness";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { searchProjectFiles } from "../../lib/bridge";
import { MODES, PERMISSION_OPTIONS, useWorkspace, type View } from "../../lib/workspace";
import { formatProjectRoot, projectFolderName } from "../../lib/paths";
import { AgentGlyph } from "../shell/AgentGlyph";
import { MenuSelect } from "../shell/MenuSelect";
import {
  ArrowUpIcon,
  BookmarkIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  PaperclipIcon,
  ShieldIcon,
  StopIcon,
  TerminalIcon,
  XIcon,
} from "../shell/icons";
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
    checkoutBranch,
    openInspector,
    terminalOpen,
    setTerminalOpen,
    settings,
    sendBlockReason,
    doctorHarness,
    workspaceMode,
    setWorkspaceMode,
    attachments,
    promptStashes,
    pickAttachments,
    attachFiles,
    removeAttachment,
    stashCurrentPrompt,
    restorePromptStash,
    deletePromptStash,
  } = workspace;
  const harnesses = workspace.harnesses ?? [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dropping, setDropping] = useState(false);
  const [caret, setCaret] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const [stashOpen, setStashOpen] = useState(false);
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const liveHarnessId = harnessLive ? session?.harnessId : undefined;
  /* Undefined until the agent list has arrived: a tile for "Agent" is a mark
     for a name nobody picked. */
  const selectedAgentName = agents.find((item) => item.id === agentId)?.name;
  const switchNotice = agentSwitchNotice({
    fromName: liveHarnessId ? harnessDisplayName(harnesses, liveHarnessId) : undefined,
    toName: selectedAgentName,
    live: harnessLive,
  });
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
    void searchProjectFiles(projectId, trigger.query, folderPath)
      .then((entries) => setFiles(entries))
      .catch(() => setFiles([]));
  }, [folderPath, projectId, trigger?.kind, trigger?.query]);

  const slashItems = useMemo<SuggestItem[]>(
    () =>
      slashCommands({
        harnesses,
        query: trigger?.kind === "slash" ? trigger.query : "___",
        createTask,
        setMode,
        spawnHarness,
        toggleInspector,
        openTerminal: () => setTerminalOpen(true),
        openInspector,
        pickProjectDirectory,
        setView,
      }),
    [
      createTask,
      harnesses,
      openInspector,
      pickProjectDirectory,
      setTerminalOpen,
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
  const selectedHarness = harnesses.find((item) => item.id === agentId);

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
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => (file as File & { path?: string }).path)
            .filter((filePath): filePath is string => Boolean(filePath));
          if (paths.length > 0) void attachFiles(paths);
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
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
              event.preventDefault();
              if (draft.trim() || attachments.length > 0) {
                stashCurrentPrompt();
                setStashOpen(false);
              } else {
                setStashOpen((value) => !value);
              }
              return;
            }
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
        {attachments.length > 0 && (
          <div className="composer-attachments" aria-label="Attached files">
            {attachments.map((attachment) => (
              <span className="composer-attachment" key={attachment.path} title={attachment.path}>
                <FileIcon size={12} />
                <span>{attachment.name}</span>
                <button
                  type="button"
                  aria-label={`Remove ${attachment.name}`}
                  onClick={() => removeAttachment(attachment.path)}
                >
                  <XIcon size={10} />
                </button>
              </span>
            ))}
          </div>
        )}
        {stashOpen && (
          <div className="composer-stash" role="dialog" aria-label="Stashed prompts">
            <div className="composer-stash-head">
              <span>Stashed prompts</span>
              <small>{promptStashes.length}</small>
            </div>
            {promptStashes.length === 0 ? (
              <p>Nothing stashed yet. Write a prompt and press ⌘S.</p>
            ) : (
              promptStashes.map((entry) => (
                <div className="composer-stash-entry" key={entry.id}>
                  <button
                    type="button"
                    className="composer-stash-restore"
                    onClick={() => {
                      restorePromptStash(entry.id);
                      setStashOpen(false);
                    }}
                  >
                    <span>{entry.prompt.trim().replace(/\s+/g, " ") || `${entry.attachments.length} attached files`}</span>
                    <small>{entry.attachments.length ? `${entry.attachments.length} files` : "Prompt"}</small>
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="Delete stashed prompt"
                    onClick={() => deletePromptStash(entry.id)}
                  >
                    <XIcon size={11} />
                  </button>
                </div>
              ))
            )}
          </div>
        )}
        {skillId && (
          <div className="steer-row">
            <span className="chip">Skill {skills.find((item) => item.id === skillId)?.name ?? skillId}</span>
            <button className="chip" onClick={() => setSkillId(undefined)}>
              Clear
            </button>
          </div>
        )}
        {sendBlockReason && (
          <div className="composer-preflight" role="status">
            <span>{sendBlockReason}</span>
            {selectedHarness ? (
              <button className="ghost" type="button" onClick={() => void doctorHarness(selectedHarness.id)}>
                Run Doctor
              </button>
            ) : null}
            <button className="ghost" type="button" onClick={() => setView("runtimes")}>
              Open Harnesses
            </button>
          </div>
        )}
        {switchNotice && !sendBlockReason && (
          <div className="composer-preflight" role="status">
            <span>{switchNotice}</span>
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
          <div className="composer-controls">
            <MenuSelect
              ariaLabel="Mode"
              value={mode}
              options={MODES.map((item) => ({ id: item, label: item }))}
              onChange={(id) => setMode(id as typeof mode)}
            />
            <span className="composer-controls-divider" aria-hidden />
            <MenuSelect
              ariaLabel="Permission mode"
              icon={<ShieldIcon size={13} />}
              value={permission}
              options={PERMISSION_OPTIONS.map((item) => ({
                id: item.id,
                label: item.label,
                detail: item.detail,
              }))}
              onChange={(id) => void setPermissionProfile(id)}
            />
            <span className="composer-controls-divider" aria-hidden />
            <MenuSelect
              ariaLabel="Agent"
              icon={selectedAgentName ? <AgentGlyph id={agentId} name={selectedAgentName} /> : undefined}
              value={agentId}
              options={agents.map((item) => {
                const harness = harnesses.find((candidate) => candidate.id === item.id);
                return {
                  id: item.id,
                  label: item.name,
                  detail: agentPickerDetail({
                    harness,
                    description: item.description,
                    live: liveHarnessId === item.id,
                  }),
                  icon: <AgentGlyph id={item.id} name={item.name} />,
                };
              })}
              onChange={setAgentId}
            />
            {git?.isRepo && (
              <>
                <span className="composer-controls-divider" aria-hidden />
                <MenuSelect
                  ariaLabel="Conversation workspace"
                  icon={<GitBranchIcon size={13} />}
                  value={workspaceMode}
                  options={[
                    { id: "local", label: "Local", detail: "Share the current checkout." },
                    {
                      id: "worktree",
                      label: "Worktree",
                      detail: "Use an isolated branch and folder for this conversation.",
                    },
                  ]}
                  onChange={(id) => void setWorkspaceMode(id as "local" | "worktree")}
                />
              </>
            )}
          </div>
          <div className="composer-actions-right">
            <button className="icon-btn" title="Attach files" aria-label="Attach files" onClick={() => void pickAttachments()}>
              <PaperclipIcon size={14} />
            </button>
            <button
              className={`icon-btn composer-stash-button${stashOpen ? " active" : ""}`}
              title={draft.trim() || attachments.length ? "Stash prompt (⌘S)" : "Open prompt stash (⌘S)"}
              aria-label="Prompt stash"
              onClick={() => setStashOpen((value) => !value)}
            >
              <BookmarkIcon size={13} />
              {promptStashes.length > 0 ? <span>{promptStashes.length}</span> : null}
            </button>
            {contextUsage && (
              <ContextWindowMeter
                used={contextUsage.used}
                limit={contextUsage.limit}
                fraction={contextUsage.fraction}
                tone={contextTone(contextUsage.fraction)}
                size={22}
              />
            )}
            {activeRun ? (
              <button className="send-btn stop" title="Stop" aria-label="Stop" onClick={() => void stopRun()}>
                <StopIcon size={16} />
              </button>
            ) : (
              <button
                className="send-btn"
                disabled={busy || (!draft.trim() && attachments.length === 0) || Boolean(sendBlockReason)}
                title={
                  sendBlockReason || (sendOnEnter
                    ? "Send · Enter · ⌘Enter starts another thread"
                    : "Send · ⌘Enter · ⌘⇧Enter starts another thread")
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
        {/* The panel inside Capsule, not Terminal.app: the shell people want is
            the one already pointed at this conversation's folder. */}
        <button
          type="button"
          className={terminalOpen ? "active" : ""}
          onClick={() => setTerminalOpen(!terminalOpen)}
          title="Terminal (⌘J)"
        >
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
        {session?.workspaceMode === "worktree" && session.worktreeBranch && (
          <span className="workspace-mode-label">Isolated · {session.worktreeBranch}</span>
        )}
        {!connected && <span>Gateway offline</span>}
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
