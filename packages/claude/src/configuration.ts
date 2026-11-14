import type { ModelInfo, PermissionMode } from "@anthropic-ai/claude-agent-sdk";
import type { AcpConfigOption } from "@capsule/shared";

export const CLAUDE_PERMISSIONS = [
  { value: "default", name: "Supervised", description: "Ask before actions that need permission." },
  { value: "acceptEdits", name: "Auto-accept edits", description: "Allow edits; ask before other restricted actions." },
  { value: "bypassPermissions", name: "Full access", description: "Allow tools without permission prompts." },
] satisfies Array<{ value: PermissionMode; name: string; description: string }>;

export function permissionChoices(model: ModelInfo | undefined): AcpConfigOption["choices"] {
  return [...CLAUDE_PERMISSIONS, ...(model?.supportsAutoMode ? [{ value: "auto", name: "Auto", description: "Let the agent classify permission requests." }] : [])];
}

export function isClaudePermission(value: string | boolean): value is "default" | "acceptEdits" | "bypassPermissions" | "auto" {
  return value === "default" || value === "acceptEdits" || value === "bypassPermissions" || value === "auto";
}

export function isClaudeEffort(value: string | boolean): value is "low" | "medium" | "high" | "xhigh" | "max" {
  return value === "low" || value === "medium" || value === "high" || value === "xhigh" || value === "max";
}

/** Capsule's Plan/Act switch, carried by Claude Code's own plan permission mode. */
export type ClaudeTurnMode = "default" | "plan";
export const MODE_CHOICES: AcpConfigOption["choices"] = [
  { value: "default", name: "Act", description: "Work with this conversation's permissions." },
  { value: "plan", name: "Plan", description: "Read and investigate without editing files, then reply with a plan." },
];
export function isClaudeTurnMode(value: string | boolean): value is ClaudeTurnMode {
  return value === "default" || value === "plan";
}
