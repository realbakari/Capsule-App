import type { CapsuleRepositories } from "@capsule/database";
import { createSessionRecord } from "@capsule/sessions";
import { handoffSummary, isHarnessId, type HandoffInput, type Project, type Session } from "@capsule/shared";
import { carryOverFor } from "./branching.js";

const SUMMARY_MAX = 64 * 1024;

export interface HandoffHost {
  repos: CapsuleRepositories;
  assertWorkAllowed(): void;
  requireProject(id: string): Project;
  emit(command: "sessions-updated"): void;
  log(message: string): void;
}

/**
 * Continue a thread in a new one, on the same agent or another. The summary
 * is built from the transcript here rather than asked of the agent: that
 * works on both routes and for every harness, live or not, and costs no turn.
 */
export class Handoff {
  constructor(private readonly host: HandoffHost) {}

  draft(sessionId: string): { summary: string } {
    const source = this.requireSession(sessionId);
    const project = this.host.requireProject(source.projectId);
    return { summary: handoffSummary({ title: source.title, project: project.name }, this.host.repos.listMessages(source.id)) };
  }

  /** The new thread carries the summary ahead of its first prompt and links back. The original is only read. */
  start(input: HandoffInput): Session {
    this.host.assertWorkAllowed();
    const source = this.requireSession(input.sessionId);
    if (!isHarnessId(input.harnessId)) throw new Error("Choose an agent to continue with.");
    const summary = typeof input.summary === "string" ? input.summary.trim() : "";
    if (!summary) throw new Error("Write a summary for the new thread to start from.");
    if (summary.length > SUMMARY_MAX) throw new Error("The summary is too long. Shorten it to the parts the next thread needs.");
    const project = this.host.requireProject(source.projectId);
    const sameAgent = source.harnessId === input.harnessId;
    const next = createSessionRecord(project, {
      projectId: project.id,
      title: `${source.title} (continued)`,
      mode: source.mode,
      workingDirectory: source.workingDirectory,
      workspaceMode: source.workspaceMode,
    }, input.harnessId);
    next.harnessId = input.harnessId;
    next.worktreeBranch = source.worktreeBranch;
    next.permissionProfile = source.permissionProfile;
    next.turnMode = source.turnMode;
    if (sameAgent) {
      next.acpMode = source.acpMode;
      next.modelOverride = source.modelOverride;
    }
    next.carryOver = { ...(sameAgent ? carryOverFor(source, false) : {}), brief: summary };
    next.origin = { kind: "handoff", sessionId: source.id, ...(source.harnessId ? { fromHarnessId: source.harnessId } : {}) };
    this.host.repos.insertSession(next);
    this.host.log(`Continued ${source.title} in a new thread on ${input.harnessId}.`);
    this.host.emit("sessions-updated");
    return this.host.repos.getSession(next.id) ?? next;
  }

  private requireSession(id: string): Session {
    const session = this.host.repos.getSession(id);
    if (!session) throw new Error("That conversation no longer exists.");
    return session;
  }
}
