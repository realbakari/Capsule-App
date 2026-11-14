import type { AcpConfigOption } from "@capsule/shared";
import { object } from "./transport.js";

export interface ModelSettings {
  efforts: AcpConfigOption["choices"];
  defaultEffort?: string;
}

/** Values come from model/list, never from a product-wide model/effort table. */
export function readModelSettings(value: unknown): ModelSettings {
  const row = object(value);
  const efforts: ModelSettings["efforts"] = [];
  for (const candidate of Array.isArray(row.supportedReasoningEfforts) ? row.supportedReasoningEfforts.slice(0, 32) : []) {
    const choice = object(candidate);
    if (typeof choice.reasoningEffort !== "string" || !/^[a-z-]{1,32}$/.test(choice.reasoningEffort)) continue;
    efforts.push({ value: choice.reasoningEffort, name: choice.reasoningEffort === "xhigh" ? "Extra high" : choice.reasoningEffort.charAt(0).toUpperCase() + choice.reasoningEffort.slice(1),
      description: typeof choice.description === "string" ? choice.description.slice(0, 256) : undefined });
  }
  return { efforts, defaultEffort: typeof row.defaultReasoningEffort === "string" && efforts.some((choice) => choice.value === row.defaultReasoningEffort) ? row.defaultReasoningEffort : undefined };
}

export type NativePermissions = "supervised" | "full-access";
export function permissionOption(value: NativePermissions): AcpConfigOption {
  return { id: "permissions", category: "permissions", name: "Permissions", currentValue: value,
    description: "Applies to the next turn in this conversation.", choices: [
      { value: "supervised", name: "Supervised", description: "Read-only sandbox. Ask before actions that need approval." },
      { value: "full-access", name: "Full access", description: "Allow commands, network access and file changes without approval prompts." },
    ] };
}

export function turnPermissions(value: NativePermissions) {
  return value === "full-access"
    ? { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "dangerFullAccess" } }
    : { approvalPolicy: "untrusted", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } };
}

/** Capsule's Plan/Act switch. Codex's own collaboration mode is experimental, so a plan turn runs read-only. */
export type CodexTurnMode = "default" | "plan";
export function modeOption(value: CodexTurnMode): AcpConfigOption {
  return { id: "mode", category: "mode", name: "Mode", currentValue: value, choices: [
    { value: "default", name: "Act", description: "Work with this conversation's permissions." },
    { value: "plan", name: "Plan", description: "Read-only sandbox without approval prompts; reply with a plan." },
  ] };
}

/** A plan turn cannot change files and never stops to ask: what it cannot do, it reports in the plan. */
export const PLAN_TURN_PERMISSIONS = { approvalPolicy: "never", approvalsReviewer: "user", sandboxPolicy: { type: "readOnly", networkAccess: false } } as const;
