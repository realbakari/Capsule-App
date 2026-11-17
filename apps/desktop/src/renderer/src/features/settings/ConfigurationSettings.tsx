import { APPROVAL_PRESETS, approvalPreset, LONG_COMMAND_SECONDS } from "@capsule/shared";
import type {
  ArchiveInactiveAfter,
  CapsuleSettings,
  OutputDetail,
  PrMergeMethod,
  PrReviewDelivery,
  ReasoningSummary,
  SandboxMode,
  WebAccess,
} from "@capsule/shared";
import type { ReactNode } from "react";
import { useWorkspace } from "../../lib/workspace";
import { AdvancedRows, SettingRow, Switch } from "./controls";
import { PetControl } from "../pet/PetControl";

const WEB_OPTIONS: Array<{ id: WebAccess; label: string }> = [
  { id: "on", label: "On" },
  { id: "ask", label: "Ask first" },
  { id: "off", label: "Off" },
];

const SANDBOX_OPTIONS: Array<{ id: SandboxMode; label: string }> = [
  { id: "ask", label: "Ask first" },
  { id: "off", label: "Off" },
  { id: "strict", label: "Strict" },
];

const OUTPUT_OPTIONS: Array<{ id: OutputDetail; label: string }> = [
  { id: "concise", label: "Concise" },
  { id: "standard", label: "Standard" },
  { id: "verbose", label: "Verbose" },
];

const REASONING_OPTIONS: Array<{ id: ReasoningSummary; label: string }> = [
  { id: "visible", label: "Shown" },
  { id: "collapsed", label: "Folded" },
  { id: "hidden", label: "Hidden" },
];

const ARCHIVE_OPTIONS: Array<{ id: ArchiveInactiveAfter; label: string }> = [
  { id: "never", label: "Never" },
  { id: "1d", label: "After 1 day" },
  { id: "7d", label: "After 7 days" },
  { id: "30d", label: "After 30 days" },
];
const MERGE_OPTIONS: Array<{ id: PrMergeMethod; label: string }> = [
  { id: "squash", label: "Squash" },
  { id: "merge", label: "Merge commit" },
  { id: "rebase", label: "Rebase" },
];
const REVIEW_OPTIONS: Array<{ id: PrReviewDelivery; label: string }> = [
  { id: "current", label: "This conversation" },
  { id: "new-chat", label: "A new conversation" },
];

interface SectionProps {
  settings: CapsuleSettings;
  onPatch: (next: Partial<CapsuleSettings>) => void;
}

function Choice<T extends string>({ value, options, label, onChange, disabled }: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  label: string;
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <select className="field-select" aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value as T)}>
      {options.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>
  );
}

