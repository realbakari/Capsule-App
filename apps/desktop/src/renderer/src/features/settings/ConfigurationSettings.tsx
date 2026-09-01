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
import { PERMISSION_OPTIONS } from "../../lib/workspace";
import { SettingRow, Switch } from "./controls";

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
  { id: "visible", label: "Visible" },
  { id: "collapsed", label: "Collapsed" },
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
  { id: "current", label: "Current chat" },
  { id: "new-chat", label: "New chat" },
];

/*
 * These cards used to render together under a tab called "Configuration",
 * which had become a drawer: agent defaults, notifications, desktop launch,
 * session archiving, harness credentials, the skill catalog and Git, none of
 * which belong together. Each is exported on its own so Settings can file it
 * under the section a user would look in.
 */
interface SectionProps {
  settings: CapsuleSettings;
  onPatch: (next: Partial<CapsuleSettings>) => void;
}


export function AgentDefaultsCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Agent defaults</h3>
      <p className="muted">
        Permissions, web access, and how much detail new conversations ask for. ACP cannot show a
        permission dialog — the Gateway plugin is the real switch.
      </p>
      <SettingRow
        label="Approval policy"
        hint="Standard and Full access use Gateway approve-all so coding can write and fetch. Supervised refuses those tools instead of asking. Capsule Approvals only appear if OpenClaw forwards a permission request."
      >
        <select
          className="field-select"
          value={settings.defaultPermission}
          onChange={(event) =>
            onPatch({
              defaultPermission: event.target.value as CapsuleSettings["defaultPermission"],
            })
          }
        >
          {PERMISSION_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Sandbox"
        hint="How much local command access Capsule grants. Strict blocks the project terminal."
      >
        <select
          className="field-select"
          value={settings.sandbox}
          onChange={(event) => onPatch({ sandbox: event.target.value as SandboxMode })}
        >
          {SANDBOX_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Web search"
        hint="Whether agents may use the public web. Off is written into the run contract."
      >
        <select
          className="field-select"
          value={settings.webAccess}
          onChange={(event) => onPatch({ webAccess: event.target.value as WebAccess })}
        >
          {WEB_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Output detail"
        hint="How much detail the agent should include in replies."
      >
        <select
          className="field-select"
          value={settings.outputDetail}
          onChange={(event) => onPatch({ outputDetail: event.target.value as OutputDetail })}
        >
          {OUTPUT_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Reasoning summary"
        hint="How thinking frames appear while a run is in progress."
      >
        <select
          className="field-select"
          value={settings.reasoningSummary}
          onChange={(event) =>
            onPatch({ reasoningSummary: event.target.value as ReasoningSummary })
          }
        >
          {REASONING_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
    </div>
  );
}

export function NotificationsCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Notifications</h3>
      <SettingRow
        label="Response completions"
        hint="Notify when a run finishes and Capsule is in the background."
      >
        <Switch
          checked={settings.notifyRunComplete}
          label="Response completions"
          onChange={(notifyRunComplete) => onPatch({ notifyRunComplete })}
        />
      </SettingRow>
      <SettingRow
        label="Approval requests"
        hint="Notify when an agent needs approval to run a command."
      >
        <Switch
          checked={settings.notifyApprovals}
          label="Approval requests"
          onChange={(notifyApprovals) => onPatch({ notifyApprovals })}
        />
      </SettingRow>
      <SettingRow
        label="Draw attention"
        hint="Bounce the Dock icon when Capsule needs you and the window is not focused."
      >
        <Switch
          checked={settings.bounceDockOnAttention}
          label="Draw attention"
          onChange={(bounceDockOnAttention) => onPatch({ bounceDockOnAttention })}
        />
      </SettingRow>
    </div>
  );
}

export function DesktopCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Desktop</h3>
      <SettingRow
        label="Menu bar"
        hint="Show Capsule in the menu bar for Open, Settings, Approvals, and active runs."
      >
        <Switch
          checked={settings.showMenuBarExtra}
          label="Menu bar"
          onChange={(showMenuBarExtra) => onPatch({ showMenuBarExtra })}
        />
      </SettingRow>
      <SettingRow
        label="Keep computer awake"
        hint="Prevent idle sleep while a run or live harness is active. The display can still turn off."
      >
        <Switch
          checked={settings.keepAwakeWhileRunning}
          label="Keep computer awake"
          onChange={(keepAwakeWhileRunning) => onPatch({ keepAwakeWhileRunning })}
        />
      </SettingRow>
    </div>
  );
}

export function SessionsCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Sessions</h3>
      <SettingRow
        label="Classify session states"
        hint="Mark threads as blocked or done from the latest run. Live harness sessions stay unmarked."
      >
        <Switch
          checked={settings.autoClassifySessions}
          label="Classify session states"
          onChange={(autoClassifySessions) => onPatch({ autoClassifySessions })}
        />
      </SettingRow>
      <SettingRow
        label="Archive inactive sessions"
        hint="Automatically archive idle local threads. Running work and pinned threads are never archived."
      >
        <select
          className="field-select"
          value={settings.archiveInactiveAfter}
          onChange={(event) =>
            onPatch({ archiveInactiveAfter: event.target.value as ArchiveInactiveAfter })
          }
        >
          {ARCHIVE_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
    </div>
  );
}

