import { contextTone } from "../../lib/context-window";
import { harnessCapabilities } from "@capsule/shared";
import { CapabilityDetails } from "../harness/CapabilityDetails";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { agentSwitchNotice, harnessDisplayName } from "../../lib/harness";
import { AgentModelPicker } from "./AgentModelPicker";
import { GatewayBanner } from "../shell/GatewayBanner";
import { GATEWAY_CONNECTION_REQUIRED } from "../../lib/harness-preflight";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { FileEntry } from "@capsule/shared";
import { searchProjectFiles } from "../../lib/bridge";
import { MODES, PERMISSION_OPTIONS, useWorkspace, type View } from "../../lib/workspace";
import { formatProjectRoot, projectFolderName } from "../../lib/paths";
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
import { searchComposerSkills, skillSource } from "../../lib/composer-skills";

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
  /* Skills belong in this menu too: $ was the only way to reach one, and the
     only thing that ever said so was a legend under the composer. */
  skills: Array<{ id: string; name: string }>;
  setSkillId: (id: string) => void;
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
    ...input.skills.map((skill) => ({
      id: `skill-${skill.id}`,
      label: `/${skill.name.toLowerCase().replace(/\s+/gu, "-")}`,
      detail: `Use the ${skill.name} skill`,
      run: () => input.setSkillId(skill.id),
    })),
  ].filter((item) => item.label.toLowerCase().includes(input.query.toLowerCase()));
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
    steeringPending,
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
    harnessStatuses,
    loadHarnessStatus,
    setHarnessOption,
    api,
    projectId,
    connected,
    ready,
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
    attachClipboardImage,
    attachFiles,
    removeAttachment,
    stashCurrentPrompt,
    restorePromptStash,
    deletePromptStash,
  } = workspace;
  const harnesses = workspace.harnesses ?? [];
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dropping, setDropping] = useState(false);
  const [caret, setCaret] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const menuId = useId();
  const [picker, setPicker] = useState<"file" | "skill">();
  const [pickerQuery, setPickerQuery] = useState("");
  const [fileState, setFileState] = useState("Searching files…");
  const [picking, setPicking] = useState(false);
  const selectionScope = `${projectId}/${session?.id}/${draft}`;
  const selectionScopeRef = useRef(selectionScope);
  selectionScopeRef.current = selectionScope;
  /*
   * Which models this agent will run is something only the running agent can
   * say, so it is asked once per live session and remembered. Without this the
   * list existed but only after someone pressed Status on the Harnesses screen.
   */
  const liveHarnessSessionId =
    session?.harnessId && session.harnessState && session.harnessState !== "closed"
      ? session.id
      : undefined;
  const harnessStatus = liveHarnessSessionId ? harnessStatuses[liveHarnessSessionId] : undefined;
  useEffect(() => {
    if (!liveHarnessSessionId || harnessStatus) return;
    void loadHarnessStatus(liveHarnessSessionId);
  }, [harnessStatus, liveHarnessSessionId, loadHarnessStatus]);

  const capabilityHarness = harnesses.find((item) => item.id === agentId);
  const capabilities = harnessCapabilities({ harness: capabilityHarness, session, status: harnessStatus });
  const gatewayUnavailable = ready && !connected && capabilities.route !== "direct" && workspace.status?.kind !== "mock";
  const models = session?.harnessId === agentId ? harnessStatus?.parsed?.models : undefined;
  const currentModel =
    session?.harnessId === agentId ? session.modelOverride ?? models?.currentModelId ?? harnessStatus?.parsed?.model ?? "" : "";

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
  const menuOpen = Boolean(picker || trigger) && !menuDismissed;
  const searchKind = picker ?? trigger?.kind;
  const searchQuery = picker ? pickerQuery : trigger?.query ?? "";
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !composerRef.current?.contains(event.target)) { setPicker(undefined); setMenuDismissed(true); }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  useEffect(() => { setPicker(undefined); setPickerQuery(""); setMenuDismissed(true); }, [projectId, session?.id]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 176)}px`;
  }, [draft]);

  useEffect(() => {
    setFiles([]);
    if (!menuOpen || searchKind !== "file") return;
    if (!projectId || !folderPath) { setFileState("Attach a project folder to search its files."); return; }
    let cancelled = false;
    setFileState("Searching files…");
    const timer = window.setTimeout(() => {
      void searchProjectFiles(projectId, searchQuery, folderPath)
        .then((entries) => { if (!cancelled) { setFiles(entries); setFileState("No matching files."); } })
        .catch(() => { if (!cancelled) setFileState("File search failed. Change the query or reopen to retry."); });
    }, 120);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [folderPath, projectId, searchKind, searchQuery, menuOpen]);

  const slashItems = useMemo<SuggestItem[]>(
    () =>
      slashCommands({
        harnesses,
        skills: skills.filter((skill) => skill.status === "installed"),
        setSkillId,
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
      skills,
      setSkillId,
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
      searchComposerSkills(skills, searchQuery)
        .map((item) => ({
          id: item.id,
          label: item.name,
          detail: item.description,
          badge: skillSource(item),
          kind: "skill" as const,
          run: () => setSkillId(item.id),
        })),
    [setSkillId, skills, searchQuery],
  );

  const fileItems = useMemo<SuggestItem[]>(
    () =>
      files.filter((item) => item.type === "file").slice(0, 40).map((item) => ({
        id: item.path,
        label: item.name,
        detail: item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : "Project root",
        kind: "file" as const,
        run: async () => { if (!folderPath || !await attachFiles([`${folderPath.replace(/\/$/, "")}/${item.path}`])) throw new Error("File was not attached. Check the file or choose another."); },
      })),
    [files, folderPath, attachFiles],
  );

  const items = !menuOpen
    ? []
    : searchKind === "slash"
      ? slashItems
      : searchKind === "skill"
        ? skillItems
        : searchKind === "file"
          ? fileItems
          : [];

  useEffect(() => {
    setMenuIndex(0);
    setMenuDismissed(false);
  }, [searchKind, searchQuery]);

  function syncCaret() {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart);
  }

  async function applyItem(item: SuggestItem) {
    if (picking) return;
    setPicking(true);
    try {
      await item.run?.();
      if (selectionScopeRef.current !== selectionScope) return;
      const position = !picker && trigger ? trigger.start + (item.insert?.length ?? 0) : caret;
      if (!picker && trigger) setDraft(draft.slice(0, trigger.start) + (item.insert ?? "") + draft.slice(caret));
      setPicker(undefined);
      setMenuDismissed(true);
      requestAnimationFrame(() => { textareaRef.current?.focus(); textareaRef.current?.setSelectionRange(position, position); setCaret(position); });
    } catch (error) { workspace.setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setPicking(false); }
  }

  function openPicker(kind: "file" | "skill") { setPicker(kind); setPickerQuery(""); setMenuDismissed(false); setMenuIndex(0); }

  function composing(event: { nativeEvent: { isComposing?: boolean }; keyCode?: number }) {
    return Boolean(event.nativeEvent.isComposing) || event.keyCode === 229;
  }

  const permission = session?.permissionProfile ?? settings?.defaultPermission ?? "default";
  const permissionOptions = capabilities.route === "direct"
    ? [{ id: "agent-managed", label: "Agent-managed", disabledReason: capabilities.permissions.detail }]
    : PERMISSION_OPTIONS.map((item) => ({ id: item.id, label: item.label, detail: item.detail }));
  const permissionValue = capabilities.route === "direct" ? "agent-managed" : permission;
  const modeOptions = MODES.map((item) => ({ id: item, label: item.charAt(0).toUpperCase() + item.slice(1) }));
  const sendOnEnter = settings?.composerSendKey !== "cmd-enter";
  const selectedHarness = harnesses.find((item) => item.id === agentId);

  return (
    <div ref={composerRef} className={`composer composer-dock composer-overlay-corner-masks${busy ? " composer-dock--with-activity" : ""}`}>
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
        /*
         * A pasted screenshot becomes an attachment.
         *
         * Nothing handled paste at all, so an image on the clipboard was
         * simply dropped on the floor — Cmd+V after a screenshot did nothing.
         * Files that carry a path (pasted from Finder) go straight to
         * attachFiles; bitmap data has no path, so the main process writes it
         * out first. Text paste is left alone.
         */
        onPaste={(event) => {
          try {
          const data = event.clipboardData;
          if (!data) return;
          const paths = Array.from(data.files)
            .map((file) => api.getPathForFile(file))
            .filter((filePath): filePath is string => Boolean(filePath));
          if (paths.length > 0) {
            event.preventDefault();
            void attachFiles(paths);
            return;
          }
          const hasImage = Array.from(data.items).some((item) =>
            item.type.startsWith("image/"),
          );
          if (!hasImage) return;
          // Only swallow the keystroke once we know an image is there, or a
          // normal text paste would stop working.
          event.preventDefault();
          void attachClipboardImage();
          } catch (error) {
            event.preventDefault();
            workspace.setNotice(error instanceof Error ? error.message : String(error));
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDropping(false);
          try {
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => api.getPathForFile(file))
            .filter((filePath): filePath is string => Boolean(filePath));
          if (paths.length > 0) void attachFiles(paths);
          } catch (error) { workspace.setNotice(error instanceof Error ? error.message : String(error)); }
        }}
      >
        {picker && <div className="composer-context-picker">
          <div className="composer-context-tabs">
            <button type="button" aria-pressed={picker === "skill"} onClick={() => openPicker("skill")}>Skills</button>
            <button type="button" aria-pressed={picker === "file"} onClick={() => openPicker("file")}>Project files</button>
            <button type="button" onClick={() => { setPicker(undefined); setMenuDismissed(true); textareaRef.current?.focus(); }} aria-label="Close context picker"><XIcon size={14} /></button>
          </div>
          <input autoFocus aria-label={picker === "skill" ? "Search skills" : "Search project files"} placeholder={picker === "skill" ? "Search skills by name or description…" : "Search files…"} value={pickerQuery}
            role="combobox" aria-expanded="true" aria-autocomplete="list"
            aria-controls={menuId} aria-activedescendant={items[menuIndex] ? `${menuId}-${menuIndex}` : undefined}
            onChange={(event) => setPickerQuery(event.target.value)} onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape") { event.preventDefault(); setPicker(undefined); setMenuDismissed(true); textareaRef.current?.focus(); }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setMenuIndex((current) => Math.max(0, Math.min(items.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)))); }
              if (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey && items[menuIndex])) { event.preventDefault(); if (items[menuIndex]) void applyItem(items[menuIndex]); }
            }} />
          <ComposerMenu id={menuId} items={items} index={menuIndex} onHover={setMenuIndex} onPick={(item) => void applyItem(item)} empty={picker === "file" ? fileState : "No installed skills match. Browse Skills to install one."} />
        </div>}
        {!picker && <ComposerMenu
          id={menuId}
          items={items}
          index={menuIndex}
          onHover={setMenuIndex}
          onPick={(item) => void applyItem(item)}
          empty={menuOpen ? searchKind === "file" ? fileState : searchKind === "skill" ? "No installed skills match." : "No matching commands." : undefined}
        />}
        {skillId && <div className="composer-context-chips">
          <span className="composer-skill-chip" title={skills.find((item) => item.id === skillId)?.description}>
            <span>Skill · {skills.find((item) => item.id === skillId)?.name ?? "Unavailable skill"}</span>
            <button type="button" aria-label="Remove selected skill" onClick={() => setSkillId(undefined)}><XIcon size={12} /></button>
          </span>
          <button type="button" className="ghost" onClick={() => openPicker("skill")}>Change</button>
        </div>}
        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          aria-label="Message"
          aria-controls={!picker && menuOpen ? menuId : undefined}
          aria-activedescendant={!picker && items[menuIndex] ? `${menuId}-${menuIndex}` : undefined}
          placeholder={
            harnessLive
                ? `Continue with ${harnessDisplayName(harnesses, session?.harnessId)}…`
                : "Describe a change, ask a question, or attach files…"
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
              if (draft.trim() || attachments.length > 0 || skillId) {
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
                if (items[menuIndex]) {
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
            if (menuOpen && event.key === "Escape") { event.preventDefault(); setMenuDismissed(true); return; }
            if (menuOpen && event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey) { event.preventDefault(); return; }
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
              <span
                className={`composer-attachment${attachment.thumbnail ? " composer-attachment--image" : ""}`}
                key={attachment.path}
                title={attachment.path}
              >
                {/* An image shows itself. A pasted screenshot as a grey file
                    chip told you nothing about which screenshot it was. */}
                {attachment.thumbnail ? (
                  <img className="composer-attachment-thumb" src={attachment.thumbnail} alt="" />
                ) : (
                  <FileIcon size={12} />
                )}
                {attachment.thumbnail ? null : <span>{attachment.name}</span>}
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
                    <small>{entry.temporary ? "Temporary · until app closes" : entry.attachments.length ? `${entry.attachments.length} files` : "Prompt"}</small>
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
        {gatewayUnavailable && <GatewayBanner inset />}
        {sendBlockReason && !(gatewayUnavailable && sendBlockReason === GATEWAY_CONNECTION_REQUIRED) && (
          <div className="composer-preflight" role="status">
            <span title={sendBlockReason}>{sendBlockReason}</span>
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
        {harnessLive && activeRun && capabilities.steer.state === "unavailable" && <p className="capability-hint">{capabilities.steer.detail}</p>}
        {harnessLive && activeRun && capabilities.steer.state !== "unavailable" && (
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
            <button className="chip" disabled={steeringPending || !steerDraft.trim()} onClick={() => void steerHarness()}>
              {steeringPending ? "Sending…" : "Steer"}
            </button>
          </div>
        )}
        <div className="composer-row">
          <div className="composer-controls">
            <AgentModelPicker agents={agents} harnesses={harnesses} agentId={agentId} liveHarnessId={liveHarnessId}
              models={models} currentModel={currentModel} availability={capabilities.model}
              onAgent={setAgentId} onModel={(id) => void setHarnessOption("model", id)} />
            <div className="composer-options-inline">
            <span className="composer-control-divider" aria-hidden />
            <MenuSelect
              ariaLabel="Permission mode"
              icon={<ShieldIcon size={13} />}
              value={permissionValue}
              options={permissionOptions}
              onChange={(id) => void setPermissionProfile(id)}
            />
            <MenuSelect ariaLabel="Mode" value={mode} options={modeOptions} onChange={(id) => setMode(id as typeof mode)} />
            </div>
            <div className="composer-options-overflow">
              <MenuSelect ariaLabel="Composer options" value="" placeholder="More options" iconOnly options={[
                ...permissionOptions.map((item) => ({ ...item, id: `permission:${item.id}`, group: `Permissions · ${permissionOptions.find((option) => option.id === permissionValue)?.label ?? "Standard"}` })),
                ...modeOptions.map((item) => ({ ...item, id: `mode:${item.id}`, group: `Mode · ${modeOptions.find((option) => option.id === mode)?.label}` })),
                { id: "stash", label: "Prompt stash", group: "Workspace" },
                ...(capabilityHarness ? [{ id: "capabilities", label: "Harness capabilities", detail: "Inspect this agent's runtime support and limitations.", group: "Workspace" }] : []),
              ]} onChange={(id) => { if (id.startsWith("permission:")) void setPermissionProfile(id.slice(11)); else if (id.startsWith("mode:")) setMode(id.slice(5) as typeof mode); else if (id === "stash") setStashOpen(true); else if (id === "capabilities") setView("runtimes"); }} />
            </div>
          </div>
          <div className="composer-actions-right">
            <button type="button" className="icon-btn" title="Attach a skill or project file ($ / @)" aria-label="Add context" aria-expanded={Boolean(picker)} onClick={() => picker ? (setPicker(undefined), setMenuDismissed(true)) : openPicker("skill")}><span aria-hidden>＋</span></button>
            {capabilityHarness && <div className="composer-secondary-action"><CapabilityDetails compact harness={capabilityHarness} session={session} status={harnessStatus} /></div>}
            <button className="icon-btn" title="Attach files" aria-label="Attach files" onClick={() => void pickAttachments()}>
              <PaperclipIcon size={14} />
            </button>
            <button
              className={`icon-btn composer-stash-button composer-secondary-action${stashOpen ? " active" : ""}`}
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
              <button className="send-btn stop" disabled={workspace.stoppingRunIds?.includes(activeRun.id)} title={workspace.stoppingRunIds?.includes(activeRun.id) ? "Stopping — waiting for the runtime" : "Stop"} aria-label={workspace.stoppingRunIds?.includes(activeRun.id) ? "Stopping" : "Stop"} onClick={() => void stopRun()}>
                <StopIcon size={16} />
              </button>
            ) : (
              <button
                className="send-btn"
                aria-label="Send message"
                disabled={busy || picking || (!draft.trim() && attachments.length === 0 && !skillId) || Boolean(sendBlockReason)}
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
        {switchNotice && !sendBlockReason && (
          <p className="composer-switch-note" role="status">
            {switchNotice}
          </p>
        )}
      </div>
      <div className="composer-context">
        {git?.isRepo ? <MenuSelect ariaLabel="Conversation workspace" value={workspaceMode} icon={<FolderIcon size={13} />}
          options={[
            { id: "local", label: "Current checkout", detail: workspaceMode === "local" && folderPath ? formatProjectRoot(folderPath, { home: window.capsule.homeDir }) : "Share the current checkout." },
            { id: "worktree", label: "Worktree", detail: "Use an isolated branch and folder for this conversation." },
            { id: "folder", label: "Change folder…", detail: "Choose a working folder on this Mac." },
          ]}
          onChange={(id) => { if (id === "folder") void pickProjectDirectory(); else void setWorkspaceMode(id as "local" | "worktree"); }} /> : <button
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
        </button>}
        {/* The panel inside Capsule, not Terminal.app: the shell people want is
            the one already pointed at this conversation's folder. */}
        <button
          type="button"
          className={terminalOpen ? "active" : ""}
          onClick={() => setTerminalOpen(!terminalOpen)}
          title="Terminal (⌘J)"
          aria-label="Toggle terminal"
          aria-pressed={terminalOpen}
        >
          <span className="inline-icon">
            <TerminalIcon size={12} />
          </span>
        </button>
        {git?.isRepo && git.branches.length > 0 && (
          <span className="inline-icon composer-branch">
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
        {!git?.isRepo && session?.workspaceMode === "worktree" && session.worktreeBranch && (
          <span className="workspace-mode-label">Isolated · {session.worktreeBranch}</span>
        )}
      </div>
      {busy && (
        <div className="composer-dock-activity" aria-live="polite">
          <span className="dot on live" />
          <span className="shimmer-text">
            Sending…
            <span className="shimmer-overlay" aria-hidden>Sending…</span>
          </span>
        </div>
      )}
    </div>
  );
}