/** A text setting saved when the field loses focus, so typing does not write the file on every key. */
function TextSetting({ value, placeholder, label, multiline, onSave }: {
  value: string;
  placeholder: string;
  label: string;
  multiline?: boolean;
  onSave: (next: string) => void;
}) {
  if (multiline) {
    return <textarea className="field-select" aria-label={label} key={value} defaultValue={value} placeholder={placeholder} rows={3} onBlur={(event) => onSave(event.target.value)} />;
  }
  return (
    <input
      className="field-select"
      aria-label={label}
      key={value}
      defaultValue={value}
      placeholder={placeholder}
      spellCheck={false}
      onBlur={(event) => onSave(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/** What a new conversation starts with. Each of these can be changed per conversation in the composer. */
export function NewConversationsCard({ settings, onPatch, agents, routeRow }: SectionProps & {
  agents: Array<{ id: string; name: string }>;
  /** Where agents run, folded under Advanced because only Gateway users change it. */
  routeRow: ReactNode;
}) {
  return (
    <div className="card">
      <h3>New conversations</h3>
      <SettingRow label="Default agent" setting="defaultAgentId" hint="Selected when you start a conversation.">
        <Choice
          label="Default agent"
          value={settings.defaultAgentId ?? "general"}
          options={agents.map((agent) => ({ id: agent.id, label: agent.name }))}
          onChange={(defaultAgentId) => onPatch({ defaultAgentId })}
        />
      </SettingRow>
      <SettingRow label="Workspace" setting="defaultWorkspaceMode" hint="Where a conversation in a Git project starts. A worktree gets its own branch and folder.">
        <Choice
          label="Workspace"
          value={settings.defaultWorkspaceMode}
          options={[{ id: "local", label: "Current checkout" }, { id: "worktree", label: "New worktree" }]}
          onChange={(defaultWorkspaceMode) => onPatch({ defaultWorkspaceMode })}
        />
      </SettingRow>
      <SettingRow label="Permissions" setting="defaultPermission" hint={approvalPreset(settings.defaultPermission).summary}>
        <Choice
          label="Permissions"
          value={approvalPreset(settings.defaultPermission).id}
          options={APPROVAL_PRESETS}
          onChange={(defaultPermission) => onPatch({ defaultPermission: defaultPermission as CapsuleSettings["defaultPermission"] })}
        />
      </SettingRow>
      <SettingRow label="Web search" setting="webAccess" hint="Whether agents may search and read the public web.">
        <Choice label="Web search" value={settings.webAccess} options={WEB_OPTIONS} onChange={(webAccess) => onPatch({ webAccess })} />
      </SettingRow>
      <AdvancedRows>
        <SettingRow label="Sandbox" setting="sandbox" hint="How freely agents may run commands on this computer. Strict also blocks the project terminal.">
          <Choice label="Sandbox" value={settings.sandbox} options={SANDBOX_OPTIONS} onChange={(sandbox) => onPatch({ sandbox })} />
        </SettingRow>
        {routeRow}
      </AdvancedRows>
    </div>
  );
}

export function RepliesCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Replies</h3>
      <SettingRow label="Thinking" setting="reasoningSummary" hint="How the agent's thinking shows while a turn runs.">
        <Choice label="Thinking" value={settings.reasoningSummary} options={REASONING_OPTIONS} onChange={(reasoningSummary) => onPatch({ reasoningSummary })} />
      </SettingRow>
      <AdvancedRows>
        <SettingRow label="Output detail" setting="outputDetail" hint="How much the agent writes when no response style is chosen. A response style replaces it.">
          <Choice label="Output detail" value={settings.outputDetail} options={OUTPUT_OPTIONS} onChange={(outputDetail) => onPatch({ outputDetail })} />
        </SettingRow>
      </AdvancedRows>
    </div>
  );
}

/*
 * Presets over the switches under Advanced; nothing new is stored. The preset
 * shown is whichever one the switches match, so changing a switch by hand
 * reads as Custom rather than a preset that no longer describes what happens.
 */
const NOTIFICATION_PRESETS = {
  everything: { label: "Everything", values: { notifyRunComplete: true, notifyApprovals: true, notifyLongCommands: true, bounceDockOnAttention: true, dockBadge: true } },
  needed: { label: "When I'm needed", values: { notifyRunComplete: false, notifyApprovals: true, notifyLongCommands: false, bounceDockOnAttention: true, dockBadge: true } },
  app: { label: "Only in the app", values: { notifyRunComplete: false, notifyApprovals: false, notifyLongCommands: false, bounceDockOnAttention: false, dockBadge: false } },
} as const;
type NotificationPreset = keyof typeof NOTIFICATION_PRESETS;

function notificationPreset(settings: SectionProps["settings"]): NotificationPreset | "custom" {
  const match = (Object.keys(NOTIFICATION_PRESETS) as NotificationPreset[]).find((id) =>
    Object.entries(NOTIFICATION_PRESETS[id].values).every(([key, value]) => settings[key as keyof typeof settings] === value));
  return match ?? "custom";
}

export function NotificationsCard({ settings, onPatch }: SectionProps) {
  const preset = notificationPreset(settings);
  return (
    <div className="card">
      <h3>Notifications</h3>
      <SettingRow
        label="Notify me"
        hint="What reaches you while Capsule is in the background. Everything covers finished turns, approvals and long commands. When I'm needed covers only an agent waiting on you. Only in the app shows nothing outside the window."
      >
        <select
          className="field-select"
          aria-label="Notification preset"
          value={preset}
          onChange={(event) => {
            const id = event.target.value as NotificationPreset;
            if (id in NOTIFICATION_PRESETS) void onPatch({ ...NOTIFICATION_PRESETS[id].values });
          }}
        >
          {(Object.keys(NOTIFICATION_PRESETS) as NotificationPreset[]).map((id) => <option key={id} value={id}>{NOTIFICATION_PRESETS[id].label}</option>)}
          {preset === "custom" && <option value="custom" disabled>Custom</option>}
        </select>
      </SettingRow>
      <SettingRow
        label="In-app notifications" setting="inAppNotifications"
        hint="While you are in Capsule, show a toast with Open when another conversation finishes, fails or needs you."
      >
        <Switch checked={settings.inAppNotifications} label="In-app notifications" onChange={(inAppNotifications) => onPatch({ inAppNotifications })} />
      </SettingRow>
      <SettingRow label="Notification sound" setting="notificationSound" hint="Play the system sound with each desktop notification. Focus modes can still silence it.">
        <Switch checked={settings.notificationSound} label="Notification sound" onChange={(notificationSound) => onPatch({ notificationSound })} />
      </SettingRow>
      <AdvancedRows>
        <SettingRow
          label="Finished turns" setting="notifyRunComplete"
          hint="Notify when a turn finishes, fails or hits a usage limit, or a snooze ends, while Capsule is in the background."
        >
          <Switch checked={settings.notifyRunComplete} label="Finished turns" onChange={(notifyRunComplete) => onPatch({ notifyRunComplete })} />
        </SettingRow>
        <SettingRow
          label="Approvals and questions" setting="notifyApprovals"
          hint="Notify when an agent needs approval or asks you something while Capsule is in the background."
        >
          <Switch checked={settings.notifyApprovals} label="Approvals and questions" onChange={(notifyApprovals) => onPatch({ notifyApprovals })} />
        </SettingRow>
        <SettingRow
          label="Long-running commands" setting="notifyLongCommands"
          hint="Notify when a command that ran without asking is still going while Capsule is in the background."
        >
          <div className="setting-inline">
            <select
              className="field-select"
              aria-label="Long-running command threshold"
              value={settings.longCommandSeconds}
              disabled={!settings.notifyLongCommands}
              onChange={(event) => onPatch({ longCommandSeconds: Number(event.target.value) })}
            >
              {LONG_COMMAND_SECONDS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds < 60 ? `After ${seconds} seconds` : `After ${seconds / 60} minute${seconds === 60 ? "" : "s"}`}
                </option>
              ))}
            </select>
            <Switch checked={settings.notifyLongCommands} label="Long-running commands" onChange={(notifyLongCommands) => onPatch({ notifyLongCommands })} />
          </div>
        </SettingRow>
        <SettingRow label="Bounce the Dock icon" setting="bounceDockOnAttention" hint="When a desktop notification goes out. On Windows the taskbar button flashes instead.">
          <Switch checked={settings.bounceDockOnAttention} label="Bounce the Dock icon" onChange={(bounceDockOnAttention) => onPatch({ bounceDockOnAttention })} />
        </SettingRow>
        <SettingRow label="Dock badge" setting="dockBadge" hint="Count the conversations waiting on you: a decision, a failure, or a finished turn you have not read.">
          <Switch checked={settings.dockBadge} label="Dock badge" onChange={(dockBadge) => onPatch({ dockBadge })} />
        </SettingRow>
      </AdvancedRows>
    </div>
  );
}