export function HarnessCredentialsCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Harness credentials</h3>
      <p className="muted">
        Capsule connects to a Gateway that is already running; the Gateway is what launches
        Claude Code and Codex. Their credentials therefore come from the Gateway&rsquo;s
        environment, and Capsule has nowhere to put an API key that would reach them. Both CLIs
        also work with the subscription login you already have — a key is only needed to bill
        through the API instead.
      </p>
      <div className="setting-copy">
        <p>
          Codex reads <span className="mono">CODEX_API_KEY</span> or{" "}
          <span className="mono">OPENAI_API_KEY</span>; Claude Code reads{" "}
          <span className="mono">ANTHROPIC_API_KEY</span>. Set them where the Gateway starts:
        </p>
        <pre className="mono settings-snippet">
          OPENAI_API_KEY=… ANTHROPIC_API_KEY=… openclaw gateway run
        </pre>
        <p>
          A Gateway installed as a service does not inherit your shell, so exporting a variable in
          a terminal will not reach it — it sources its own generated env file, which OpenClaw
          asks you not to hand-edit while the service is installed.
        </p>
      </div>
    </div>
  );
}

export function SkillCatalogCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Skill catalog</h3>
      <p className="muted">
        The directory reads skills straight from their GitHub repositories, which needs no
        account. skills.sh is optional and adds install counts.
      </p>
      <SettingRow
        label="skills.sh token"
        hint="Every skills.sh endpoint returns 401 without a Vercel OIDC token, and that token expires roughly every 12 hours. Leave this empty to browse GitHub only."
      >
        <input
          className="field-select"
          type="password"
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

export function GitCard({ settings, onPatch }: SectionProps) {
  return (
    <div className="card">
      <h3>Git</h3>
      <p className="muted">
        Local git plus the GitHub CLI (<span className="mono">gh</span>) when it is installed and
        signed in. Capsule does not add a second GitHub login.
      </p>
      <SettingRow
        label="Branch prefix"
        hint="Prefixed onto branches created from the inspector, e.g. capsule/fix-login."
      >
        <input
          className="field-select"
          key={settings.branchPrefix ?? ""}
          defaultValue={settings.branchPrefix ?? ""}
          placeholder="capsule"
          spellCheck={false}
          onBlur={(event) => onPatch({ branchPrefix: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
        />
      </SettingRow>
      <SettingRow
        label="Pull request merge method"
        hint="Used when Capsule merges a pull request with gh."
      >
        <select
          className="field-select"
          value={settings.prMergeMethod}
          onChange={(event) => onPatch({ prMergeMethod: event.target.value as PrMergeMethod })}
        >
          {MERGE_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Always force push"
        hint="Use --force-with-lease when pushing from Capsule, never --force."
      >
        <Switch
          checked={settings.gitForceWithLease}
          label="Always force push"
          onChange={(gitForceWithLease) => onPatch({ gitForceWithLease })}
        />
      </SettingRow>
      <SettingRow
        label="Create draft pull requests"
        hint="Open pull requests as drafts by default."
      >
        <Switch
          checked={settings.prDraft}
          label="Create draft pull requests"
          onChange={(prDraft) => onPatch({ prDraft })}
        />
      </SettingRow>
      <SettingRow
        label="Review delivery"
        hint="When checks fail, send the fix prompt in this thread or start a new one."
      >
        <select
          className="field-select"
          value={settings.prReviewDelivery}
          onChange={(event) =>
            onPatch({ prReviewDelivery: event.target.value as PrReviewDelivery })
          }
        >
          {REVIEW_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow
        label="Watch and fix pull requests"
        hint="If CI fails, Capsule asks the agent to fix and push. Requires gh."
      >
        <Switch
          checked={settings.prWatchAndFix}
          label="Watch and fix pull requests"
          onChange={(prWatchAndFix) => onPatch({ prWatchAndFix })}
        />
      </SettingRow>
      <SettingRow
        label="Auto-merge when ready"
        hint="Queue GitHub auto-merge after opening a PR, and merge when checks pass."
      >
        <Switch
          checked={settings.prAutoMerge}
          label="Auto-merge when ready"
          onChange={(prAutoMerge) => onPatch({ prAutoMerge })}
        />
      </SettingRow>
      <SettingRow
        label="Continue watching until merged"
        hint="Keep polling the open pull request until GitHub reports it merged or closed."
      >
        <Switch
          checked={settings.prWatchUntilMerged}
          label="Continue watching until merged"
          onChange={(prWatchUntilMerged) => onPatch({ prWatchUntilMerged })}
        />
      </SettingRow>
      <SettingRow
        label="Commit instructions"
        hint="Added to agent prompts when writing commit messages."
        stacked
      >
        <textarea
          className="field-select"
          key={settings.commitInstructions ?? ""}
          defaultValue={settings.commitInstructions ?? ""}
          placeholder="Add commit message guidance…"
          rows={3}
          onBlur={(event) => onPatch({ commitInstructions: event.target.value })}
        />
      </SettingRow>
      <SettingRow
        label="Pull request instructions"
        hint="Added to PR title/description generation and to the body Capsule opens with gh."
        stacked
      >
        <textarea
          className="field-select"
          key={settings.prInstructions ?? ""}
          defaultValue={settings.prInstructions ?? ""}
          placeholder="Add pull request guidance…"
          rows={3}
          onBlur={(event) => onPatch({ prInstructions: event.target.value })}
        />
      </SettingRow>
    </div>
  );
}
