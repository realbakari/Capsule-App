import { contextTone } from "../../lib/context-window";
import { formatUserError } from "../../lib/errors";
import { agentControls, reportedAgentControls, harnessCapabilities, nextFavoriteModel, planModeSupport, withoutPlanChoice, type PlanRoute } from "@capsule/shared";
import { approvalCarrier, approvalPreset, type HarnessPermissionProfile } from "@capsule/shared";
import { TurnModeChip } from "./TurnModeChip";
import "./plan-mode.css";
import { PlanHandoff } from "./PlanHandoff";
import { CYCLE_FAVORITE_MODEL_EVENT, latestPlanRun } from "../../lib/turn-mode";
import { useHarnessDiscovery } from "../../lib/harness-discovery";
import { AgentControl } from "../harness/AgentControl";
import { ContextWindowMeter } from "./ContextWindowMeter";
import { useHandoff } from "../handoff/Handoff";
import { AgentCommandsControl } from "./AgentCommandsControl";
import { DictationButton, DictationStatus, useDictation } from "./Dictation";
import { dictationUnavailableReason } from "../../lib/dictation";
import { StatusLine } from "../status-line/StatusLine";
import { agentSwitchNotice, canSteerTurn, harnessDisplayName } from "../../lib/harness";
import { AgentModelPicker } from "./AgentModelPicker";
import { ChoiceRows, sentenceCase } from "./ChoiceRows";
import { PermissionsMenu, type ApprovalChoice } from "./PermissionsMenu";
import { RunOnControl, RunOnSummary, useRunOn } from "../best-of-n/RunOnPicker";
import { GatewayBanner } from "../shell/GatewayBanner";
import { TemporaryThreadBanner } from "../threads/ThreadMarks";
import { useThreadActions } from "../threads/ThreadActions";
import { FOLDER_REQUIRED, GATEWAY_CONNECTION_REQUIRED, agentSetupNotice } from "../../lib/harness-preflight";
import { AgentSetupNotice } from "./AgentSetupNotice";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AcpConfigOption, FileEntry } from "@capsule/shared";
import { searchProjectFiles } from "../../lib/bridge";
import { useWorkspace } from "../../lib/workspace";
import { formatProjectRoot, projectFolderName } from "../../lib/paths";
import { WorktreeBasePicker } from "../worktree-base/WorktreeBasePicker";
import { MenuSelect } from "../shell/MenuSelect";
import {
  ArrowUpIcon,
  CheckIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  GitBranchIcon,
  PaperclipIcon,
  StopIcon,
  TerminalIcon,
  XIcon,
} from "../shell/icons";
import { ComposerMenu, detectTrigger, type SuggestItem } from "./ComposerMenu";
import { ComposerTasks } from "./ComposerTasks";
import { QueuedPrompts } from "./QueuedPrompts";
import { recallablePrompts } from "../../lib/prompt-queue";
import { searchComposerSkills, skillSource } from "../../lib/composer-skills";
import { composerPlaceholder, shouldRestComposer } from "../../lib/composer-rest";
import { composerPrimaryAction, PRIMARY_ACTION_LABELS } from "../../lib/composer-primary-action";
import { openComposerControl } from "../../lib/composer-controls";
import { COMMAND_SOURCE_LABELS, commandDetail, commandInDraft } from "../../lib/commands";
import { INSERT_COMMAND_EVENT, KEY_COMMAND_EVENT, shortcutLabel } from "../../lib/keybindings";
import { rankGrouped } from "../../lib/composer-rank";
import { isNarrow } from "../../lib/narrow";
import { tasksFromRunEvents } from "@capsule/shared";
import { initPrompt, mentionSources, parseBangCommand, templateCommand, templateVariables, type PromptTemplate } from "@capsule/shared";
import { CONTEXT_ICONS, ContextChip, ContextPicker, PendingChip, TemplateForm, useContextResolver, type ContextPickerKind } from "./ComposerContext";
import { detectInstructionFiles } from "../project/ProjectInstructions";
import { carriesFileRow, fileRowMention, readFileRowDrag } from "../shell/file-row-actions";

/*
 * What the / menu offers: things that shape this conversation. Going
 * somewhere else in the app (settings, the panel, the terminal) belongs to
 * the command palette, and choosing an agent belongs to /model.
 */
function slashCommands(input: {
  /* Skills belong in this menu too: $ was the only way to reach one, and the
     only thing that ever said so was a legend under the composer. */
  skills: Array<{ id: string; name: string }>;
  setSkillId: (id: string) => void;
  createTask: () => void;
  chooseModel: () => void;
  /** Absent for a device that can only read. */
  plan?: { on: boolean; toggle: () => void };
  /** Absent when the agent offers no compact command. */
  compact?: () => void;
  openStash: () => void;
  /** Absent when there is no project folder to write AGENTS.md into. */
  init?: () => void;
  templates: Array<{ template: PromptTemplate; scope: "Project" | "Personal" }>;
  useTemplate: (template: PromptTemplate) => void;
}): SuggestItem[] {
  return [
    { id: "new", label: "/new", detail: "New conversation", run: () => input.createTask() },
    ...(input.init ? [{ id: "init", label: "/init", detail: "Ask the agent to write or refresh AGENTS.md", run: input.init }] : []),
    { id: "model", label: "/model", detail: "Choose the agent, model and effort", run: input.chooseModel },
    ...(input.plan ? [{ id: "plan", label: "/plan", detail: input.plan.on ? "Turn off plan mode" : "Plan the next turn before changing files", run: input.plan.toggle }] : []),
    ...(input.compact ? [{ id: "compact", label: "/compact", detail: "Ask the agent to summarize its context into less", run: input.compact }] : []),
    { id: "stash", label: "/stash", detail: "Restore a stashed prompt. ⌘S stashes the draft", run: input.openStash },
    ...input.templates.map(({ template, scope }) => ({
      id: `template-${scope}-${template.name}`,
      label: templateCommand(template),
      detail: template.description ?? template.prompt.replace(/\s+/gu, " "),
      badge: scope,
      ...(templateVariables(template.prompt).length ? { run: () => input.useTemplate(template) } : { insert: template.prompt }),
    })),
    ...input.skills.map((skill) => ({
      id: `skill-${skill.id}`,
      label: `/${skill.name.toLowerCase().replace(/\s+/gu, "-")}`,
      detail: `Use the ${skill.name} skill`,
      run: () => input.setSkillId(skill.id),
    })),
  ];
}

/** How soon after an Escape that closed something another Escape is still read as dismissing. */
const ESCAPE_SETTLE_MS = 600;