export function ChatCard({ settings, onPatch }: SectionProps) {
  const sendOnEnter = settings.composerSendKey !== "cmd-enter";
  return (
    <div className="card">
      <h3>Chat</h3>
      <SettingRow
        label="Send key" setting="composerSendKey"
        hint={sendOnEnter
          ? "Enter or ⌘Enter sends. Shift+Enter starts a new line. ⌘⇧Enter sends and starts another conversation."
          : "⌘Enter sends. Enter starts a new line. ⌘⇧Enter sends and starts another conversation."}
      >
        <Choice
          label="Send key"
          value={settings.composerSendKey}
          options={[{ id: "enter", label: "Enter" }, { id: "cmd-enter", label: "⌘Enter" }]}
          onChange={(composerSendKey) => onPatch({ composerSendKey })}
        />
      </SettingRow>
      <SettingRow
        label="Follow-ups" setting="followUpBehavior"
        hint="What a message sent while the agent works does. Messages with attachments or skills always queue."
      >
        <Choice
          label="Follow-ups"
          value={settings.followUpBehavior}
          options={[{ id: "queue", label: "Queue for after the turn" }, { id: "steer", label: "Steer the running turn" }]}
          onChange={(followUpBehavior) => onPatch({ followUpBehavior })}
        />
      </SettingRow>
    </div>
  );
}

