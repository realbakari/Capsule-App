import {
  decidePermission,
  describeDecision,
  type EffectiveExtendedConfig,
  type PermissionSubject,
  type SourcedPermissionRule,
} from "@capsule/shared";
import { hookSource, permissionVerdict, type HookPayload, type HookRunner } from "./hooks.js";

/*
 * One place decides an agent's permission request, whichever route it came
 * by: the rules first, then PermissionRequest hooks, then the person. Every
 * automatic answer comes back with the sentence the run's work log shows.
 */

export type PermissionAnswer =
  | { decision: "allow" | "deny"; audit: string }
  /**
   * The person decides. `audit` says why when a rule or hook had a say;
   * `note` is a hook's reason for asking, shown on the approval card.
   */
  | { decision: "ask"; audit?: string; note?: string };

export interface RequestContext {
  /** Where relative path rules resolve: the project folder, or home for a thread without one. */
  root: string;
  /** The project whose files hold hooks; absent for a thread without a folder. */
  projectRoot?: string;
  home: string;
  /** The file system ignores case, so deny and ask path rules do too. */
  caseInsensitivePaths: boolean;
  /** Everything a PermissionRequest hook receives except the request itself. */
  payload: Omit<HookPayload, "event" | "permission">;
}

export function sourcedRules(permissions: EffectiveExtendedConfig["permissions"]): SourcedPermissionRule[] {
  return (["deny", "ask", "allow"] as const).flatMap((list) =>
    permissions[list].map((entry) => ({ list, rule: entry.value, source: entry.source.path ?? entry.source.scope })));
}

/**
 * Deny and allow rules answer at once. An ask rule, or no rule, passes the
 * request to hooks; a hook may deny it, and may allow it only when no ask
 * rule matched, because an ask rule is a person saying they want to decide.
 * The answer is synchronous unless a hook has to run, so a request no hook
 * looks at reaches the person without waiting a tick.
 */
export function decideRequest(
  subject: PermissionSubject,
  config: EffectiveExtendedConfig,
  hooks: HookRunner,
  context: RequestContext,
): PermissionAnswer | Promise<PermissionAnswer> {
  const ruling = decidePermission(sourcedRules(config.permissions), subject, {
    root: context.root,
    home: context.home,
    caseInsensitivePaths: context.caseInsensitivePaths,
  });
  if (ruling.decision === "deny" || ruling.decision === "allow") {
    return { decision: ruling.decision, audit: describeDecision(ruling, context.home) };
  }
  const asked: PermissionAnswer = ruling.decision === "ask" ? { decision: "ask", audit: describeDecision(ruling, context.home) } : { decision: "ask" };
  const targets = [subject.kind, subject.title];
  if (hooks.handlers("PermissionRequest", context.projectRoot, targets).length === 0) return asked;
  return hooks.run("PermissionRequest", {
    ...context.payload,
    event: "PermissionRequest",
    permission: {
      kind: subject.kind,
      title: subject.title,
      ...(subject.command !== undefined ? { command: subject.command } : {}),
      paths: subject.paths,
      ...(subject.url ? { url: subject.url } : {}),
    },
  }, { root: context.projectRoot, targets }).then((results): PermissionAnswer => {
    const verdict = permissionVerdict(results, (source) => hooks.mayAllow(source));
    if (!verdict) return asked;
    const where = `a PermissionRequest hook in ${hookSource(verdict.source, context.home)}`;
    if (verdict.decision === "ask" || (verdict.decision === "allow" && asked.audit)) {
      return { ...asked, ...(verdict.reason ? { note: `${verdict.reason.replace(/\.?$/, ".")} (${where})` } : {}) };
    }
    const verb = verdict.decision === "deny" ? "Denied" : "Allowed";
    return { decision: verdict.decision, audit: `${verb} by ${where}${verdict.reason ? `: ${verdict.reason}` : ""}` };
  });
}