export function Composer({
  awayFromLatest = false,
}: {
  /** True while the thread is scrolled away from the latest messages. */
  awayFromLatest?: boolean;
}) {
  const workspace = useWorkspace();
  const threadActions = useThreadActions();
  const handoff = useHandoff();
  const { contextUsage } = workspace;
  const {
    draft,
    setDraft,
    send,
    sendAndContinue,
    busy,
    setMode,
    agentId,
    setAgentId,
    agents,
    skills,
    session,
    project,
    git,
    messages,
    runAgentCommand,
    pickProjectDirectory,
    activeRun,
    stopRun,
    createTask,
    setView,
    setSkillId,
    skillId,
    setPermissionProfile,
    draftApproval,
    setDraftApproval,
    harnessStatuses,
    loadHarnessStatus,
    setHarnessOption,
    api,
    projectId,
    connected,
    ready,
    checkoutBranch,
    settings,
    projectSettings,
    sendBlockReason,
    doctorHarness,
    workspaceMode,
    setWorkspaceMode,
    events,
    attachments,
    promptStashes,
    pickAttachments,
    attachClipboardImage,
    attachFiles,
    removeAttachment,
    stashCurrentPrompt,
    restorePromptStash,
    deletePromptStash,
    turnMode,
    setTurnMode,
    favoriteModels,
    toggleFavoriteModel,
    runs,
  } = workspace;
  const harnesses = workspace.harnesses ?? [];
  const runOn = useRunOn();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dictation = useDictation({ api, draft, setDraft, field: textareaRef, scope: `${projectId ?? ""}:${session?.id ?? ""}` });
  const [recall, setRecall] = useState<{ index: number; original: string }>();
  useEffect(() => { setRecall(undefined); }, [session?.id]);
  useEffect(() => {
    if (!recall) return;
    // Typing over a recalled prompt ends the walk; the draft is the person's again.
    if (draft !== recallablePrompts(messages)[recall.index]) setRecall(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);
  const inlinePasteUntil = useRef(0);
  const composerRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [dropping, setDropping] = useState(false);
  const [caret, setCaret] = useState(0);
  const [menuDismissed, setMenuDismissed] = useState(false);
  const menuId = useId();
  const [picker, setPicker] = useState<"file" | "skill">();
  const [contextPicker, setContextPicker] = useState<ContextPickerKind>();
  const [template, setTemplate] = useState<PromptTemplate>();
  const resolver = useContextResolver();
  const [pickerQuery, setPickerQuery] = useState("");
  const [fileState, setFileState] = useState("Searching files…");
  const [picking, setPicking] = useState(false);
  const selectionScope = JSON.stringify([projectId, session?.id, draft]);
  const selectionScopeRef = useRef(selectionScope);
  selectionScopeRef.current = selectionScope;
  const [pendingSelection, setPendingSelection] = useState<{ scope: string; position: number }>();
  useLayoutEffect(() => {
    if (!pendingSelection) return;
    // React must commit the controlled value before restoring its caret. An
    // animation frame can run first under load and then lose the selection.
    if (pendingSelection.scope === selectionScope) {
      // A source that opened its own picker or form keeps the focus it took.
      if (!contextPicker && !template) textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(pendingSelection.position, pendingSelection.position);
      setCaret(pendingSelection.position);
    }
    setPendingSelection(undefined);
  }, [pendingSelection, selectionScope, contextPicker, template]);
  /* A key bound to `command:<name>` puts the command in the draft, as picking it from the `/` menu does. */
  useEffect(() => {
    const insert = (event: Event) => {
      const text = (event as CustomEvent<{ text?: string }>).detail?.text;
      if (!text) return;
      setDraft(text);
      setPendingSelection({ scope: JSON.stringify([projectId, session?.id, text]), position: text.length });
    };
    window.addEventListener(INSERT_COMMAND_EVENT, insert);
    return () => window.removeEventListener(INSERT_COMMAND_EVENT, insert);
  }, [projectId, session?.id, setDraft]);
  const liveHarnessSessionId =
    session?.harnessId && session.harnessState && session.harnessState !== "closed"
      ? session.id
      : undefined;
  const cachedStatus = liveHarnessSessionId ? harnessStatuses[liveHarnessSessionId] : undefined;
  const harnessStatus = cachedStatus?.session.openclawSessionKey === session?.openclawSessionKey ? cachedStatus : undefined;
  const compactCommand = harnessStatus?.parsed?.availableCommands?.find((command) => /^(compact|context-compact)$/i.test(command.name))?.name;
  const lastMovedAt = messages.length ? Date.parse(messages[messages.length - 1]!.createdAt) : Number.NaN;
  const idleMinutes = Number.isNaN(lastMovedAt) ? undefined : (Date.now() - lastMovedAt) / 60_000;
  /*
   * One read per thread and session key. A status that comes back under
   * another key never matches, and re-reading on every render looped.
   */
  const requestedStatus = useRef<string>(undefined);
  useEffect(() => {
    if (harnessStatus) { requestedStatus.current = undefined; return; }
    if (!liveHarnessSessionId) return;
    const wanted = `${liveHarnessSessionId}\n${session?.openclawSessionKey ?? ""}`;
    if (requestedStatus.current === wanted) return;
    requestedStatus.current = wanted;
    void loadHarnessStatus(liveHarnessSessionId);
  }, [harnessStatus, liveHarnessSessionId, session?.openclawSessionKey, loadHarnessStatus]);

  const capabilityHarness = harnesses.find((item) => item.id === agentId);
  const capabilities = harnessCapabilities({ harness: capabilityHarness, session, status: harnessStatus });
  const harnessLive = Boolean(session?.harnessId && session.harnessState && session.harnessState !== "closed");
  const draftConfiguration = workspace.draftHarnessConfig ?? { options: {} };
  const discovery = useHarnessDiscovery(api, projectId, agentId, draftConfiguration.model,
    !harnessLive && capabilities.route === "direct" && Boolean(capabilityHarness) && capabilityHarness?.readiness !== "missing_cli" && api.isDesktop === true, session?.id);
  const controls = harnessLive ? agentControls(session?.harnessId === agentId ? session : undefined, harnessStatus)
    : reportedAgentControls(discovery.result?.reported?.configOptions);
  /* The Plan chip owns the plan choice; the mode picker keeps whatever else the agent offers. */
  const modeControl = withoutPlanChoice(controls.mode);
  const planOptions = harnessLive ? session?.harnessId === agentId ? harnessStatus?.parsed?.reported?.configOptions : undefined : discovery.result?.reported?.configOptions;
  const planRoute: PlanRoute = workspace.status?.kind === "mock" ? "mock" : capabilities.route === "direct" ? "direct" : "gateway";
  const planSupport = planModeSupport({ harnessId: capabilityHarness?.id, harnessName: capabilityHarness?.name ?? agents.find((item) => item.id === agentId)?.name,
    route: planRoute, options: planOptions, reported: Boolean(planOptions) });
  const gatewayUnavailable = ready && !connected && capabilities.route !== "direct" && workspace.status?.kind !== "mock";
  const models = harnessLive ? session?.harnessId === agentId ? harnessStatus?.parsed?.models : undefined : discovery.result?.models;
  const currentModel =
    harnessLive ? session?.harnessId === agentId ? models?.currentModelId ?? harnessStatus?.parsed?.model ?? session.modelOverride ?? "" : ""
      : draftConfiguration.model ?? models?.currentModelId ?? "";

  const [stashOpen, setStashOpen] = useState(false);
  /* When something last used an Escape to close itself, by the event clock. */
  const lastDismissal = useRef(Number.NEGATIVE_INFINITY);
  useEffect(() => {
    const note = (event: KeyboardEvent) => { if (event.key === "Escape" && event.defaultPrevented) lastDismissal.current = event.timeStamp; };
    window.addEventListener("keydown", note);
    return () => window.removeEventListener("keydown", note);
  }, []);
  /* A paired browser without conversation control can read but never send. */
  const readOnlyViewer = api.isDesktop === false && api.remoteMode !== "control";
  const toggleTurnMode = () => void setTurnMode(turnMode === "plan" ? "act" : "plan");
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
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
  /* A conversation that has not started yet: where it runs can still change. */
  const newThread = !session || (messages.length === 0 && !activeRun);
  const trigger = detectTrigger(draft, caret);
  const menuOpen = Boolean(picker || trigger) && !menuDismissed && !dictation.active;
  const resting = shouldRestComposer({
    awayFromLatest,
    blocking: Boolean(picker || contextPicker || template || modelPickerOpen || stashOpen || dropping || menuOpen || dictation.state.phase !== "idle"),
    multiline: draft.includes("\n"),
    hasAttachments: attachments.length > 0 || resolver.pending.length > 0,
    hasSkill: Boolean(skillId),
  });
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
  useEffect(() => { setPicker(undefined); setPickerQuery(""); setMenuDismissed(true); setContextPicker(undefined); setTemplate(undefined); }, [projectId, session?.id]);

  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    if (resting) {
      el.style.setProperty("height", "2.35rem", "important");
      el.style.setProperty("min-height", "2.35rem", "important");
      el.style.setProperty("max-height", "2.35rem", "important");
      return;
    }
    el.style.removeProperty("height");
    el.style.removeProperty("min-height");
    el.style.removeProperty("max-height");
    el.style.height = "auto";
    // Let the CSS text scale own the cap rather than freezing it at 176px.
    const maximumHeight = Number.parseFloat(getComputedStyle(el).maxHeight);
    el.style.height = `${Number.isFinite(maximumHeight) ? Math.min(el.scrollHeight, maximumHeight) : el.scrollHeight}px`;
  }, [draft, resting]);

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

  /* A project's saved prompts come first and win a name clash: they are what the repository agreed on. */
  const templates = useMemo(() => {
    const shared = project?.projectFile?.status === "ok" ? project.projectFile.file.prompts ?? [] : [];
    const taken = new Set(shared.map((item) => templateCommand(item)));
    return [
      ...shared.map((item) => ({ template: item, scope: "Project" as const })),
      ...(settings?.composerPrompts ?? []).filter((item) => !taken.has(templateCommand(item))).map((item) => ({ template: item, scope: "Personal" as const })),
    ];
  }, [project?.projectFile, settings?.composerPrompts]);

  const commands = workspace.commands?.list?.commands;
  /* Only an agent Capsule runs directly reports its commands; the Gateway route shares no list. */
  const agentCommands = session?.openclawSessionKey?.startsWith("direct:acp:") && !readOnlyViewer ? harnessStatus?.parsed?.availableCommands : undefined;
  const agentLabel = harnessDisplayName(harnesses, session?.harnessId, "Agent");
  /* Project commands lead the menu, then Capsule's, then the agent's own; each sits under a heading once there is more than one. */
  const slashItems = useMemo<SuggestItem[]>(
    () => {
      if (trigger?.kind !== "slash") return [];
      const own: SuggestItem[] = (commands ?? []).map((command) => ({
        id: `command-${command.name}`,
        label: `/${command.name}`,
        detail: commandDetail(command),
        badge: COMMAND_SOURCE_LABELS[command.source],
        group: "Commands",
        kind: "command" as const,
        insert: `/${command.name} `,
      }));
      const builtIn = slashCommands({
        skills: skills.filter((skill) => skill.status === "installed"),
        setSkillId,
        createTask,
        chooseModel: () => { const reason = openComposerControl("model"); if (reason) workspace.setNotice(reason); },
        plan: readOnlyViewer ? undefined : { on: turnMode === "plan", toggle: toggleTurnMode },
        compact: compactCommand && !readOnlyViewer ? () => void runAgentCommand(compactCommand) : undefined,
        openStash: () => setStashOpen(true),
        init: projectId && folderPath ? () => void runInit() : undefined,
        templates,
        useTemplate: setTemplate,
      });
      // A name Capsule already answers to stays Capsule's; the agent's version is under Agent commands.
      const taken = new Set([...own, ...builtIn].map((item) => item.label));
      const fromAgent: SuggestItem[] = (agentCommands ?? []).filter((command) => !taken.has(`/${command.name}`)).map((command) => ({
        id: `agent-${command.name}`,
        label: `/${command.name}`,
        detail: command.description || (command.inputHint ? `Takes ${command.inputHint}` : `${agentLabel} command`),
        badge: agentLabel,
        group: agentLabel,
        kind: "command" as const,
        // A command that takes input goes into the message to finish; one that does not runs as its own turn.
        ...(command.inputHint === undefined && api.isDesktop === true
          ? { run: async () => { await runAgentCommand(command.name); } }
          : { insert: `/${command.name} ` }),
      }));
      const grouped = own.length || fromAgent.length;
      const all = [...own, ...builtIn.map((item) => grouped ? { ...item, group: "Capsule" } : item), ...fromAgent];
      return rankGrouped(all, trigger.query, (item) => item.label, (item) => item.detail);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [templates, folderPath, projectId, commands, createTask, skills, setSkillId, trigger, readOnlyViewer, turnMode, compactCommand, runAgentCommand, agentCommands, agentLabel, api.isDesktop],
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

  /* `@` offers the context sources first, then files. Each source reaches past this
     window (git, a command, the network), so a paired browser is not offered them. */
  const contextItems = useMemo<SuggestItem[]>(() => !picker && trigger?.kind === "file" && api.isDesktop === true && projectId
    ? mentionSources(trigger.query).map((source) => ({
      id: `context-${source.kind}`,
      label: `@${source.keyword}`,
      detail: source.detail,
      icon: CONTEXT_ICONS[source.kind](14),
      insert: "",
      run: () => {
        if (source.kind === "thread" || source.kind === "diff" || source.kind === "url") setContextPicker(source.kind);
        else void resolver.attachDiagnostics();
      },
    }))
    : [], [api.isDesktop, picker, projectId, resolver, trigger]);

  const items = !menuOpen
    ? []
    : searchKind === "slash"
      ? slashItems
      : searchKind === "skill"
        ? skillItems
        : searchKind === "file"
          ? [...contextItems, ...fileItems]
          : [];

  useEffect(() => {
    setMenuIndex(0);
    setMenuDismissed(false);
  }, [searchKind, searchQuery]);

  const [expanding, setExpanding] = useState(false);
  /*
   * A `send: review` command fills the composer with its expansion for
   * editing. Expanding can run shell on the desktop, so a paired device sends
   * it instead, and the desktop expands it as it would any command.
   */
  async function submit(continueToNew = false) {
    if (workspace.queuedEdit) { await workspace.saveQueuedEdit(); return; }
    // An @ source or ! command still running would be left behind by this send.
    if (contextWait) { workspace.setNotice(contextWait); return; }
    /* With two or more agents picked under Run on…, sending starts the comparison instead. */
    if (runOn.active) return runOn.start();
    const review = api.isDesktop === true && projectId ? commandInDraft(draft, commands) : undefined;
    if (review?.send !== "review") return continueToNew ? sendAndContinue() : send();
    if (expanding) return;
    setExpanding(true);
    try {
      const result = await api.commandsExpand({ projectId: projectId!, ...(session ? { sessionId: session.id } : {}), text: draft });
      setDraft(result.text);
      setPendingSelection({ scope: JSON.stringify([projectId, session?.id, result.text]), position: result.text.length });
      if (result.attachments.length) await attachFiles(result.attachments.map((file) => file.path));
      if (result.problems.length) workspace.setNotice(result.problems.join(" "));
    } catch (error) {
      workspace.setNotice(formatUserError(error));
    } finally {
      setExpanding(false);
    }
  }

  function syncCaret() {
    const el = textareaRef.current;
    if (el) setCaret(el.selectionStart);
  }

  /*
   * Change the message the way typing would, so ⌘Z takes the change back.
   * Setting a controlled value directly empties the field's undo history.
   * Where the browser refuses the edit, the draft is set as before.
   */
  function editDraft(start: number, end: number, text: string): string {
    const next = draft.slice(0, start) + text + draft.slice(end);
    const field = textareaRef.current;
    if (field && !field.readOnly && field.value === draft) {
      // The edit needs the field focused; a picker's own search box that just opened keeps the focus it took.
      const typingElsewhere = document.activeElement !== field && document.activeElement?.matches("input, textarea, select") ? document.activeElement as HTMLElement : undefined;
      field.focus();
      field.setSelectionRange(start, end);
      const done = text ? document.execCommand("insertText", false, text) : start === end || document.execCommand("delete");
      typingElsewhere?.focus();
      if (done && field.value === next) return next;
    }
    setDraft(next);
    return next;
  }

  async function applyItem(item: SuggestItem) {
    if (picking) return;
    setPicking(true);
    try {
      await item.run?.();
      if (selectionScopeRef.current !== selectionScope) return;
      const position = !picker && trigger ? trigger.start + (item.insert?.length ?? 0) : caret;
      const nextDraft = !picker && trigger ? editDraft(trigger.start, caret, item.insert ?? "") : draft;
      setPicker(undefined);
      setMenuDismissed(true);
      setPendingSelection({ scope: JSON.stringify([projectId, session?.id, nextDraft]), position });
    } catch (error) { workspace.setNotice(formatUserError(error)); }
    finally { setPicking(false); }
  }

  function openPicker(kind: "file" | "skill") { setPicker(kind); setPickerQuery(""); setMenuDismissed(false); setMenuIndex(0); }

  function composing(event: { nativeEvent: { isComposing?: boolean }; keyCode?: number }) {
    return Boolean(event.nativeEvent.isComposing) || event.keyCode === 229;
  }

  async function runInit() {
    if (!projectId) return;
    const found = await detectInstructionFiles(api, projectId);
    await workspace.sendPrompt(initPrompt(found));
  }

  function runBang(command: string) {
    if (api.isDesktop !== true) { workspace.setNotice("Commands after ! run only in the desktop app."); return; }
    setDraft("");
    void resolver.runCommand(command).then((attached) => {
      // Give a failed command back so it can be fixed and run again.
      if (!attached) setDraft((current) => current || `!${command}`);
    });
  }

  function fillFromTemplate(text: string) {
    setTemplate(undefined);
    const kept = draft.trimEnd().length;
    const nextDraft = editDraft(kept, draft.length, kept ? `\n${text}` : text);
    setPendingSelection({ scope: JSON.stringify([projectId, session?.id, nextDraft]), position: nextDraft.length });
  }

  const approval = approvalPreset(session ? session.permissionProfile ?? projectSettings?.defaultPermission ?? settings?.defaultPermission : draftApproval ?? projectSettings?.defaultPermission ?? settings?.defaultPermission);
  const approvalRoute = capabilities.route === "direct" ? "direct" : capabilities.route === "openclaw" ? "gateway" : undefined;
  /*
   * When Capsule's approval setting sets the agent's own permission mode, a
   * second "Agent permissions" chip beside it could contradict it; show one.
   */
  const approvalSetsAgentMode = Boolean(approvalRoute && approvalCarrier(approval.id, { route: approvalRoute, harnessId: agentId }).agentMode);
  const permissionsControl = approvalSetsAgentMode ? undefined : controls.permissions;
  const sendOnEnter = settings?.composerSendKey !== "cmd-enter";
  const selectedHarness = harnesses.find((item) => item.id === agentId);
  const setupNotice = session?.paused ? undefined : agentSetupNotice(selectedHarness, sendBlockReason);
  const bang = parseBangCommand(draft);
  const taskEvents = useMemo(() => activeRun ? (events ?? []).filter((event) => event.runId === activeRun.id) : events ?? [], [events, activeRun?.id]);
  const tasks = useMemo(() => tasksFromRunEvents(taskEvents), [taskEvents]);
  const planTasks = !activeRun && Boolean(latestPlanRun(runs, session?.id));
  const modelChoices = models?.availableModels.map((model) => model.modelId) ?? [];
  const chooseModel = (id: string) => harnessLive ? void setHarnessOption("model", id) : workspace.setDraftHarnessConfig({ model: id, options: {} });
  const cycleFavorite = useRef<() => void>(() => undefined);
  cycleFavorite.current = () => {
    if (readOnlyViewer) return;
    const next = nextFavoriteModel(favoriteModels, agentId, modelChoices, currentModel);
    if (!next) {
      workspace.setNotice(modelChoices.length ? "Star models in the model picker to cycle through them with ⌥⌘M." : "This agent has not reported its models yet. Open the model picker to load them.");
      return;
    }
    if (busy || activeRun) { workspace.setNotice("Wait for this turn to finish before changing the model."); return; }
    if (next !== currentModel) chooseModel(next);
  };
  useEffect(() => {
    const onCycle = () => cycleFavorite.current();
    window.addEventListener(CYCLE_FAVORITE_MODEL_EVENT, onCycle);
    return () => window.removeEventListener(CYCLE_FAVORITE_MODEL_EVENT, onCycle);
  }, []);

  /* Approvals join the footer only while they differ from the default; the picker always holds them. */
  const defaultApproval = approvalPreset(projectSettings?.defaultPermission ?? settings?.defaultPermission);
  const approvalUnavailable = api.isDesktop !== true ? "Change approvals on the desktop." : busy ? "Wait for the message to send." : approvalRoute === "gateway" && activeRun ? "Wait for this turn to finish." : undefined;
  const changeApproval = (id: HarnessPermissionProfile) => { if (session) void setPermissionProfile(id); else setDraftApproval(id); };
  /* Exact agent settings travel only on the direct route; the Gateway carries model and approvals. */
  const directRoute = capabilities.route === "direct";
  const effortOption = directRoute ? controls.effort : undefined;
  const effortValue = effortOption ? harnessLive ? effortOption.currentValue : draftConfiguration.options[effortOption.id] ?? effortOption.currentValue : undefined;
  const effortName = effortOption?.choices.find((choice) => choice.value === effortValue)?.name;
  const effortLabel = effortName ? sentenceCase(effortName) : undefined;
  /* The modes Claude Code and Codex report are permission modes, so they sit with approvals rather than effort. */
  const agentModeOption = directRoute ? modeControl : undefined;
  const agentPermissionsOption = directRoute ? permissionsControl : undefined;
  const settingBusy = busy || Boolean(activeRun);
  function settingRows(option: AcpConfigOption, label: string) {
    if (harnessLive && session) return <AgentControl key={`${session.id}:${option.id}`} sessionId={session.id} option={option} label={label} disabled={settingBusy} />;
    return <ChoiceRows key={option.id} label={label} current={String(draftConfiguration.options[option.id] ?? option.currentValue ?? "")}
      choices={option.choices.map((choice) => ({ value: choice.value, name: choice.name, description: choice.description }))}
      unavailableReason={busy || api.isDesktop !== true ? "Change settings when the desktop is ready." : undefined}
      onPick={(value) => workspace.setDraftHarnessConfig({ ...draftConfiguration, options: { ...draftConfiguration.options, [option.id]: value } })} />;
  }
  const approvalChoice: ApprovalChoice | undefined = approvalRoute
    ? { current: approval.id, route: approvalRoute, harnessId: session?.harnessId ?? capabilityHarness?.id, unavailableReason: approvalUnavailable, onPick: changeApproval } : undefined;
  const agentPermissionSettings = agentModeOption || agentPermissionsOption ? <>
    {agentModeOption && <div className="permissions-agent"><p>Agent mode</p>{settingRows(agentModeOption, "Agent mode")}</div>}
    {agentPermissionsOption && <div className="permissions-agent"><p>Agent permissions</p>{settingRows(agentPermissionsOption, "Agent permissions")}</div>}
  </> : undefined;
  const hasPermissions = Boolean(approvalChoice || agentPermissionSettings);
  const permissionsMenu = (className: string, chevron = false) => <PermissionsMenu className={className} chevron={chevron} approval={approvalChoice} agentSettings={agentPermissionSettings} />;
  /* On a new conversation the row under the composer names the mode; once it has started, a chip does while it differs from the default. */
  const permissionsChip = !readOnlyViewer && !runOn.active && hasPermissions && Boolean(approvalChoice) && approval.id !== defaultApproval.id;
  const settingLabels = [
    ...(effortOption ? ["Reasoning effort"] : []),
    ...(!readOnlyViewer && hasPermissions ? ["Permissions"] : []),
  ];
  /* The Reasoning column says why it is empty rather than vanishing. */
  const reasoning = effortOption ? settingRows(effortOption, "Reasoning effort")
    : <p className="agent-model-reasoning-note">{capabilities.route === "openclaw" ? "Effort isn't adjustable on the Gateway route."
      : directRoute && !harnessLive && discovery.loading ? "Loading effort levels…"
      : directRoute ? "This agent reports no effort levels." : "Effort isn't adjustable here."}</p>;
  const focusPicker = () => composerRef.current?.querySelector<HTMLButtonElement>('[aria-label="Agent and model"]')?.focus();

  /* Send stays Send while a turn runs; an empty draft is what turns it into Stop. */
  const hasContent = Boolean(draft.trim()) || attachments.length > 0 || Boolean(skillId);
  const running = Boolean(activeRun);
  /* Whether this draft could go into the running turn at all; the setting picks between that and the queue. */
  const canSteerDraft = attachments.length === 0 && !skillId
    && canSteerTurn({ harness: harnesses.find((item) => item.id === session?.harnessId), session, status: harnessStatus, desktop: api.isDesktop !== false });
  const steerTurn = settings?.followUpBehavior === "steer" && canSteerDraft;
  const resolvingContext = resolver.pending.filter((item) => !item.error);
  const contextWait = resolvingContext.length
    ? `Wait for ${resolvingContext.map((item) => item.kind === "command" ? `!${item.label}` : `@${item.kind}`).join(", ")} to finish attaching before sending.`
    : undefined;
  /* A phone or tablet keyboard's Return makes a new line; the send button sends. */
  const touchKeyboard = (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches) || (api.isDesktop === false && isNarrow());
  const returnSends = sendOnEnter && !touchKeyboard;
  const queuedEdit = workspace.queuedEdit;
  const contextLevel = contextUsage ? contextTone(contextUsage.fraction) : "normal";
  const primary = composerPrimaryAction({ running, stopping: Boolean(activeRun && workspace.stoppingRunIds?.includes(activeRun.id)),
    hasContent, bang: Boolean(bang), steer: steerTurn });
  const otherKeys = shortcutLabel("composer-other-action", workspace.keyBindings);
  /* The follow-up the primary button would not send: queue instead of steer, or steer instead of queue. */
  const keyActions = useRef<Record<string, () => void>>({});
  keyActions.current = {
    "composer-other-action": () => {
      if (queuedEdit) { void submit(); return; }
      if (!running || primary.kind === "run-command" || !hasContent) { void submit(); return; }
      if (readOnlyViewer) { workspace.setNotice("This device can only read."); return; }
      if (contextWait) { workspace.setNotice(contextWait); return; }
      if (primary.kind === "steer") { void workspace.sendFollowUp("queue"); return; }
      if (!canSteerDraft) {
        workspace.setNotice(attachments.length || skillId ? "Files and skills can't go into a running turn, so this one waits in the queue." : `${harnessDisplayName(harnesses, session?.harnessId, "This agent")} can't take messages mid-turn here.`);
        return;
      }
      void workspace.sendFollowUp("steer");
    },
    "steer-first-queued": () => {
      const first = workspace.queue[0];
      if (!first) { workspace.setNotice("Nothing is queued."); return; }
      if (readOnlyViewer) { workspace.setNotice("This device can only read."); return; }
      if (!running) { workspace.releaseQueued(first.id); return; }
      if (first.attachments.length || first.skillId) { workspace.setNotice("Files and skills can't go into a running turn, so the first queued message waits for this turn to end."); return; }
      if (!canSteerTurn({ harness: harnesses.find((item) => item.id === session?.harnessId), session, status: harnessStatus, desktop: api.isDesktop !== false })) {
        workspace.setNotice(`${harnessDisplayName(harnesses, session?.harnessId, "This agent")} can't take messages mid-turn here.`);
        return;
      }
      void workspace.steerQueued(first.id);
    },
  };
  useEffect(() => {
    const onKey = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id === "composer-other-action" || id === "steer-first-queued") keyActions.current[id]?.();
    };
    window.addEventListener(KEY_COMMAND_EVENT, onKey);
    return () => window.removeEventListener(KEY_COMMAND_EVENT, onKey);
  }, []);

  return (
    <div ref={composerRef} data-keymap-context="composer" className={`composer composer-dock composer-overlay-corner-masks${busy ? " composer-dock--with-activity" : ""}${resting ? " composer--resting" : ""}`}>
      <ComposerTasks tasks={tasks} running={Boolean(activeRun)} actions={planTasks ? <PlanHandoff compact /> : undefined} />
      <div
        className={`composer-glass${dropping ? " dropping" : ""}${resting ? " composer-glass--resting" : ""}`}
        aria-expanded={!resting}
        onDragOver={(event) => {
          if (carriesFileRow(event.dataTransfer.types)) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setDropping(true);
            return;
          }
          // Only files attach. Dragged text is left to the field, which inserts it where it lands.
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
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
         * out first. Large text is folded only when the route supports resources;
         * ordinary text and explicit inline pastes retain native editing behavior.
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
          if (!hasImage) {
            const text = data.getData("text/plain");
            const bytes = new TextEncoder().encode(text).length;
            // Do not turn a working plain prompt into an unsupported resource.
            const supportsText = capabilities.route !== "direct" || harnessStatus?.parsed?.reported?.embeddedContext === true;
            const inline = Date.now() <= inlinePasteUntil.current;
            inlinePasteUntil.current = 0;
            if (bytes >= 32 * 1024 && bytes <= 2 * 1024 * 1024 && supportsText && api.isDesktop !== false && !inline && event.target === textareaRef.current) {
              event.preventDefault();
              const start = textareaRef.current.selectionStart;
              const end = textareaRef.current.selectionEnd;
              const owner = selectionScope;
              void workspace.attachPastedText(text).then((attached) => {
                if (!attached || selectionScopeRef.current !== owner) return;
                const nextDraft = draft.slice(0, start) + draft.slice(end);
                setDraft(nextDraft);
                setPendingSelection({ scope: JSON.stringify([projectId, session?.id, nextDraft]), position: start });
              });
            }
            return;
          }
          // Only swallow the keystroke once we know an image is there, or a
          // normal text paste would stop working.
          event.preventDefault();
          void attachClipboardImage();
          } catch (error) {
            event.preventDefault();
            workspace.setNotice(formatUserError(error));
          }
        }}
        onDrop={(event) => {
          // A row dragged from the Files tree is a mention, the same as its menu's Mention in composer.
          const row = readFileRowDrag(event.dataTransfer);
          if (row) {
            event.preventDefault();
            setDropping(false);
            workspace.mentionFile(fileRowMention(row, session?.workingDirectory ?? project?.workingDirectory));
            textareaRef.current?.focus();
            return;
          }
          setDropping(false);
          if (!Array.from(event.dataTransfer.types).includes("Files")) return;
          event.preventDefault();
          try {
          const paths = Array.from(event.dataTransfer.files)
            .map((file) => api.getPathForFile(file))
            .filter((filePath): filePath is string => Boolean(filePath));
          if (paths.length > 0) void attachFiles(paths);
          } catch (error) { workspace.setNotice(formatUserError(error)); }
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
        {contextPicker && !picker && <ContextPicker kind={contextPicker} resolver={resolver} onClose={() => { setContextPicker(undefined); textareaRef.current?.focus(); }} />}
        {template && !picker && !contextPicker && <TemplateForm key={template.name} template={template} onCancel={() => { setTemplate(undefined); textareaRef.current?.focus(); }} onFill={fillFromTemplate} />}
        {expanding && <div className="meta" role="status">Expanding {commandInDraft(draft, commands) ? `/${commandInDraft(draft, commands)!.name}` : "the command"} for review…</div>}
        {workspace.preparingAttachments > 0 && <div className="meta" role="status">Preparing {workspace.preparingAttachments} attachment{workspace.preparingAttachments === 1 ? "" : "s"}…</div>}
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
        <DictationStatus state={dictation.state} api={api} onCancel={dictation.cancel} onFinish={dictation.finish} onDismiss={dictation.dismiss} />
        <div className="composer-prompt">
        <textarea
          ref={textareaRef}
          readOnly={dictation.active}
          className={resting ? "composer-field composer-field--resting" : "composer-field"}
          rows={1}
          value={draft}
          aria-label="Message"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={!picker && menuOpen}
          enterKeyHint={returnSends ? "send" : "enter"}
          aria-controls={!picker && menuOpen ? menuId : undefined}
          aria-activedescendant={!picker && items[menuIndex] ? `${menuId}-${menuIndex}` : undefined}
          placeholder={readOnlyViewer ? "Read only on this device" : composerPlaceholder({ running, steer: steerTurn })}
          onChange={(event) => {
            setDraft(event.target.value);
            setCaret(event.target.selectionStart);
          }}
          onClick={syncCaret}
          onKeyUp={syncCaret}
          onSelect={syncCaret}
          onKeyDown={(event) => {
            // A key the shortcut map already acted on is not also typing here.
            if (composing(event) || event.nativeEvent.defaultPrevented) return;
            if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "v") inlinePasteUntil.current = Date.now() + 2000;
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
            if (event.key === "Escape" && stashOpen) { event.preventDefault(); setStashOpen(false); return; }
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
            }
            if (event.key === "Tab" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && !readOnlyViewer) {
              event.preventDefault();
              toggleTurnMode();
              return;
            }
            if (event.key === "Escape") {
              if (menuOpen) { event.preventDefault(); setMenuDismissed(true); return; }
              if (queuedEdit) { event.preventDefault(); workspace.cancelQueuedEdit(); return; }
              /*
               * With nothing to dismiss, Escape stops the running turn, the way
               * the Stop button does. Not a held key, and not straight after an
               * Escape that closed something: that is someone still dismissing.
               */
              if (activeRun && !readOnlyViewer && !workspace.stoppingRunIds?.includes(activeRun.id) && !event.repeat && event.timeStamp - lastDismissal.current > ESCAPE_SETTLE_MS) {
                event.preventDefault();
                void stopRun();
              }
              return;
            }
            /* ⌥↑ in an empty prompt takes the last queued follow-up back to edit. */
            if (event.key === "ArrowUp" && event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey && !menuOpen && !event.currentTarget.value.trim()) {
              const last = workspace.queue.at(-1);
              if (last) { event.preventDefault(); workspace.editQueued(last.id); return; }
            }
            /*
             * ArrowUp in an empty prompt, or at its start, walks back through
             * what this thread was asked before; ArrowDown walks forward and
             * finally restores whatever was being typed. Inside a recalled
             * prompt of several lines, the arrows move the caret until it
             * reaches the first line (up) or the last (down).
             */
            if ((event.key === "ArrowUp" || event.key === "ArrowDown") && !menuOpen && items.length === 0 && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
              const field = event.currentTarget;
              const history = recallablePrompts(messages);
              const atStart = draft === "" || (field.selectionStart === 0 && field.selectionEnd === 0);
              const onFirstLine = !field.value.slice(0, field.selectionStart).includes("\n");
              const onLastLine = !field.value.slice(field.selectionEnd).includes("\n");
              if (event.key === "ArrowUp" && history.length > 0 && (atStart || (recall && onFirstLine))) {
                event.preventDefault();
                const index = recall ? Math.min(recall.index + 1, history.length - 1) : 0;
                if (recall && index === recall.index) return;
                setRecall({ index, original: recall?.original ?? draft });
                editDraft(0, draft.length, history[index]!);
                return;
              }
              if (event.key === "ArrowDown" && recall && onLastLine) {
                event.preventDefault();
                if (recall.index === 0) { editDraft(0, draft.length, recall.original); setRecall(undefined); }
                else { setRecall({ ...recall, index: recall.index - 1 }); editDraft(0, draft.length, history[recall.index - 1]!); }
                return;
              }
            }
            /* `!command` runs here instead of reaching the agent. */
            if (bang && event.key === "Enter" && !event.shiftKey && (returnSends || event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              runBang(bang);
              return;
            }
            /* ⌘Enter always sends; adding Shift also starts another conversation. */
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void submit(event.shiftKey);
              return;
            }
            /* Enter with nothing to pick from an open menu sends, as it does with the menu closed. */
            if (event.key === "Enter" && !event.shiftKey) {
              if (!returnSends) return;
              event.preventDefault();
              void submit();
            }
          }}
        />
        </div>
        {bang && (
          <div className="composer-bang-hint" role="status">
            <TerminalIcon size={12} />
            {api.isDesktop === true
              ? <span>{sendOnEnter ? "Enter" : "⌘Enter"} runs <code>{bang}</code> in {folder ?? "the project folder"}. The output is attached; nothing is sent yet.</span>
              : <span>Commands after ! run only in the desktop app.</span>}
          </div>
        )}
        {(attachments.length > 0 || resolver.pending.length > 0) && (
          <div className="composer-attachments" aria-label="Attached files">
            {attachments.map((attachment) => attachment.context ? (
              <ContextChip key={attachment.path} attachment={attachment} context={attachment.context} onRemove={() => removeAttachment(attachment.path)} />
            ) : (
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
            {resolver.pending.map((item) => <PendingChip key={item.id} item={item} onDismiss={() => resolver.dismiss(item.id)} />)}
          </div>
        )}
        {stashOpen && (
          <div className="composer-stash" role="dialog" aria-label="Stashed prompts" onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setStashOpen(false);
            textareaRef.current?.focus();
          }}>
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
                      // Put the text in as an edit first, so ⌘Z gives back what was there.
                      editDraft(0, draft.length, entry.prompt);
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
        <TemporaryThreadBanner />
        {gatewayUnavailable && <GatewayBanner inset />}
        {setupNotice && selectedHarness && !runOn.active ? (
          <AgentSetupNotice notice={setupNotice} harness={selectedHarness} canAct={!readOnlyViewer && api.isDesktop !== false} />
        ) : sendBlockReason && !runOn.active && !(gatewayUnavailable && sendBlockReason === GATEWAY_CONNECTION_REQUIRED) && (
          <div className={`composer-preflight${readOnlyViewer ? " read-only" : ""}`} role="status">
            <span title={sendBlockReason}>{sendBlockReason}</span>
            {/* A read-only viewer can do neither; the reason is the whole message. */}
            {readOnlyViewer ? null : session?.paused ? (
              <button className="ghost" type="button" onClick={() => void threadActions.resume(session.id)}>
                Resume
              </button>
            ) : sendBlockReason === FOLDER_REQUIRED ? (
              /* No folder: the fix is a folder, not a doctor. */
              <button className="ghost" type="button" onClick={() => void pickProjectDirectory()}>
                Attach folder
              </button>
            ) : selectedHarness ? (
              <button className="ghost" type="button" onClick={() => void doctorHarness(selectedHarness.id)}>
                Check agent
              </button>
            ) : null}
            {readOnlyViewer || session?.paused || sendBlockReason === FOLDER_REQUIRED ? null : <button className="ghost" type="button" onClick={() => setView("runtimes")}>
              Open Agents
            </button>}
          </div>
        )}
        {queuedEdit && <div className="composer-queued-edit" role="status">
          <span>Editing queued message</span>
          <button type="button" className="ghost" onClick={() => { workspace.cancelQueuedEdit(); textareaRef.current?.focus(); }}>Cancel</button>
        </div>}
        <QueuedPrompts />
        <div className="composer-row">
          {/* Attach on the left, with a turn setting beside it only while it differs from the usual. */}
          <div className="composer-tools">
            <button className="icon-btn composer-attach" title="Attach files" aria-label="Attach files" onClick={() => void pickAttachments()}>
              <PaperclipIcon size={14} />
            </button>
            {/* Plan shows only while it is on (from /plan or ⇧Tab); asking the agent for a plan needs no switch. */}
            {!readOnlyViewer && !runOn.active && turnMode === "plan" && <TurnModeChip support={planSupport} onTurnOff={toggleTurnMode}
              disabledReason={busy ? "Wait for the message to send." : undefined} />}
            {permissionsChip && permissionsMenu("composer-permissions-chip")}
          </div>
          <div className="composer-controls" ref={controlsRef}>
            {/* Under Run on…, the candidates are the agents; the single-agent controls would describe a turn that is not sent. */}
            {runOn.active ? <RunOnSummary runOn={runOn} /> : <AgentModelPicker agents={agents} harnesses={harnesses} agentId={agentId} liveHarnessId={liveHarnessId}
              models={models} currentModel={currentModel} availability={!harnessLive && models?.availableModels.length ? { state: "available", detail: "Reported by the installed agent." } : capabilities.model}
              disabled={busy || Boolean(activeRun) || api.isDesktop !== true}
              loading={discovery.loading} error={discovery.error} onRetry={discovery.retry}
              onManage={() => setView("runtimes")} onOpenChange={setModelPickerOpen}
              onAgent={setAgentId} onModel={chooseModel}
              favorites={favoriteModels} onToggleFavorite={readOnlyViewer || api.isDesktop === false ? undefined : (id) => void toggleFavoriteModel(agentId, id).catch((error: unknown) => workspace.setNotice(formatUserError(error)))}
              modeModels={settings?.modeModels[agentId]}
              onModeModel={api.isDesktop === false ? undefined : (mode, id) => {
                const current = settings?.modeModels ?? {};
                const row = { ...current[agentId], [mode]: current[agentId]?.[mode] === id ? undefined : id };
                void workspace.updateSettings({ modeModels: { ...current, [agentId]: row } }).catch((error: unknown) => workspace.setNotice(formatUserError(error)));
              }}
              profiles={workspace.config?.profiles} onProfile={(id) => void workspace.startWithProfile(id)}
              detail={effortLabel} settingLabels={settingLabels} reasoning={reasoning}
              permissions={hasPermissions ? permissionsMenu("agent-model-permissions", true) : undefined} />}
          </div>
          {session?.harnessId && <AgentCommandsControl key={session.id} hideTrigger anchor={controlsRef} onReturnFocus={focusPicker} />}
          <div className="composer-prompt-actions">
            <DictationButton state={dictation.state} unavailable={dictationUnavailableReason(api)} onToggle={dictation.toggle} />
            {/* Quiet until it fills up: the ring is neutral below the warning level and colours from there. */}
            {contextUsage && (
              <ContextWindowMeter
                used={contextUsage.used}
                limit={contextUsage.limit}
                fraction={contextUsage.fraction}
                tone={contextLevel}
                size={22}
                onCompact={compactCommand ? () => void runAgentCommand(compactCommand) : undefined}
                onFresh={() => void createTask()}
                onHandoff={session && !handoff.disabledReason ? () => handoff.openHandoff(session.id) : undefined}
                compactUnavailable={compactCommand ? undefined : harnessLive ? "This agent does not offer a compact command." : "Start an agent conversation first."}
                idleMinutes={idleMinutes}
              />
            )}
            {queuedEdit ? (
              <button className="send-btn" aria-label="Update queued message" title="Update queued message · Esc cancels the edit"
                disabled={busy || picking || dictation.active || !hasContent || readOnlyViewer || Boolean(contextWait)}
                onClick={() => void submit()}>
                <CheckIcon size={14} />
              </button>
            ) : primary.kind === "stop" ? (
              <button className="send-btn stop" disabled={readOnlyViewer || primary.stopping} title={readOnlyViewer ? "This device can only read." : primary.stopping ? "Stopping. Waiting for the agent to finish its current step." : "Stop (Esc)"} aria-label={primary.stopping ? "Stopping" : "Stop"} onClick={() => void stopRun()}>
                <StopIcon size={16} />
              </button>
            ) : (
              <button
                className="send-btn"
                aria-label={runOn.active && primary.kind === "send" ? `Run on ${runOn.picks.length} agents` : PRIMARY_ACTION_LABELS[primary.kind]}
                disabled={busy || picking || expanding || dictation.active || runOn.starting || !hasContent
                  || (primary.kind !== "run-command" && Boolean(contextWait))
                  || (primary.kind === "queue" || primary.kind === "steer" ? readOnlyViewer : primary.kind !== "run-command" && !runOn.active && Boolean(sendBlockReason))}
                title={
                  primary.kind === "run-command" ? `Run ${bang} and attach its output`
                    : contextWait ? contextWait
                    : primary.kind === "queue" ? `Queue for when this turn ends${canSteerDraft && otherKeys ? ` · ${otherKeys} sends it into the turn now` : ""} · Esc stops the turn`
                    : primary.kind === "steer" ? `Send into the running turn${otherKeys ? ` · ${otherKeys} queues it instead` : ""} · Esc stops the turn`
                    : runOn.active ? `Send to ${runOn.picks.length} agents, each in its own worktree`
                    : sendBlockReason || (returnSends ? "Send · Enter · ⌘⇧Enter sends and starts another conversation" : "Send · ⌘Enter · ⌘⇧Enter sends and starts another conversation")
                }
                onClick={() => { if (bang) runBang(bang); else void submit(); }}
              >
                {primary.kind === "run-command" ? <TerminalIcon size={14} /> : primary.kind === "queue" ? <ClockIcon size={14} /> : <ArrowUpIcon size={14} />}
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
      {/* Where a new conversation will run. Once it has started, Conversation details says so. */}
      <div className="composer-context">
        {newThread && <>
        {git?.isRepo ? <MenuSelect ariaLabel="Conversation workspace" value={workspaceMode} icon={<FolderIcon size={13} />}
          options={[
            { id: "local", label: "Current checkout", detail: workspaceMode === "local" && folderPath ? formatProjectRoot(folderPath, { home: window.capsule.homeDir }) : "Share the current checkout." },
            { id: "worktree", label: "Worktree", detail: "Use an isolated branch and folder for this conversation." },
            { id: "folder", label: "Change folder…", detail: "Choose a working folder on this computer." },
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
        {git?.isRepo && projectId && session?.workspaceMode === "worktree" && session.worktreeBranch && api.isDesktop !== false ? (
          <span className="worktree-base-slot" title="The branch this worktree starts from. It can change until the first message.">
            <span className="worktree-base-from">from</span>
            <WorktreeBasePicker projectId={projectId} value={session.worktreeBaseRef} onChange={(ref) => workspace.setWorktreeBase(ref)} />
          </span>
        ) : null}
        <RunOnControl runOn={runOn} />
        {!git?.isRepo && session?.workspaceMode === "worktree" && session.worktreeBranch && (
          <span className="workspace-mode-label">Isolated · {session.worktreeBranch}</span>
        )}
        <span className="composer-context-end">
          {git?.isRepo && git.branches.length > 0 && (
            <span className="inline-icon composer-branch">
              <GitBranchIcon size={12} />
              <MenuSelect
                ariaLabel="Branch"
                value={git.branch ?? git.branches[0] ?? ""}
                options={[...git.branches, ...(git.remoteBranches ?? [])].map((item) => ({ id: item, label: item }))}
                onChange={(id) => void checkoutBranch(id)}
              />
            </span>
          )}
          {hasPermissions && !runOn.active && permissionsMenu("composer-context-permissions")}
        </span>
        </>}
        {/* A started conversation keeps its branch in view; the count of changes opens Review. */}
        {!newThread && git?.isRepo && git.branch && (
          <span className="composer-context-end">
            {session?.workspaceMode === "worktree" && <span className="workspace-mode-label">Worktree</span>}
            <button type="button" className="composer-branch-status" title={git.dirty ? `${git.changed} changed ${git.changed === 1 ? "file" : "files"} on ${git.branch} · Open Review` : `${git.branch} · Open Review`}
              onClick={() => { workspace.setInspectorTab("changes"); workspace.setInspectorOpen(true); }}>
              <GitBranchIcon size={12} />
              <span className="composer-branch-name">{git.branch}</span>
              {git.dirty && git.changed > 0 ? <span className="composer-branch-changes">{git.changed} changed</span> : null}
            </button>
          </span>
        )}
        <StatusLine />
      </div>
      {/* Always mounted so its fade plays both ways; the status line beside it is what screen readers hear. */}
      <div className="composer-dock-activity" aria-hidden>
        <span className="dot on live" />
        <span className="shimmer-text">
          Sending…
          <span className="shimmer-overlay" aria-hidden>Sending…</span>
        </span>
      </div>
      <span className="sr-only" role="status">{busy ? "Sending…" : ""}</span>
    </div>
  );
}