export function ConversationsCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Conversations</h3>
      <SettingRow label="Resume after usage limits" setting="autoResumeOnLimit" hint="When a provider's usage limit stops a turn and says when it resets, send the prompt again then. Off asks each time.">
        <Switch checked={settings.autoResumeOnLimit} label="Resume after usage limits" onChange={(autoResumeOnLimit) => onPatch({ autoResumeOnLimit })} />
      </SettingRow>
      <SettingRow label="Continue after a restart" setting="continueAfterRestart" hint="If Capsule quits during a turn, queue its prompt again when Capsule reopens. Turns on a Gateway are left alone, since the Gateway may still be running them.">
        <Switch checked={settings.continueAfterRestart} label="Continue after a restart" onChange={(continueAfterRestart) => onPatch({ continueAfterRestart })} />
      </SettingRow>
      <SettingRow label="Archive inactive conversations" setting="archiveInactiveAfter" hint="Running and pinned conversations are never archived.">
        <Choice label="Archive inactive conversations" value={settings.archiveInactiveAfter} options={ARCHIVE_OPTIONS} onChange={(archiveInactiveAfter) => onPatch({ archiveInactiveAfter })} />
      </SettingRow>
      <SettingRow label="Mark blocked or done" setting="autoClassifySessions" hint="Set a conversation's status from how its latest turn ended. Conversations with a live agent session stay unmarked.">
        <Switch checked={settings.autoClassifySessions} label="Mark blocked or done" onChange={(autoClassifySessions) => onPatch({ autoClassifySessions })} />
      </SettingRow>
    </div>
  );
}

export function ConfirmationsCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Confirmations</h3>
      <SettingRow label="Confirm before deleting" setting="confirmDelete" hint="Ask before deleting a conversation. Deleting a project always asks.">
        <Switch checked={settings.confirmDelete} label="Confirm before deleting" onChange={(confirmDelete) => onPatch({ confirmDelete })} />
      </SettingRow>
      <SettingRow label="Confirm before archiving" setting="confirmArchive" hint="Ask before archiving a conversation. Without it, Archive offers Undo for a few seconds.">
        <Switch checked={settings.confirmArchive} label="Confirm before archiving" onChange={(confirmArchive) => onPatch({ confirmArchive })} />
      </SettingRow>
    </div>
  );
}

export function DesktopCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>System</h3>
      <SettingRow label="Launch at login" setting="launchAtLogin" hint="Open Capsule when you sign in to this computer. Needs the installed app.">
        <Switch checked={settings.launchAtLogin} label="Launch at login" onChange={(launchAtLogin) => onPatch({ launchAtLogin })} />
      </SettingRow>
      <SettingRow label="Menu bar" setting="showMenuBarExtra" hint="Show Capsule in the menu bar, with approvals and running turns.">
        <Switch checked={settings.showMenuBarExtra} label="Menu bar" onChange={(showMenuBarExtra) => onPatch({ showMenuBarExtra })} />
      </SettingRow>
      <SettingRow label="Keep computer awake" setting="keepAwakeWhileRunning" hint="Stop the computer from sleeping while an agent works. The display can still turn off.">
        <Switch checked={settings.keepAwakeWhileRunning} label="Keep computer awake" onChange={(keepAwakeWhileRunning) => onPatch({ keepAwakeWhileRunning })} />
      </SettingRow>
      <SettingRow label="Download updates automatically" setting="autoDownloadUpdates" hint="Capsule restarts to install only when you ask, after running work finishes.">
        <Switch checked={settings.autoDownloadUpdates} label="Download updates automatically" onChange={(autoDownloadUpdates) => onPatch({ autoDownloadUpdates })} />
      </SettingRow>
      <AdvancedRows>
        <SettingRow label="Desktop companion" hint="A small capsule on the desktop that shows activity across projects. Click it to open conversations.">
          <PetControl />
        </SettingRow>
        <SettingRow label="Agent simulator access" setting="agentSimulatorAccess" hint="Let an agent on this computer see and drive the iOS Simulator attached in a conversation's Simulator panel.">
          <Switch checked={settings.agentSimulatorAccess} label="Agent simulator access" onChange={(agentSimulatorAccess) => onPatch({ agentSimulatorAccess })} />
        </SettingRow>
      </AdvancedRows>
    </div>
  );
}

