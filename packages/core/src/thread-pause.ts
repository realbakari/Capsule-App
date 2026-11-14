import { restorePausedWorktree, savePausedWorktree, threadSnapshotRef } from "@capsule/filesystem";
import type { CapsuleRepositories } from "@capsule/database";
import type { Project, ProjectActionRun, Session } from "@capsule/shared";

/*
 * Pause and resume for a worktree thread.
 *
 * Pause saves the folder to a hidden ref (see pause-snapshot.ts for why not a
 * WIP commit), then stops the project actions the thread started. Terminals
 * live in the desktop main process; it stops the ones it opened in the
 * thread's folder after this returns. Both steps act only on processes
 * Capsule spawned and recorded, never on anything found by name.
 */

type Repos = Pick<CapsuleRepositories, "getSession" | "setSessionPaused" | "findReplyRun">;

export interface ThreadPauseHost {
  repos: Repos;
  assertWorkAllowed(): void;
  requireProject(id: string): Project;
  listProjectActionRuns(projectId: string, sessionId?: string): ProjectActionRun[];
  stopProjectAction(projectId: string, actionId: string, sessionId?: string): ProjectActionRun;
  emit(): void;
  log(message: string): void;
}

export class ThreadPauses {
  constructor(private readonly host: ThreadPauseHost) {}

  async pause(id: string): Promise<Session> {
    this.host.assertWorkAllowed();
    const session = this.require(id);
    if (session.paused) return session;
    if (session.workspaceMode !== "worktree" || !session.workingDirectory) throw new Error("Only a conversation in its own worktree can be paused.");
    if (this.host.repos.findReplyRun(id)) throw new Error("Stop the running turn before pausing this conversation.");
    const saved = await savePausedWorktree(session.workingDirectory, threadSnapshotRef(id, "paused"));
    if (!saved.ok) throw new Error(`Could not save the worktree: ${saved.detail}`);
    const stoppedActions: string[] = [];
    for (const run of this.host.listProjectActionRuns(session.projectId, id)) {
      if (run.status !== "running") continue;
      try {
        this.host.stopProjectAction(session.projectId, run.actionId, id);
        stoppedActions.push(run.actionId);
      } catch (error) {
        this.host.log(`Could not stop ${run.actionId} while pausing: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.host.repos.setSessionPaused(id, { pausedAt: new Date().toISOString(), ref: saved.paused.ref, head: saved.paused.head, stoppedActions });
    this.host.emit();
    return this.require(id);
  }

  async resume(id: string): Promise<{ session: Session; detail: string }> {
    this.host.assertWorkAllowed();
    const session = this.require(id);
    if (!session.paused) return { session, detail: "This conversation is not paused." };
    const project = this.host.requireProject(session.projectId);
    if (!session.workingDirectory) throw new Error("This conversation has no worktree to resume.");
    const recreate = project.workingDirectory && session.worktreeBranch
      ? { repository: project.workingDirectory, branch: session.worktreeBranch }
      : undefined;
    const result = await restorePausedWorktree(session.workingDirectory, session.paused.ref, recreate);
    if (!result.ok) throw new Error(`Could not resume: ${result.detail}`);
    this.host.repos.setSessionPaused(id, undefined);
    this.host.emit();
    const restarted = session.paused.stoppedActions.length
      ? ` Start ${session.paused.stoppedActions.length === 1 ? "its project action" : "its project actions"} again from Conversation details when you need ${session.paused.stoppedActions.length === 1 ? "it" : "them"}.`
      : "";
    return { session: this.require(id), detail: `${result.detail}${restarted}` };
  }

  private require(id: string): Session {
    const session = this.host.repos.getSession(id);
    if (!session) throw new Error("Session not found");
    return session;
  }
}
