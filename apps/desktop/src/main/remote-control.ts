import { id, optStr, str } from "@capsule/contracts";
import { CONTROL_CHANNELS, readFollowUpOp, type MessageAttachment } from "@capsule/shared";

const NO_ATTACHMENTS = "Attach local files from the desktop app.";

/** What a phone may upload: photos and plain text, decoded size capped. */
export const UPLOAD_LIMIT_BYTES = 3 * 1024 * 1024;
const UPLOAD_TYPES = new Set(["image/jpeg", "image/png", "text/plain", "text/markdown", "application/json"]);

/*
 * Files a phone uploaded, by thread. A phone attaches a file by naming the
 * path this computer gave it back; the attachment that reaches the agent is
 * rebuilt from this record, never from what the phone sent.
 */
export class RemoteUploads {
  private readonly bySession = new Map<string, Map<string, MessageAttachment>>();

  add(sessionId: string, attachment: MessageAttachment): void {
    const files = this.bySession.get(sessionId) ?? new Map<string, MessageAttachment>();
    files.set(attachment.path, attachment);
    this.bySession.set(sessionId, files);
  }

  get(sessionId: string, path: string): MessageAttachment | undefined {
    return this.bySession.get(sessionId)?.get(path);
  }
}

export interface RemoteCaller {
  transport: "browser" | "phone";
  uploads?: RemoteUploads;
}

/** Rebuild remote mutation arguments; never pass arbitrary renderer fields through. */
export function remoteControlArgs(channel: string, args: unknown[], caller: RemoteCaller | "browser" | "phone" = "browser"): unknown[] {
  const { transport, uploads } = typeof caller === "string" ? { transport: caller, uploads: undefined } : caller;
  if (channel === "stopRun") return [id(args[0], channel, 0)];
  if (channel === "resolveApproval") {
    const decision = args[1];
    // "For this thread" lasts only as long as the agent session, and only a
    // phone on the pinned channel may grant it; a browser link stays once-only.
    const allowed = transport === "phone" ? ["approved_once", "approved_session", "denied"] : ["approved_once", "denied"];
    if (typeof decision !== "string" || !allowed.includes(decision)) throw new Error("Browser approvals are once-only or deny.");
    return [id(args[0], channel, 0), decision];
  }
  if (channel === "updateFollowUps") return followUpArgs(args, uploads);
  if (channel === "uploadAttachment") {
    if (transport !== "phone") throw new Error(NO_ATTACHMENTS);
    const mimeType = str(args[2], channel, 2);
    if (!UPLOAD_TYPES.has(mimeType)) throw new Error("A phone can attach photos and plain text files.");
    const data = str(args[3], channel, 3);
    // base64 is 4/3 the size; reject before decoding anything large.
    if (data.length > Math.ceil(UPLOAD_LIMIT_BYTES / 3) * 4 + 4) throw new Error("That file is over 3 MB.");
    const name = str(args[1], channel, 1).replace(/[\\/:\0]/gu, "_").slice(0, 120).trim() || "Attachment";
    return [id(args[0], channel, 0), name, mimeType, data];
  }
  if (channel === "archiveSession" || channel === "restoreSession") return [id(args[0], channel, 0)];
  if (channel === "pinSession") {
    if (typeof args[1] !== "boolean") throw new Error("Pin or unpin a thread.");
    return [id(args[0], channel, 0), args[1]];
  }
  if (channel === "renameSession") {
    const title = str(args[1], channel, 1).trim();
    if (!title || title.length > 200) throw new Error("A thread title is 1 to 200 characters.");
    return [id(args[0], channel, 0), title];
  }
  if (channel !== "createSession" && channel !== "sendMessage") {
    // A control channel with no rebuilder here is refused, not passed through:
    // adding one to the scope table must come with its argument rules.
    if ((CONTROL_CHANNELS as readonly string[]).includes(channel)) throw new Error(`${channel} is not available from a paired device.`);
    return args;
  }
  const input = args[0];
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid conversation request.");
  const field = (key: string): unknown => Reflect.get(input, key);
  const mode = field("mode");
  if (mode !== undefined && (typeof mode !== "string" || !["chat", "agent", "code", "plan", "research", "browser", "automation"].includes(mode))) throw new Error("Invalid conversation mode.");
  const common = { agentId: optStr(field("agentId"), channel, 0), mode };
  if (channel === "createSession") {
    const profileId = optStr(field("profileId"), channel, 0);
    // A profile may pick the agent and model; the paired device still cannot loosen permission or leave the checkout.
    return [{ ...common, projectId: id(field("projectId"), channel, 0),
      title: optStr(field("title"), channel, 0), workspaceMode: "local", permissionProfile: "strict", ...(profileId ? { profileId } : {}) }];
  }
  const sessionId = id(field("sessionId"), channel, 0);
  const attachments = uploadedAttachments(field("attachments"), sessionId, uploads);
  return [{ ...common, sessionId, content: str(field("content"), channel, 0),
    skillId: optStr(field("skillId"), channel, 0), ...(attachments.length ? { attachments } : {}) }];
}

/*
 * Queued follow-ups carry attachments, which are paths on this computer. A
 * paired device may queue, reorder and remove text prompts, but never name a
 * file, and never schedule a resume (that replays a stopped turn's files).
 */
function followUpArgs(args: unknown[], uploads: RemoteUploads | undefined): unknown[] {
  const sessionId = id(args[0], "updateFollowUps", 0);
  const op = readFollowUpOp(args[1]);
  if (!op) throw new Error("That change to the follow-ups is not valid.");
  switch (op.type) {
    case "add": {
      const attachments = uploadedAttachments(op.prompt.attachments, sessionId, uploads);
      if (!op.prompt.content.trim() && !attachments.length) throw new Error("A queued message needs text.");
      return [sessionId, { type: "add", prompt: { content: op.prompt.content, attachments, ...(op.prompt.skillId ? { skillId: op.prompt.skillId } : {}) } }];
    }
    case "remove":
    case "move":
    case "cancel-resume":
      return [sessionId, op];
    case "schedule":
      throw new Error("Schedule a resume from the desktop app.");
  }
}

/** Attachments a phone named, each one a file this computer stored for that thread. */
function uploadedAttachments(value: unknown, sessionId: string, uploads: RemoteUploads | undefined): MessageAttachment[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error(NO_ATTACHMENTS);
  return value.map((item) => {
    const path = item && typeof item === "object" ? Reflect.get(item, "path") : undefined;
    const known = typeof path === "string" ? uploads?.get(sessionId, path) : undefined;
    if (!known) throw new Error(NO_ATTACHMENTS);
    return { ...known };
  });
}