/*
 * Capsule cannot hand an API key to an agent the Gateway starts: the agent
 * reads the Gateway's environment. This says where to put one instead.
 */
export function GatewayApiKeysRow() {
  return (
    <SettingRow
      label="API keys"
      stacked
      hint="Agents on a Gateway read keys from the Gateway's environment, not from Capsule. Their own sign-in works without one. A Gateway installed as a service does not read your shell, so set keys where it starts."
    >
      <pre className="mono settings-snippet">OPENAI_API_KEY=… ANTHROPIC_API_KEY=… openclaw gateway run</pre>
    </SettingRow>
  );
}

export function SkillCatalogCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Skill catalog</h3>
      <SettingRow
        label="skills.sh token"
        hint="Optional. Adds install counts to the catalog. The token expires about every 12 hours. Without one, the catalog reads skills from GitHub."
      >
        <input
          className="field-select"
          type="password"
          aria-label="skills.sh token"
          autoComplete="off"
          spellCheck={false}
          key={settings.skillsShToken ?? ""}
          defaultValue=""
          placeholder={settings.skillsShToken ? "Stored in Keychain" : "Optional"}
          onBlur={(event) => {
            const next = event.target.value.trim();
            if (next) onPatch({ skillsShToken: next });
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </SettingRow>
      {settings.skillsShToken && (
        <div className="setting-inline">
          <span className="faint">A skills.sh token is saved in the Keychain.</span>
          <button type="button" className="ghost" onClick={() => onPatch({ skillsShToken: "" })}>
            Clear token
          </button>
        </div>
      )}
    </div>
  );
}

