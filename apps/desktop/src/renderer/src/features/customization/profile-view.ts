import { approvalPreset, type McpServerStatus, type ProfileSummary } from "@capsule/shared";

/** What a profile starts, in one line: agent, model, effort, permission and workspace. */
export function profileLine(profile: ProfileSummary, agents: ReadonlyArray<{ id: string; name: string }>): string {
  const agent = profile.agent ? agents.find((item) => item.id === profile.agent)?.name ?? profile.agent : undefined;
  return [
    agent,
    profile.model,
    profile.effort && `${profile.effort} effort`,
    profile.permission && `${approvalPreset(profile.permission).label} approvals`,
    profile.workspace === "worktree" && "worktree",
  ].filter(Boolean).join(" · ") || "Your default agent";
}

/** A server's state for the next direct conversation, in words. */
export function mcpStatusText(status: McpServerStatus): string {
  switch (status.state) {
    case "offered": return "Offered to direct conversations";
    case "needs-env": return `Waiting for ${status.missing.map((name) => `\${env:${name}}`).join(", ")}`;
    case "off": return status.detail.replace(/\.$/, "");
  }
}

/** A test's duration: milliseconds under a second. */
export function testDuration(ms: number): string {
  return ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`;
}

