import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ProjectActionDialog } from "../features/shell/ProjectActionDialog";
import { SkillsDirectory } from "../features/library/SkillsDirectory";
import { Inspector } from "../features/shell/Inspector";
import { EmbeddedBrowser } from "../features/shell/EmbeddedBrowser";
import { PersistentTerminals } from "../features/terminal/TerminalDock";
import { WorkspaceProvider, useWorkspace as useRealWorkspace } from "../lib/workspace.js";
import { DEFAULT_CAPSULE_SETTINGS, type Session } from "@capsule/shared";
import type { Skill } from "@capsule/shared";

declare global {
  interface Window { testWorkspace: Record<string, unknown>; runRendererRegressions: () => Promise<string>; }
}

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}
async function until(check: () => unknown) {
  const deadline = Date.now() + 4000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${check.toString()}\n${document.body.textContent}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function button(label: string) {
  const found = Array.from(document.querySelectorAll("button")).find((item) => item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}
function fill(selector: string, value: string) {
  const element = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing input: ${selector}`);
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
}

function BrowserFixture({ onOpenExternal }: { onOpenExternal: (url: string) => void }) {
  const [address, setAddress] = useState("https://example.test/first");
  return <EmbeddedBrowser address={address} onAddressChange={setAddress} localServers={[]} serversLoading={false} onOpenExternal={onOpenExternal} />;
}

let actualWorkspace: ReturnType<typeof useRealWorkspace>;
function CaptureWorkspace() { actualWorkspace = useRealWorkspace(); return null; }

window.runRendererRegressions = async () => {
  const host = document.getElementById("root")!;
  let root = createRoot(host);
  let closes = 0;
  let saves = 0;
  let finishSave!: (result: { saved: true } | { saved: false; error: string }) => void;
  root.render(<ProjectActionDialog action={{ id: "", name: "Tests", command: "node --test" }}
    onClose={() => { closes += 1; }}
    onSave={() => { saves += 1; return new Promise((resolve) => { finishSave = resolve; }); }} />);
  await until(() => document.querySelector("form"));
  fill('input[placeholder="http://localhost:5173"]', "javascript:alert(1)");
  await until(() => document.querySelector<HTMLInputElement>('input[placeholder="http://localhost:5173"]')?.value === "javascript:alert(1)");
  button("Save action").click();
  await until(() => document.querySelector('[role="alert"]'));
  assert(saves === 0, "Invalid preview URL reached save");
  fill('input[placeholder="http://localhost:5173"]', "localhost:5173");
  await new Promise((resolve) => setTimeout(resolve, 10));
  button("Save action").click();
  await until(() => saves === 1);
  document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  assert(saves === 1, "A double submission made two saves");
  finishSave({ saved: false, error: "Saving denied by the host" });
  await until(() => document.body.textContent?.includes("Saving denied by the host"));
  assert(closes === 0, "Failed save discarded the editor");
  assert(document.querySelector<HTMLTextAreaElement>("textarea")?.value === "node --test", "Failed save lost the command");
  button("Save action").click(); await until(() => saves === 2);
  finishSave({ saved: true }); await until(() => closes === 1);
  root.unmount(); root = createRoot(host);

  const skill: Skill = { id: "owner/repo/review", name: "Review fixture", description: "Fixture guidance", source: "owner/repo", status: "available", requirements: [], permissions: {} };
  let searches = 0;
  let installs = 0;
  const attachments: string[] = [];
  const views: string[] = [];
  let finishInstall!: (value: Skill) => void;
  window.testWorkspace = {
    skills: [], skillPacks: [], projectId: "project", sessionId: "thread", view: "skills",
    setSkillId: (id: string) => attachments.push(id), setView: (view: string) => views.push(view),
    searchSkillCatalog: async () => {
      searches += 1;
      if (searches === 1) throw new Error("Catalog offline");
      return { entries: [{ ...skill, url: "https://github.com/owner/repo/tree/main/review" }], errors: [], fetchedAt: Date.now() };
    },
    fetchSkillDetail: async () => "# Fixture instructions",
    installSkill: async (input: Skill) => {
      installs += 1;
      assert(input.content === "# Fixture instructions", "The detail install omitted its document");
      if (installs === 1) throw new Error("Install denied by the host");
      return new Promise<Skill>((resolve) => { finishInstall = resolve; });
    },
  };
  root.render(<SkillsDirectory />);
  await until(() => document.body.textContent?.includes("Browse GitHub"));
  button("Browse GitHub").click();
  await until(() => document.body.textContent?.includes("Catalog offline"));
  button("Retry").click();
  await until(() => document.body.textContent?.includes("Review fixture"));
  assert(searches === 2, "Catalog Retry did not fetch again");
  document.querySelector<HTMLButtonElement>(".skill-catalog-main")!.click();
  await until(() => document.querySelector(".skill-markdown-rendered")?.textContent?.includes("Fixture instructions"));
  button("Install & Attach ($)").click();
  await until(() => document.body.textContent?.includes("Install denied by the host"));
  assert(attachments.length === 0 && views.length === 0, "A rejected install attached or navigated");
  assert(document.querySelector('[role="dialog"]'), "Failed install closed its detail");
  button("Install & Attach ($)").click(); await until(() => installs === 2);
  assert(button("Install & Attach ($)").disabled, "Install can be repeated while pending");
  assert(attachments.length === 0, "Attached before persistence completed");
  finishInstall({ ...skill, content: "# Fixture instructions", status: "installed" });
  await until(() => attachments.length === 1);
  assert(attachments[0] === skill.id && views[0] === "chat", "Successful install did not attach to the chat");
  root.unmount();
  root = createRoot(host);
  window.testWorkspace.skills = [{ ...skill, status: "installed" }];
  root.render(<SkillsDirectory />);
  await until(() => document.querySelector(".installed-skill-row"));
  button("Attach").click(); await until(() => installs === 3);
  assert(attachments.length === 1, "Installed-list Attach bypassed document recovery");
  assert(button("Loading…").disabled, "Installed-list Attach is repeatable during recovery");
  finishInstall({ ...skill, content: "# Fixture instructions", status: "installed" });
  await until(() => attachments.length === 2);
  root.unmount();
  root = createRoot(host);
  const writes: Array<{ projectId: string; path: string; contents: string; root: string }> = [];
  let finishWrite!: (value: { revision: string }) => void;
  const preview = (name: string) => ({ path: name, kind: "text", contents: `contents ${name}`, revision: "original", size: 10, truncated: false });
  let finishPreview!: (value: ReturnType<typeof preview>) => void;
  window.testWorkspace = {
    project: { id: "owner-a", name: "Owner A", workingDirectory: "/fixture/a" }, projectId: "owner-a",
    session: { id: "thread-a" }, files: [], steps: [], artifacts: [], harnesses: [], harnessSessions: [],
    inspectorTab: "files", settings: {}, requestedFile: "first.txt",
    setInspectorOpen: () => {},
    clearRequestedFile: () => { window.testWorkspace.requestedFile = undefined; },
    api: {
      listFiles: async () => [],
      previewFile: async (_project: string, name: string) => name === "late.txt" ? new Promise((resolve) => { finishPreview = resolve; }) : preview(name),
      writeFile: async (projectId: string, filePath: string, contents: string, options: { root: string }) => {
        writes.push({ projectId, path: filePath, contents, root: options.root });
        return new Promise((resolve) => { finishWrite = resolve; });
      },
    },
  };
  root.render(<Inspector />);
  await until(() => document.querySelector(".file-preview-code"));
  button("Edit").click(); await until(() => document.querySelector(".file-editor-area"));
  fill(".file-editor-area", "owned edit");
  await until(() => document.querySelector<HTMLTextAreaElement>(".file-editor-area")?.value === "owned edit");
  window.testWorkspace = { ...window.testWorkspace, projectId: "owner-b", project: { id: "owner-b", name: "Owner B", workingDirectory: "/fixture/b" }, session: { id: "thread-b" }, requestedFile: "second.txt" };
  root.render(<Inspector />);
  await until(() => writes.length === 1 && document.body.textContent?.includes("contents second.txt"));
  assert(writes[0]?.projectId === "owner-a" && writes[0]?.root === "/fixture/a" && writes[0]?.path === "first.txt" && writes[0]?.contents === "owned edit", "Navigation moved the pending save to another project");
  finishWrite({ revision: "saved-a" });
  window.testWorkspace.requestedFile = "late.txt";
  root.render(<Inspector />); await until(() => Boolean(finishPreview));
  window.testWorkspace = { ...window.testWorkspace, projectId: "owner-c", project: { id: "owner-c", name: "Owner C", workingDirectory: "/fixture/c" }, session: { id: "thread-c" }, requestedFile: "current.txt" };
  root.render(<Inspector />); await until(() => document.body.textContent?.includes("contents current.txt"));
  finishPreview(preview("late.txt"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(!document.body.textContent?.includes("contents late.txt"), "Late preview crossed the folder boundary");
  root.unmount(); root = createRoot(host);
  const external: string[] = [];
  window.testWorkspace = { api: { registerBrowserView: async () => {} } };
  root.render(<BrowserFixture onOpenExternal={(url) => external.push(url)} />);
  await until(() => document.querySelector("webview"));
  const guest = document.querySelector("webview")!;
  Object.assign(guest, { canGoBack: () => true, canGoForward: () => false, getURL: () => "https://example.test/committed", getTitle: () => "Fixture", getWebContentsId: () => 1, getZoomFactor: () => 1 });
  guest.dispatchEvent(Object.assign(new Event("did-navigate"), { url: "https://example.test/committed", isMainFrame: true }));
  await until(() => document.querySelector<HTMLInputElement>('.browser-address-input')?.value === "https://example.test/committed" || document.querySelector<HTMLInputElement>('input')?.value === "https://example.test/committed");
  document.querySelector<HTMLButtonElement>('button[title="Open in system browser"]')!.click();
  assert(external[0] === "https://example.test/committed", "External open used the initial URL instead of the committed page");
  assert(guest.getAttribute("src") === "https://example.test/first", "A committed navigation reset the guest src");
  root.unmount();
  root = createRoot(host);
  const shells: string[] = [];
  const stopped: string[] = [];
  window.testWorkspace = { api: {
    on: () => () => {}, terminalStart: async ({ cwd }: { cwd: string }) => { shells.push(cwd); return { id: cwd, cwd, pid: 1 }; },
    terminalStop: async (id: string) => { stopped.push(id); }, terminalInput: async () => {}, terminalResize: async () => {},
  } };
  root.render(<PersistentTerminals cwd="/fixture/a" visible onClose={() => {}} />);
  await until(() => document.querySelector('.terminal-tab'));
  root.render(<PersistentTerminals cwd="/fixture/a" visible={false} onClose={() => {}} />);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(stopped.length === 0, "Hiding a terminal killed its shell");
  root.render(<PersistentTerminals cwd="/fixture/b" visible onClose={() => {}} />);
  await until(() => shells.length === 2);
  root.render(<PersistentTerminals cwd="/fixture/a" visible onClose={() => {}} />);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(shells.length === 2 && stopped.length === 0, "Changing folders restarted or killed shells");
  root.unmount();
  assert(stopped.length === 2, "Unmount did not close owned shells");

  localStorage.clear(); root = createRoot(host);
  const threads: Session[] = [];
  const project = { id: "send-project", name: "Send fixture", workingDirectory: "/fixture/send", defaultMode: "chat" };
  let sends = 0;
  let failSend = true;
  let failRead = false;
  let finishSend!: () => void;
  const nativeApi = window.capsule;
  window.capsule = {
    listProjects: async () => [project], listAgents: async () => [{ id: "general", name: "Fixture" }],
    listSkills: async () => [], listSkillPacks: async () => [], getStatus: async () => ({ kind: "openclaw", state: "connected" }),
    getSubsystemStatus: async () => ({}), listApprovals: async () => [], listHarnesses: async () => [],
    getSettings: async () => ({ ...DEFAULT_CAPSULE_SETTINGS, defaultMode: "chat", defaultAgentId: "general" }),
    listSessions: async () => [...threads], listHarnessSessions: async () => [], listRuns: async () => [],
    gitStatus: async () => ({ isRepo: false }), listFiles: async () => [], on: () => () => {},
    listMessagePage: async () => { if (failRead) { failRead = false; throw new Error("History read failed"); } return { messages: [], hasMore: false }; },
    createSession: async (input: Partial<Session>) => { const thread = { ...input, id: `send-thread-${threads.length}`, state: "active" } as Session; threads.push(thread); return thread; },
    sendMessage: async () => { sends += 1; if (failSend) throw new Error("Send rejected"); await new Promise<void>((resolve) => { finishSend = resolve; }); },
  } as unknown as typeof window.capsule;
  root.render(<WorkspaceProvider><CaptureWorkspace /></WorkspaceProvider>);
  await until(() => actualWorkspace?.ready && actualWorkspace?.projectId === project.id);
  actualWorkspace.setDraft("first draft"); await until(() => actualWorkspace.draft === "first draft");
  await actualWorkspace.sendAndContinue();
  await until(() => !actualWorkspace.busy);
  assert(actualWorkspace.draft === "first draft" && threads.length === 1 && !actualWorkspace.sessionId, "Rejected initial send lost its draft or navigated");
  failSend = false;
  const accepted = actualWorkspace.sendAndContinue();
  await until(() => sends === 2 && Boolean(finishSend));
  await actualWorkspace.sendAndContinue();
  assert(sends === 2, "Busy send created a duplicate turn");
  finishSend(); await accepted;
  await until(() => actualWorkspace.sessionId === "send-thread-2");
  assert(actualWorkspace.draft === "", "Accepted send-and-new retained the sent draft");
  actualWorkspace.setDraft("refresh test"); await until(() => actualWorkspace.draft === "refresh test");
  const refreshing = actualWorkspace.send(); await until(() => sends === 3);
  failRead = true; finishSend(); await refreshing;
  await until(() => !actualWorkspace.busy && actualWorkspace.notice?.includes("was sent"));
  assert(actualWorkspace.draft === "", "Refresh failure recreated an accepted draft");
  assert(actualWorkspace.notice?.includes("was sent"), "Refresh failure did not distinguish accepted send");
  root.unmount(); window.capsule = nativeApi;
  return "Renderer regressions passed: action/skill recovery, editor ownership, committed navigation, terminal persistence, send recovery and new-thread admission.";
};
