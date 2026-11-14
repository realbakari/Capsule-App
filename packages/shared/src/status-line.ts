import type { AnsiLine } from "./ansi.js";
import type { StatusLineItem } from "./config.js";

/**
 * What the status line knows about a thread. The window already holds every
 * one of these, so it sends them; main adds the thread, project and folder
 * itself rather than taking them from the window.
 */
export interface StatusLineFacts {
  branch?: string;
  changes?: number;
  context?: { used: number; size: number };
  limits?: { usedPercent: number; resetsAt?: string };
  pr?: { number: number; state: string; draft?: boolean; checks?: "pending" | "success" | "failure" | "none" };
  model?: string;
  harness?: string;
  route?: "direct" | "gateway";
  run?: string;
  cost?: { amount: number; currency: string };
}

export interface StatusLineRequest {
  projectId: string;
  sessionId?: string;
  facts: StatusLineFacts;
}

/** A command's output for one thread, already reduced to styled text. */
export interface StatusLineRender {
  key: string;
  lines: AnsiLine[];
  /** Set when the command failed; the line shows dimmed, saying so. */
  failed?: string;
  at: string;
}

/** The thread a render belongs to, or the project's new-conversation composer. */
export function statusLineKey(projectId: string, sessionId?: string): string {
  return sessionId ?? `project:${projectId}`;
}

export interface StatusLinePart {
  item: StatusLineItem;
  text: string;
  tone?: "warn" | "critical";
  title?: string;
}

function percent(value: number): number {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function clockTime(iso: string): string | undefined {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
}

const PR_CHECKS: Record<string, string> = { pending: "checks running", success: "checks pass", failure: "checks fail" };

/** The no-code status line: each chosen item that has a value, in the chosen order. */
export function statusLineParts(items: readonly StatusLineItem[], facts: StatusLineFacts): StatusLinePart[] {
  const parts: StatusLinePart[] = [];
  for (const item of items) {
    switch (item) {
      case "branch":
        if (facts.branch) parts.push({ item, text: facts.branch, title: `Branch ${facts.branch}` });
        break;
      case "changes":
        if (facts.changes !== undefined) parts.push({ item, text: facts.changes ? `${facts.changes} changed` : "clean", title: "Changed files in the working tree" });
        break;
      case "context":
        if (facts.context && facts.context.size > 0) {
          const fraction = facts.context.used / facts.context.size;
          parts.push({ item, text: `${percent(fraction * 100)}% context`, ...(fraction >= 0.9 ? { tone: "critical" as const } : fraction >= 0.75 ? { tone: "warn" as const } : {}), title: "Context window used" });
        }
        break;
      case "limits":
        if (facts.limits) {
          const reset = facts.limits.resetsAt ? clockTime(facts.limits.resetsAt) : undefined;
          const used = percent(facts.limits.usedPercent);
          parts.push({ item, text: `${used}% of limit${reset ? ` · resets ${reset}` : ""}`, ...(used >= 90 ? { tone: "critical" as const } : used >= 75 ? { tone: "warn" as const } : {}), title: "Usage limit reported by the agent" });
        }
        break;
      case "pr":
        if (facts.pr) {
          const state = facts.pr.draft ? "draft" : facts.pr.state.toLowerCase();
          const checks = facts.pr.checks ? PR_CHECKS[facts.pr.checks] : undefined;
          parts.push({ item, text: `#${facts.pr.number} ${state}${checks ? ` · ${checks}` : ""}`, ...(facts.pr.checks === "failure" ? { tone: "critical" as const } : {}), title: "Pull request for this branch" });
        }
        break;
      case "model":
        if (facts.model) parts.push({ item, text: facts.model, title: "Model" });
        break;
      case "harness":
        if (facts.harness) parts.push({ item, text: facts.route ? `${facts.harness} · ${facts.route}` : facts.harness, title: "Agent and route" });
        break;
      case "run":
        if (facts.run) parts.push({ item, text: facts.run, ...(facts.run === "failed" ? { tone: "critical" as const } : {}), title: "Latest turn" });
        break;
      case "cost":
        if (facts.cost) parts.push({ item, text: formatCost(facts.cost), title: "Cost the agent reported for this conversation" });
        break;
    }
  }
  return parts;
}

function formatCost(cost: { amount: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: cost.currency, maximumFractionDigits: 2 }).format(cost.amount);
  } catch {
    return `${cost.amount.toFixed(2)} ${cost.currency}`;
  }
}

/** The JSON a status line command reads on stdin. Field names are a contract with people's scripts. */
export function statusLineStdin(where: { threadId?: string; projectDir?: string; cwd: string }, facts: StatusLineFacts): Record<string, unknown> {
  return {
    thread_id: where.threadId ?? null,
    project_dir: where.projectDir ?? null,
    cwd: where.cwd,
    harness: facts.harness ?? null,
    route: facts.route ?? null,
    model: facts.model ?? null,
    context_percent: facts.context && facts.context.size > 0 ? percent((facts.context.used / facts.context.size) * 100) : null,
    rate_limits: facts.limits ? { used_percent: percent(facts.limits.usedPercent), resets_at: facts.limits.resetsAt ?? null } : null,
    pr: facts.pr ? { number: facts.pr.number, state: facts.pr.state, draft: facts.pr.draft === true, checks: facts.pr.checks ?? null } : null,
    run_status: facts.run ?? null,
    branch: facts.branch ?? null,
    changes: facts.changes ?? null,
    cost: facts.cost ?? null,
  };
}

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, max = 120): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
const count = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** Facts from the window, kept to the shapes above. Anything else is dropped, never passed on. */
export function parseStatusLineFacts(value: unknown): StatusLineFacts {
  const input = record(value);
  const facts: StatusLineFacts = {};
  const branch = text(input.branch, 200);
  if (branch) facts.branch = branch;
  const changes = count(input.changes);
  if (changes !== undefined) facts.changes = Math.floor(changes);
  const context = record(input.context);
  const used = count(context.used);
  const size = count(context.size);
  if (used !== undefined && size) facts.context = { used, size };
  const limits = record(input.limits);
  const usedPercent = count(limits.usedPercent);
  if (usedPercent !== undefined) facts.limits = { usedPercent: Math.min(100, usedPercent), ...(text(limits.resetsAt, 40) ? { resetsAt: text(limits.resetsAt, 40)! } : {}) };
  const pr = record(input.pr);
  const number = count(pr.number);
  const state = text(pr.state, 20);
  if (number !== undefined && state) {
    const checks = pr.checks === "pending" || pr.checks === "success" || pr.checks === "failure" || pr.checks === "none" ? pr.checks : undefined;
    facts.pr = { number: Math.floor(number), state, ...(pr.draft === true ? { draft: true } : {}), ...(checks ? { checks } : {}) };
  }
  for (const key of ["model", "harness", "run"] as const) {
    const value = text(input[key], 80);
    if (value) facts[key] = value;
  }
  if (input.route === "direct" || input.route === "gateway") facts.route = input.route;
  const cost = record(input.cost);
  const amount = count(cost.amount);
  const currency = typeof cost.currency === "string" && /^[A-Z]{3}$/.test(cost.currency) ? cost.currency : undefined;
  if (amount !== undefined && currency) facts.cost = { amount, currency };
  return facts;
}
