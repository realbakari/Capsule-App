import {
  createId,
  nowIso,
  type PolicyDecision,
  type PolicyDecisionKind,
  type PolicyRule,
  type SandboxMode,
  type WebAccess,
} from "@capsule/shared";

export const DEFAULT_POLICIES: PolicyRule[] = [
  {
    id: "fs-read",
    scope: "workspace",
    resource: "filesystem",
    action: "read",
    decision: "allow",
  },
  {
    id: "fs-write",
    scope: "workspace",
    resource: "filesystem",
    action: "write",
    decision: "approval",
  },
  {
    id: "fs-delete",
    scope: "workspace",
    resource: "filesystem",
    action: "delete",
    decision: "block",
  },
  {
    id: "term-exec",
    scope: "workspace",
    resource: "terminal",
    action: "execute",
    decision: "approval",
  },
  {
    id: "net-https",
    scope: "workspace",
    resource: "network",
    action: "https",
    decision: "allow",
  },
];

export function policiesFromSettings(input: {
  webAccess: WebAccess;
  sandbox: SandboxMode;
}): PolicyRule[] {
  return [
    {
      id: "net-https",
      scope: "workspace",
      resource: "network",
      action: "https",
      decision: input.webAccess === "off" ? "block" : input.webAccess === "ask" ? "approval" : "allow",
    },
    {
      id: "term-exec",
      scope: "workspace",
      resource: "terminal",
      action: "execute",
      decision: input.sandbox === "off" ? "allow" : input.sandbox === "strict" ? "block" : "approval",
    },
  ];
}

export function decidePolicy(
  rules: PolicyRule[],
  resource: PolicyRule["resource"],
  action: string,
): PolicyRule {
  const match = rules.find((rule) => rule.resource === resource && rule.action === action);
  return (
    match ?? {
      id: "implicit-allow",
      scope: "workspace",
      resource,
      action,
      decision: "allow",
    }
  );
}

export function recordDecision(
  runId: string,
  rule: PolicyRule,
  target: string,
  reason: string,
  override?: PolicyDecisionKind,
): PolicyDecision {
  return {
    id: createId("pdec"),
    runId,
    ruleId: rule.id,
    resource: rule.resource,
    action: rule.action,
    target,
    decision: override ?? rule.decision,
    reason,
    createdAt: nowIso(),
  };
}

export function isDestructivePath(target: string): boolean {
  const normalized = target.replace(/\\/g, "/").toLowerCase();
  return (
    normalized.includes("/.ssh/") ||
    normalized.endsWith("/.ssh") ||
    normalized.includes("/library/keychains/") ||
    normalized.endsWith(".pem") ||
    normalized.endsWith(".key")
  );
}