/** Diffs, pull requests, then commits and branches: three sections, the order someone reviewing work meets them. */
export function GitCard({ settings, onPatch }: SectionProps) {
  return (
    <>
      <div className="card">
        <h3>Diffs</h3>
        <SettingRow label="Diff layout" setting="diffLayout" hint="For Review and pull request diffs. Diffs inside a conversation stay one column.">
          <Choice label="Diff layout" value={settings.diffLayout} options={[{ id: "split", label: "Side by side" }, { id: "unified", label: "One column" }]} onChange={(diffLayout) => onPatch({ diffLayout })} />
        </SettingRow>
        <SettingRow label="Diff files" setting="diffFileState" hint="Whether each changed file starts open or folded.">
          <Choice label="Diff files" value={settings.diffFileState} options={[{ id: "expanded", label: "Open" }, { id: "collapsed", label: "Folded" }]} onChange={(diffFileState) => onPatch({ diffFileState })} />
        </SettingRow>
        <SettingRow label="Ignore whitespace" setting="diffIgnoreWhitespace" hint="Review starts with whitespace-only changes hidden. The Review header can switch it per conversation.">
          <Switch checked={settings.diffIgnoreWhitespace} label="Ignore whitespace in Review" onChange={(diffIgnoreWhitespace) => onPatch({ diffIgnoreWhitespace })} />
        </SettingRow>
      </div>
      <div className="card">
        <h3>Pull requests</h3>
        <p className="muted">Uses the GitHub CLI (<span className="mono">gh</span>) when it is installed and signed in.</p>
        <SettingRow label="Create draft pull requests" setting="prDraft" hint="Open pull requests as drafts.">
          <Switch checked={settings.prDraft} label="Create draft pull requests" onChange={(prDraft) => onPatch({ prDraft })} />
        </SettingRow>
        <SettingRow label="Pull request merge method" setting="prMergeMethod" hint="Used when Capsule merges a pull request.">
          <Choice label="Pull request merge method" value={settings.prMergeMethod} options={MERGE_OPTIONS} onChange={(prMergeMethod) => onPatch({ prMergeMethod })} />
        </SettingRow>
        <SettingRow label="Watch and fix pull requests" setting="prWatchAndFix" hint="When checks fail, ask the agent to fix them and push.">
          <Switch checked={settings.prWatchAndFix} label="Watch and fix pull requests" onChange={(prWatchAndFix) => onPatch({ prWatchAndFix })} />
        </SettingRow>
        <SettingRow label="Send check fixes to" setting="prReviewDelivery" hint="Where the prompt to fix failing checks goes.">
          <Choice label="Send check fixes to" value={settings.prReviewDelivery} options={REVIEW_OPTIONS} onChange={(prReviewDelivery) => onPatch({ prReviewDelivery })} />
        </SettingRow>
        <SettingRow label="Auto-merge when ready" setting="prAutoMerge" hint="Turn on GitHub auto-merge after opening a pull request, so it merges when checks pass.">
          <Switch checked={settings.prAutoMerge} label="Auto-merge when ready" onChange={(prAutoMerge) => onPatch({ prAutoMerge })} />
        </SettingRow>
        <SettingRow label="Settle merged conversations" setting="autoSettleMerged" hint="When a watched pull request merges, settle the conversation that opened it. A new message brings it back.">
          <Switch checked={settings.autoSettleMerged} label="Settle merged conversations" onChange={(autoSettleMerged) => onPatch({ autoSettleMerged })} />
        </SettingRow>
        <AdvancedRows>
          <SettingRow label="Continue watching until merged" setting="prWatchUntilMerged" hint="Keep checking an open pull request until it is merged or closed.">
            <Switch checked={settings.prWatchUntilMerged} label="Continue watching until merged" onChange={(prWatchUntilMerged) => onPatch({ prWatchUntilMerged })} />
          </SettingRow>
          <SettingRow label="Pull request instructions" setting="prInstructions" hint="Added when the agent writes a pull request title and description." stacked>
            <TextSetting multiline label="Pull request instructions" value={settings.prInstructions ?? ""} placeholder="Add pull request guidance…" onSave={(prInstructions) => onPatch({ prInstructions })} />
          </SettingRow>
        </AdvancedRows>
      </div>
      <div className="card">
        <h3>Commits and branches</h3>
        <SettingRow label="Branch prefix" setting="branchPrefix" hint="Put before the name of each new branch, as in capsule/fix-login. Leave empty for no prefix.">
          <TextSetting label="Branch prefix" value={settings.branchPrefix ?? ""} placeholder="capsule" onSave={(branchPrefix) => onPatch({ branchPrefix })} />
        </SettingRow>
        <SettingRow label="Force push with lease" setting="gitForceWithLease" hint="Push with --force-with-lease, so a rewritten branch updates the remote without overwriting commits you have not seen.">
          <Switch checked={settings.gitForceWithLease} label="Force push with lease" onChange={(gitForceWithLease) => onPatch({ gitForceWithLease })} />
        </SettingRow>
        <AdvancedRows>
          <SettingRow label="Commit instructions" setting="commitInstructions" hint="Added when the agent writes a commit message." stacked>
            <TextSetting multiline label="Commit instructions" value={settings.commitInstructions ?? ""} placeholder="Add commit message guidance…" onSave={(commitInstructions) => onPatch({ commitInstructions })} />
          </SettingRow>
        </AdvancedRows>
      </div>
    </>
  );
}

/*
 * A pointer, not a second list. Agents already renders every agent with its
 * readiness, path and Doctor; listing them again here gave two places for them
 * to disagree.
 */
export function HarnessProvidersCard() {
  const { harnesses, setView } = useWorkspace();
  const ready = (harnesses ?? []).filter((harness) => harness.readiness === "ready").length;
  const total = (harnesses ?? []).length;

  return (
    <div className="card">
      <h3>Installed agents</h3>
      <SettingRow label="Agents on this computer" hint={total === 0 ? "No agents detected." : `${ready} of ${total} ready.`}>
        <button type="button" className="ghost" onClick={() => setView("runtimes")}>
          Open Agents
        </button>
      </SettingRow>
      <SettingRow
        label="Agent launch options"
        setting="agentOverrides"
        hint="Turn an agent off, or give it its own binary, arguments or environment, such as a config folder for a second account. Each agent's detail in Agents has them."
      >
        <button type="button" className="ghost" onClick={() => setView("runtimes")}>
          Edit in Agents
        </button>
      </SettingRow>
    </div>
  );
}
