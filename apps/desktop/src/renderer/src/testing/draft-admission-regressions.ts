import type { Session } from "@capsule/shared";
import type { useWorkspace } from "../lib/workspace";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Draft regression did not settle: ${check}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Exercise admission through the real provider, not a mocked composer action. */
export async function runDraftAdmissionRegressions(get: () => ReturnType<typeof useWorkspace>, threads: Session[]) {
  const api = window.capsule;
  const original = { validate: api.validateAttachments, send: api.sendMessage, save: api.saveTextAttachment, status: api.harnessStatus };
  const thread = threads.find((item) => item.id === get().sessionId)!;
  const originalThread = { ...thread };
  const draft = get().draft;
  const attachments = [...get().attachments];
  const skill = get().skillId;
  let sent: Parameters<typeof api.sendMessage>[0] | undefined;
  api.sendMessage = async (input) => { sent = input; return undefined as never; };
  try {
    for (const item of get().attachments) get().removeAttachment(item.path);
    await until(() => get().attachments.length === 0);
    let finish!: (value: never) => void;
    api.validateAttachments = async () => new Promise((resolve) => { finish = resolve; });
    const paths = Array.from({ length: 8 }, (_, index) => `/fixture/pending-${index}.txt`);
    const preparing = get().attachFiles(paths);
    await until(() => get().preparingAttachments === 8 && finish);
    assert(!await get().send() && !sent, "Send passed a pending attachment reservation");
    assert(!await get().attachFiles(["/fixture/ninth.txt"]), "Concurrent attachment exceeded the eight-file budget");
    finish(paths.map((path) => ({ path, name: path.split("/").pop(), size: 1 })) as never);
    assert(await preparing, "Reserved attachments were not admitted");
    await until(() => get().attachments.length === 8 && get().preparingAttachments === 0);
    for (const item of get().attachments) get().removeAttachment(item.path);
    await until(() => get().attachments.length === 0);
    api.validateAttachments = original.validate;

    get().setDraft("Keep this draft"); get().setSkillId("keep-skill");
    await get().attachFiles(["/fixture/keep.txt"]);
    await until(() => get().draft === "Keep this draft" && get().attachments.length === 1);
    api.saveTextAttachment = async () => { throw new Error("Disk full"); };
    const paste = "A large recovered paste\n".repeat(2000);
    assert(!await get().attachPastedText(paste), "Failed paste was reported as attached");
    await until(() => get().promptStashes.some((entry) => entry.prompt === paste));
    assert(get().draft === "Keep this draft" && get().attachments[0]?.path === "/fixture/keep.txt", "Failed paste damaged existing work");

    thread.harnessId = "codex"; thread.openclawSessionKey = "direct:acp:codex:fixture"; thread.harnessState = "waiting";
    api.harnessStatus = async () => ({ sessionId: thread.id, harnessId: "codex", openclawSessionKey: thread.openclawSessionKey,
      parsed: { availableCommands: [{ name: "compact", description: "Compact context" }] } } as never);
    await get().refresh();
    await get().refreshHarnessStatus(thread.id);
    await until(() => get().harnessStatuses[thread.id]?.parsed?.availableCommands?.length === 1);
    assert(!await get().runAgentCommand("not-advertised") && !sent, "An unreported command was dispatched");
    assert(await get().runAgentCommand("compact"), `Advertised command was rejected: ${get().notice}`);
    const command = sent as { content: string; attachments?: unknown[]; skillId?: string } | undefined;
    assert(command?.content === "/compact" && command.attachments?.length === 0 && !command.skillId, "Command consumed draft context");
    assert(get().draft === "Keep this draft" && get().attachments.length === 1 && get().skillId === "keep-skill", "Command dispatch cleared unfinished work");

    const setItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function () { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
    try {
      get().setDraft("Unsaved but recoverable draft");
      await until(() => get().notice?.includes("temporarily"));
      const other = threads.find((item) => item.id !== thread.id)!;
      get().setProjectId(other.projectId, other.id);
      await until(() => get().sessionId === other.id);
      get().setProjectId(thread.projectId, thread.id);
      await until(() => get().sessionId === thread.id && get().draft === "Unsaved but recoverable draft");
    } finally { Storage.prototype.setItem = setItem; }
  } finally {
    api.validateAttachments = original.validate; api.sendMessage = original.send; api.saveTextAttachment = original.save; api.harnessStatus = original.status;
    Object.assign(thread, originalThread);
    for (const key of ["harnessId", "openclawSessionKey", "harnessState"] as const) if (!(key in originalThread)) delete thread[key];
    for (const item of get().attachments) get().removeAttachment(item.path);
    await until(() => get().attachments.length === 0);
    await get().attachFiles(attachments.map((item) => item.path));
    get().setDraft(draft); get().setSkillId(skill);
    await get().refresh();
  }
}
