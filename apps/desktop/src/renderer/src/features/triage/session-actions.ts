import { threadShelf, unreadWatermark, type Session } from "@capsule/shared";
import { buildSessionActionMenuItems, type ActionMenuItem } from "../../lib/action-menu";
import { conversationMarkdown } from "../../lib/conversation-markdown";
import { formatUserError } from "../../lib/errors";
import { useThreadTriage } from "../../lib/thread-triage";
import { useToasts } from "../../lib/toasts";
import { useWorkspace } from "../../lib/workspace";

export const SNOOZE_THREAD_EVENT = "capsule:snooze-thread";

/** Opens the snooze dialog for a thread, from any surface. */
export function requestSnooze(sessionId: string): void {
  window.dispatchEvent(new CustomEvent(SNOOZE_THREAD_EVENT, { detail: sessionId }));
}

/**
 * One list of conversation actions and one way to run them, for the sidebar
 * row, its context menu, the titlebar menu and the palette. They had drifted:
 * the titlebar menu ran its own copy of the sidebar's switch.
 *
 * Rename is returned to the caller, because each surface edits in place.
 */
export function useSessionActions() {
  const { api, projects, pinSession, regenerateTitle, archiveSession, deleteSession, openPath, messages, sessionId } = useWorkspace();
  const triage = useThreadTriage();
  const toasts = useToasts();

  const folderOf = (session: Session) =>
    session.workingDirectory || projects.find((item) => item.id === session.projectId)?.workingDirectory;

  function items(session: Session): ActionMenuItem[] {
    const latest = triage.latest.get(session.id);
    return buildSessionActionMenuItems({
      pinned: Boolean(session.pinned),
      hasFolder: Boolean(folderOf(session)),
      branch: session.worktreeBranch,
      triage: triage.writable ? {
        unread: triage.isUnread(session),
        canMarkUnread: Boolean(unreadWatermark(latest)),
        shelf: threadShelf(session),
      } : undefined,
    });
  }

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toasts.show({ key: "copy", tone: "success", title: `Copied ${what}` });
    } catch (error) {
      toasts.show({ key: "copy", tone: "error", title: `Could not copy ${what}`, detail: formatUserError(error) });
    }
  }

  async function copyMarkdown(session: Session) {
    try {
      const loaded = session.id === sessionId ? messages : await api.listMessages(session.id);
      await copy(conversationMarkdown(session.title, loaded), "conversation as Markdown");
    } catch (error) {
      toasts.show({ key: "copy", tone: "error", title: "Could not read the conversation", detail: formatUserError(error) });
    }
  }

  /** Runs an action; returns "rename" when the caller should start editing. */
  function run(session: Session, action: string): "rename" | undefined {
    const folder = folderOf(session);
    switch (action) {
      case "rename": return "rename";
      case "pin": void pinSession(session.id, true); break;
      case "unpin": void pinSession(session.id, false); break;
      case "generate-title": void regenerateTitle(session.id); break;
      case "open-folder": if (folder) void openPath(folder); break;
      case "copy-path": if (folder) void copy(folder, "path"); break;
      case "copy-branch": if (session.worktreeBranch) void copy(session.worktreeBranch, "branch name"); break;
      case "copy-markdown": void copyMarkdown(session); break;
      case "archive": void archiveSession(session.id); break;
      case "delete": deleteSession(session.id); break;
      case "mark-unread": void triage.markUnread(session.id); break;
      case "mark-read": void triage.markRead(session.id); break;
      case "settle": void triage.settle(session.id); break;
      case "unsettle": void triage.unsettle(session.id); break;
      case "wake": void triage.wake(session.id); break;
      case "snooze": requestSnooze(session.id); break;
    }
    return undefined;
  }

  return { items, run };
}
