import type { HarnessPermissionProfile } from "./harness.js";

/**
 * Ask, Auto and Full: how much an agent may do before a person says yes.
 *
 * The stored ids are the older permission profiles, so threads and settings
 * saved before the rename keep their meaning: "strict" is Ask, "default" is
 * Auto, "approve-all" is Full. Each route carries a preset differently, and
 * `approvalCarrier` says how, in words the composer shows next to the choice.
 */
export interface ApprovalPresetSpec {
  id: HarnessPermissionProfile;
  label: "Ask" | "Auto" | "Full";
  summary: string;
}

export const APPROVAL_PRESETS: readonly ApprovalPresetSpec[] = [
  { id: "strict", label: "Ask", summary: "Every edit and command asks first." },
  { id: "default", label: "Auto", summary: "Reads and edits inside the workspace go ahead. Commands and anything outside it ask." },
  { id: "approve-all", label: "Full", summary: "Nothing asks. The agent edits and runs commands on its own." },
];

export function approvalPreset(profile: string | undefined): ApprovalPresetSpec {
  return APPROVAL_PRESETS.find((preset) => preset.id === profile) ?? APPROVAL_PRESETS[1]!;
}

export function isApprovalPresetId(value: unknown): value is HarnessPermissionProfile {
  return APPROVAL_PRESETS.some((preset) => preset.id === value);
}

export type ApprovalRoute = "direct" | "gateway" | "mock";

/** enforced: the route does what the preset says. approximated: it does something close, named in `detail`. */
export type ApprovalCarry = "enforced" | "approximated" | "not-carried";

export interface ApprovalCarrier {
  carry: ApprovalCarry;
  detail: string;
  /** The agent's own mode that matches this preset, when Capsule knows the agent's mode names. */
  agentMode?: string;
}

/*
 * The agent's own modes that line up with each preset. Direct mode does not
 * switch them: plan mode owns the agent's mode option, and the agent decides
 * what it asks about from that mode. They are named so a person can line the
 * two up in Agent settings.
 */
const AGENT_MODES: Readonly<Record<string, Record<HarnessPermissionProfile, string>>> = {
  claude: { strict: "default", default: "acceptEdits", "approve-all": "bypassPermissions" },
  codex: { strict: "read-only", default: "auto", "approve-all": "full-access" },
};

const GATEWAY: Record<HarnessPermissionProfile, ApprovalCarrier> = {
  strict: { carry: "approximated", detail: "The Gateway cannot ask, so it refuses what needs approval (acpx deny-all)." },
  default: { carry: "approximated", detail: "The Gateway has no middle mode, so commands run without asking too (acpx approve-all)." },
  "approve-all": { carry: "enforced", detail: "The Gateway approves every tool (acpx approve-all)." },
};

export function approvalCarrier(
  profile: string | undefined,
  target: { route: ApprovalRoute; harnessId?: string },
): ApprovalCarrier {
  const preset = approvalPreset(profile).id;
  if (target.route === "mock") {
    return { carry: "not-carried", detail: "The demo runtime asks only when a prompt contains [approval]." };
  }
  if (target.route === "gateway") return GATEWAY[preset];
  const agentMode = target.harnessId ? AGENT_MODES[target.harnessId]?.[preset] : undefined;
  const withMode = (carrier: ApprovalCarrier): ApprovalCarrier => (agentMode ? { ...carrier, agentMode } : carrier);
  if (preset === "approve-all") return withMode({ carry: "enforced", detail: "Capsule allows every request the agent makes." });
  if (target.harnessId === "claude") {
    return withMode({ carry: "enforced", detail: preset === "strict" ? "Capsule shows you every request the agent makes." : "Capsule allows reads and workspace edits the agent asks about and shows you the rest." });
  }
  if (target.harnessId === "codex") {
    return withMode({
      carry: "approximated",
      detail: preset === "strict"
        ? "In its own auto mode Codex still edits workspace files without asking; its read-only mode matches Ask."
        : "In its own auto mode Codex also runs sandboxed commands without asking.",
    });
  }
  return withMode({ carry: "approximated", detail: "The agent's own mode decides what it asks about, so some actions may not reach you." });
}

/** A preset's menu row: what it means, then a caveat only where this route does not carry it exactly. */
export function approvalOptionDetail(profile: string | undefined, target: { route: ApprovalRoute; harnessId?: string }): string {
  const carrier = approvalCarrier(profile, target);
  const summary = approvalPreset(profile).summary;
  if (carrier.carry === "enforced") return carrier.agentMode ? `${summary} Matches the agent's ${carrier.agentMode} mode.` : summary;
  return `${summary} ${carrier.carry === "not-carried" ? "Not carried here: " : ""}${carrier.detail}`;
}

/** What the agent asked to do, as far as a preset needs to know. */
export interface PermissionAsk {
  /** The ACP tool kind: read, edit, delete, move, search, execute, think, fetch, switch_mode, other. */
  kind?: string;
  locations: readonly string[];
}

const READ_KINDS = new Set(["read", "search", "think"]);
const EDIT_KINDS = new Set(["edit", "delete", "move"]);

/**
 * Whether Capsule answers a direct agent's permission request itself or shows
 * it. Only Full allows something it cannot place; Auto needs every location
 * inside the workspace, and an edit with no location asks.
 */
export function directApprovalDecision(
  profile: string | undefined,
  ask: PermissionAsk,
  workspaceRoot: string | undefined,
): "allow" | "ask" {
  const preset = approvalPreset(profile).id;
  if (preset === "approve-all") return "allow";
  if (preset === "strict" || !workspaceRoot || !ask.kind) return "ask";
  const inside = ask.locations.every((location) => isInsideFolder(location, workspaceRoot));
  if (READ_KINDS.has(ask.kind)) return inside ? "allow" : "ask";
  if (EDIT_KINDS.has(ask.kind)) return ask.locations.length > 0 && inside ? "allow" : "ask";
  return "ask";
}

/** POSIX containment after resolving `.` and `..`; a relative path is read against the folder. */
export function isInsideFolder(candidate: string, folder: string): boolean {
  if (!folder.startsWith("/")) return false;
  const root = normalizePath(folder);
  const target = normalizePath(candidate.startsWith("/") ? candidate : `${root}/${candidate}`);
  return target === root || target.startsWith(root === "/" ? "/" : `${root}/`);
}

function normalizePath(value: string): string {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
