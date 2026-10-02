import { id, optStr, str } from "@capsule/contracts";

/** Rebuild remote mutation arguments; never pass arbitrary renderer fields through. */
export function remoteControlArgs(channel: string, args: unknown[]): unknown[] {
  if (channel === "stopRun") return [id(args[0], channel, 0)];
  if (channel === "resolveApproval") {
    const decision = args[1];
    if (decision !== "approved_once" && decision !== "denied") throw new Error("Browser approvals are once-only or deny.");
    return [id(args[0], channel, 0), decision];
  }
  if (channel !== "createSession" && channel !== "sendMessage") return args;
  const input = args[0];
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid conversation request.");
  const field = (key: string): unknown => Reflect.get(input, key);
  const mode = field("mode");
  if (mode !== undefined && (typeof mode !== "string" || !["chat", "agent", "code", "plan", "research", "browser", "automation"].includes(mode))) throw new Error("Invalid conversation mode.");
  const common = { agentId: optStr(field("agentId"), channel, 0), mode };
  if (channel === "createSession") {
    return [{ ...common, projectId: id(field("projectId"), channel, 0),
      title: optStr(field("title"), channel, 0), workspaceMode: "local", permissionProfile: "strict" }];
  }
  const attachments = field("attachments");
  if (attachments !== undefined && (!Array.isArray(attachments) || attachments.length)) throw new Error("Attach local files from the desktop app.");
  return [{ ...common, sessionId: id(field("sessionId"), channel, 0), content: str(field("content"), channel, 0),
    skillId: optStr(field("skillId"), channel, 0) }];
}
