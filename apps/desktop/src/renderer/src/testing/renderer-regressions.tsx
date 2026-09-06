import { createRoot } from "react-dom/client";
import { useState } from "react";
import { ProjectActionDialog } from "../features/shell/ProjectActionDialog";
import { SkillsDirectory } from "../features/library/SkillsDirectory";
import { Inspector } from "../features/shell/Inspector";
import { EmbeddedBrowser } from "../features/shell/EmbeddedBrowser";
import { PersistentTerminals } from "../features/terminal/TerminalDock";
import { FileDiff } from "../features/shell/FileDiff";
import { PagedFileDiffs } from "../features/shell/PagedFileDiffs";
import { ContentSearch } from "../features/shell/ContentSearch";
import { TurnOutcome } from "../features/conversation/TurnOutcome";
import { RunEventLog } from "../features/conversation/RunEventLog";
import { Pet } from "../features/pet/Pet";
import { CapabilityDetails } from "../features/harness/CapabilityDetails";
import { MenuSelect } from "../features/shell/MenuSelect";
import { RunSummary } from "../features/conversation/RunSummary";
import { AgentModelPicker } from "../features/conversation/AgentModelPicker";
import { Composer } from "../features/conversation/Composer";
import { Conversation } from "../features/conversation/Conversation";
import { GATEWAY_CONNECTION_REQUIRED } from "../lib/harness-preflight";
import { WorkspaceProvider, useWorkspace as useRealWorkspace } from "../lib/workspace.js";
import { DEFAULT_CAPSULE_SETTINGS, PRESET_HARNESSES, type Session, type Run, type RunEvent, type ChatMessage, type DiffFile } from "@capsule/shared";
import type { Skill, Agent, HarnessStatus } from "@capsule/shared";

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
  const petApi = window.capsule;
  let petReadFails = true;
  let petFocus = "";
  const expandedPet: boolean[] = [];
  window.capsule = {
    getPetState: async () => {
      if (petReadFails) throw new Error("offline");
      return { visible: true, summary: { state: "running", items: [{ sessionId: "pet-thread", title: "Example task", state: "running" }], counts: { running: 1, ready: 0, blocked: 0, "needs-input": 0 } } };
    },
    on: () => () => {}, rendererReady: async () => {},
    setPetExpanded: async (value: boolean) => { expandedPet.push(value); },
    focusSession: async (id: string) => { petFocus = id; }, togglePet: async () => false,
  } as unknown as typeof window.capsule;
  root.render(<Pet />);
  await until(() => document.body.textContent?.includes("Status unavailable"));
  (document.querySelector(".pet-body") as HTMLButtonElement).click();
  await until(() => expandedPet.includes(true));
  petReadFails = false; button("Retry status").click();
  await until(() => document.body.textContent?.includes("Example task"));
  assert(getComputedStyle(document.querySelector(".pet-tail")!).animationName !== "none", "Mascot tail has no animation");
  assert(getComputedStyle(document.querySelector(".pet-leg-front")!).animationName !== "none", "Mascot has no walking legs");
  button("Play").click();
  await until(() => document.querySelector(".pet--pounce"));
  assert(getComputedStyle(document.querySelector(".pet-capsule")!).animationName === "petPounce", "Play did not animate the mascot");
  button("Stretch").click();
  await until(() => document.querySelector(".pet--stretch"));
  button("Pause motion").click();
  await until(() => document.querySelector(".pet--paused"));
  assert(getComputedStyle(document.querySelector(".pet-tail")!).animationName === "none", "Pause left the tail animated");
  assert(getComputedStyle(document.querySelector(".pet-rig")!).animationName === "none", "Pause left the stretch animated");
  button("Resume motion").click();
  (document.querySelector(".pet-tray-title")?.closest("button") as HTMLButtonElement).click();
  await until(() => petFocus === "pet-thread" && expandedPet.at(-1) === false);
  root.unmount(); window.capsule = petApi; localStorage.clear(); root = createRoot(host);
  let modelChanges = 0;
  let openedFile = "";
  root.render(<><MenuSelect ariaLabel="Unavailable model" value="" options={[{ id: "x", label: "Example" }]} unavailableReason="Direct model is fixed at startup" onChange={() => modelChanges++} /><CapabilityDetails compact /><RunSummary label="Used tools" run={{ status: "failed" } as Run} touchedFiles={[{ path: "src/example.ts", action: "modified" }]} onOpenFile={(file) => { openedFile = file; }} /></>);
  await until(() => document.querySelector('[aria-label="Unavailable model"]'));
  (document.querySelector('[aria-label="Unavailable model"]') as HTMLButtonElement).click();
  assert(!document.querySelector('[role="listbox"]') && modelChanges === 0, "Unavailable model dispatched a change");
  assert(document.body.textContent?.includes("Failed") && !document.querySelector(".run-summary-done-badge"), "Failed activity still looks successful");
  const touchedFileButton = document.querySelector<HTMLButtonElement>('[aria-label="Open src/example.ts"]')!;
  assert(touchedFileButton.tagName === "BUTTON" && !touchedFileButton.parentElement?.closest("button"), "File chip is not an independent keyboard control");
  touchedFileButton.click();
  assert(openedFile === "src/example.ts" && document.querySelector('.run-summary-header')?.getAttribute("aria-expanded") === "false", "File chip toggled the work log instead of opening its file");
  const capability = document.querySelector("details")!;
  capability.open = true;
  capability.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert(!capability.open, "Capability popover did not dismiss with Escape");
  const pickerAgents = [{ id: "claude", name: "Claude Code" }, { id: "codex", name: "Codex" }] as Agent[];
  const pickerHarnesses: HarnessStatus[] = PRESET_HARNESSES.filter((preset) => pickerAgents.some((agent) => agent.id === preset.id)).map((preset) => ({ ...preset, runtimeRoute: "openclaw", readiness: "ready", acpxEnabled: true, dedicatedProjectIds: [], liveSessionIds: [], detail: "Ready" }));
  let selectedAgent = "", selectedModel = "";
  const pickerProps = { agents: pickerAgents, harnesses: pickerHarnesses, agentId: "claude", liveHarnessId: "claude", currentModel: "example", models: { currentModelId: "example", availableModels: [{ modelId: "example", name: "Example model" }] }, onAgent: (id: string) => { selectedAgent = id; }, onModel: (id: string) => { selectedModel = id; } };
  root.render(<AgentModelPicker {...pickerProps} availability={{ state: "available", detail: "Reported by the live session" }} />);
  await until(() => document.querySelector('[aria-label="Agent and model"]'));
  const pickerTrigger = document.querySelector<HTMLButtonElement>('[aria-label="Agent and model"]')!;
  assert(pickerTrigger.textContent?.includes("Example model"), "Combined picker omitted the current model");
  pickerTrigger.click();
  await until(() => document.querySelector('[role="listbox"]'));
  document.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]')!.click();
  await until(() => selectedModel === "example" && !document.querySelector('[role="listbox"]'));
  assert(document.activeElement === pickerTrigger, "Model selection lost keyboard focus");
  pickerTrigger.click(); await until(() => document.querySelector('[role="listbox"]'));
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", cancelable: true }));
  assert(document.activeElement?.getAttribute("role") === "option", "Picker keyboard navigation did not focus an option");
  const agentRow = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((row) => row.textContent?.startsWith("Codex"))!;
  agentRow.click(); await until(() => selectedAgent === "codex");
  root.render(<AgentModelPicker {...pickerProps} models={undefined} currentModel="" availability={{ state: "unavailable", detail: "Direct mode cannot change live models." }} />);
  await until(() => pickerTrigger.textContent?.includes("Claude Code"));
  pickerTrigger.click(); await until(() => document.querySelector('[role="listbox"]'));
  const unavailableModel = document.querySelector<HTMLButtonElement>('[role="option"][aria-disabled="true"]')!;
  assert(unavailableModel.textContent?.includes("Direct mode cannot change live models"), "Unavailable model has no explanation");
  unavailableModel.click();
  assert(selectedModel === "example" && document.querySelector('[role="listbox"]'), "Unavailable model dispatched a change");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
  await until(() => !document.querySelector('[role="listbox"]'));
  assert(document.activeElement === pickerTrigger, "Escape did not restore picker focus");
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
  let treeReads = 0;
  const treeFiles = Array.from({ length: 300 }, (_, index) => ({
    path: `file-${index}.ts`, type: "file", get name() { treeReads += 1; return `file-${index}.ts`; },
  }));
  window.testWorkspace = {
    project: { id: "owner-a", name: "Owner A", workingDirectory: "/fixture/a" }, projectId: "owner-a",
    session: { id: "thread-a" }, files: treeFiles, steps: [], artifacts: [], harnesses: [], harnessSessions: [],
    inspectorTab: "files", settings: {}, requestedFile: "first.txt",
    setInspectorOpen: () => {},
    clearRequestedFile: () => { window.testWorkspace.requestedFile = undefined; },
    api: {
      listFiles: async () => treeFiles,
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
  await until(() => document.querySelectorAll(".codex-tree-item").length >= 300);
  treeReads = 0;
  fill(".file-editor-area", "owned edit");
  await until(() => document.querySelector<HTMLTextAreaElement>(".file-editor-area")?.value === "owned edit");
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert(treeReads === 0, `Typing rebuilt the file tree (${treeReads} entry reads)`);
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
  const registered: Array<number | undefined> = [];
  window.testWorkspace = { api: { registerBrowserView: async (id?: number) => { registered.push(id); } } };
  root.render(<BrowserFixture onOpenExternal={(url) => external.push(url)} />);
  await until(() => document.querySelector("webview"));
  const guest = document.querySelector("webview")!;
  Object.assign(guest, { canGoBack: () => true, canGoForward: () => false, getURL: () => "https://example.test/committed", getTitle: () => "Fixture", getWebContentsId: () => 1, getZoomFactor: () => 1 });
  guest.dispatchEvent(Object.assign(new Event("did-navigate"), { url: "https://example.test/committed", isMainFrame: true }));
  await until(() => document.querySelector<HTMLInputElement>('.browser-address-input')?.value === "https://example.test/committed" || document.querySelector<HTMLInputElement>('input')?.value === "https://example.test/committed");
  document.querySelector<HTMLButtonElement>('button[title="Open in system browser"]')!.click();
  assert(external[0] === "https://example.test/committed", "External open used the initial URL instead of the committed page");
  assert(guest.getAttribute("src") === "https://example.test/first", "A committed navigation reset the guest src");
  guest.dispatchEvent(Object.assign(new Event("did-fail-load"), { errorCode: -105, errorDescription: "Subframe failed", isMainFrame: false }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert(!document.body.textContent?.includes("Subframe failed"), "A subframe error replaced the working page");
  guest.dispatchEvent(new Event("did-stop-loading"));
  document.querySelector<HTMLButtonElement>('button[title="More options"]')!.click();
  await until(() => document.body.textContent?.includes("Local servers home"));
  button("Local servers home").click(); await until(() => !document.querySelector("webview"));
  fill('.preview-address-input', "https://example.test/first");
  await until(() => document.querySelector<HTMLInputElement>('.preview-address-input')?.value === "https://example.test/first");
  document.querySelector('.preview-address-input')!.closest('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await until(() => document.querySelector("webview"));
  const remounted = document.querySelector("webview")!;
  Object.assign(remounted, { canGoBack: () => true, canGoForward: () => false, getURL: () => "https://example.test/returned", getTitle: () => "Returned", getWebContentsId: () => 2, getZoomFactor: () => 1 });
  remounted.dispatchEvent(new Event("dom-ready"));
  remounted.dispatchEvent(Object.assign(new Event("did-navigate"), { url: "https://example.test/returned", isMainFrame: true }));
  await until(() => registered.includes(2) && document.querySelector<HTMLInputElement>('.preview-address-input')?.value === "https://example.test/returned");
  assert(registered.includes(undefined), "Browser home retained the old guest registration");
  root.unmount();
  root = createRoot(host);
  let serverRetries = 0;
  root.render(<EmbeddedBrowser address="" onAddressChange={() => {}} localServers={[]} serversLoading={false}
    serversError="Discovery unavailable" onRetryServers={() => { serverRetries += 1; }} onOpenExternal={() => {}} />);
  await until(() => document.querySelector('[role="alert"]'));
  assert(!document.body.textContent?.includes("No local web servers"), "Discovery failure was presented as an empty scan");
  button("Retry").click(); assert(serverRetries === 1, "Server discovery Retry did nothing");
  root.unmount(); root = createRoot(host);

  const largeFile: DiffFile = { path: "large.ts", status: "modified", binary: false, additions: 20_000, deletions: 0, hunks: [{
    header: "@@ -0,0 +1,20000 @@", oldStart: 0, newStart: 1, lines: Array.from({ length: 20_000 }, (_, index) => ({ kind: "add", text: `const value${index} = ${index};`, newLine: index + 1 })),
  }] };
  const notes: Array<[string, number, string]> = [];
  root.render(<FileDiff file={largeFile} split={false} onAddComment={(...args) => notes.push(args)} />);
  await until(() => document.querySelectorAll(".diff-row--add").length === 160);
  button("Next").click();
  await until(() => document.querySelector(".diff-row--add .diff-gutter-add-btn")?.parentElement?.textContent?.includes("161"));
  document.querySelector<HTMLButtonElement>(".diff-row--add .diff-gutter-add-btn")!.click();
  assert(notes[0]?.[1] === 161 && notes[0]?.[2] === "right", "A paged note targeted a page-relative line");
  root.render(<FileDiff file={largeFile} split onAddComment={(...args) => notes.push(args)} />);
  await until(() => document.querySelectorAll(".diff-split-row:not(.diff-split-row--hunk)").length === 160);
  assert(document.querySelector<HTMLInputElement>('[aria-label="Diff rows page"]')?.value === "1", "Layout change retained an invalid row page");
  fill('[aria-label="Diff rows page"]', "125");
  await until(() => document.querySelector(".file-diff-body")?.textContent?.includes("value19999"));
  assert(document.querySelectorAll(".diff-gutter-add-btn").length === 160, "Last diff page mounted hidden lines");
  root.unmount(); root = createRoot(host);
  const manyFiles = Array.from({ length: 100 }, (_, index) => ({ ...largeFile, path: `large-${index}.ts` }));
  root.render(<PagedFileDiffs files={manyFiles} split={false} />);
  await until(() => document.querySelectorAll(".file-diff-head").length === 10);
  assert(!document.querySelector(".file-diff-body"), "Large files expanded without being requested");
  fill('[aria-label="Files page"]', "10");
  await until(() => document.body.textContent?.includes("large-99.ts"));
  assert(document.querySelectorAll(".file-diff-head").length === 10, "File navigation mounted every file");
  root.unmount(); root = createRoot(host);
  const searchApi = window.capsule;
  const openedFiles: string[] = [];
  let searchCalls = 0;
  window.testWorkspace = { contentSearch: true, setContentSearch: () => {}, projectId: "search-project", sessionId: "search-thread", openFile: (path: string) => openedFiles.push(path) };
  window.capsule = { searchContents: async (projectId: string, _query: string, sessionId: string) => {
    searchCalls += 1;
    assert(projectId === "search-project" && sessionId === "search-thread", "Search lost thread ownership");
    if (searchCalls === 1) throw new Error("Search temporarily unavailable");
    return [{ path: "result.ts", line: 17, text: "the match" }];
  } } as unknown as typeof window.capsule;
  root.render(<ContentSearch />);
  await until(() => document.querySelector('input[placeholder="Search in files…"]'));
  fill('input[placeholder="Search in files…"]', "match");
  await until(() => document.body.textContent?.includes("Search temporarily unavailable"));
  assert(!document.body.textContent?.includes("No matches"), "Search failure claimed no matches");
  button("Retry").click();
  await until(() => document.body.textContent?.includes("result.ts:17"));
  document.querySelector<HTMLButtonElement>(".palette-list button")!.click();
  assert(openedFiles[0] === "result.ts", "Search result did not open its file");
  root.unmount(); root = createRoot(host); window.capsule = searchApi;
  let diffReads = 0;
  const savedPatch = "diff --git a/saved.ts b/saved.ts\n--- a/saved.ts\n+++ b/saved.ts\n@@ -0,0 +2023,500 @@\n" + Array.from({ length: 500 }, (_, index) => `+const saved${index} = ${index};\n`).join("") + "diff --git a/icon.png b/icon.png\nBinary files a/icon.png and b/icon.png differ\n";
  const outcomeRun = { id: "outcome-run", sessionId: "outcome-thread", checkpointRef: "saved" } as Run;
  window.testWorkspace = { setConfirm: () => {}, setNotice: () => {}, api: {
    listRunEventPage: async () => ({ events: [], hasMore: false }),
    turnDiff: async () => {
      diffReads += 1;
      if (diffReads === 1) throw new Error("Saved diff unavailable");
      return { available: true, patch: savedPatch, files: [{ path: "saved.ts", added: 500, removed: 0 }, { path: "icon.png" }] };
    },
  } };
  root.render(<TurnOutcome run={outcomeRun} />);
  await until(() => document.querySelector('[role="alert"]'));
  button("Retry").click(); await until(() => document.body.textContent?.includes("saved.ts"));
  assert(!document.querySelector('[role="alert"]'), "Saved-diff Retry retained the old error");
  (document.getElementById("pet-test-styles") as HTMLStyleElement).media = "not all";
  (document.getElementById("composer-test-styles") as HTMLStyleElement).media = "all";
  const changedRow = document.querySelector<HTMLButtonElement>('.changed-file-row')!;
  assert(!document.querySelector('.saved-diff-preview'), "Saved preview mounted before interaction");
  const cardHeight = document.querySelector('.changed-files')!.getBoundingClientRect().height;
  changedRow.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
  assert(!document.querySelector('.saved-diff-preview'), "Hover preview opened without its intent delay");
  await until(() => document.querySelector('.saved-diff-preview'));
  assert(diffReads === 2, "Hover reread the filesystem instead of the saved snapshot");
  assert(document.querySelectorAll('.saved-diff-preview-line').length < 85, "Hover mounted an unbounded diff");
  assert(document.querySelector('.saved-diff-preview')?.textContent?.includes("2023") && document.querySelector('.saved-diff-preview .tok-kw'), "Preview lost line numbers or syntax highlighting");
  assert(document.querySelector('.saved-diff-preview-footer')?.textContent?.includes("Excerpt"), "Short preview claimed to contain the full diff");
  const hoverPanel = document.querySelector('.saved-diff-preview')!;
  const previewBounds = hoverPanel.getBoundingClientRect();
  assert(previewBounds.left >= 0 && previewBounds.top >= 0 && previewBounds.right <= innerWidth && previewBounds.bottom <= innerHeight, "Preview escaped the viewport");
  assert(cardHeight === document.querySelector('.changed-files')!.getBoundingClientRect().height, "Hover resized the conversation");
  changedRow.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse", relatedTarget: hoverPanel }));
  hoverPanel.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse", relatedTarget: changedRow }));
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert(document.querySelector('.saved-diff-preview'), "Preview closed while the pointer was inside it");
  document.querySelector('.saved-diff-preview-code')!.dispatchEvent(new Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert(document.querySelector('.saved-diff-preview'), "Scrolling the excerpt closed it");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await until(() => !document.querySelector('.saved-diff-preview'));
  changedRow.blur();
  // Escape leaves the row usable by click, including touch devices.
  changedRow.click();
  await until(() => document.querySelector('.turn-saved-diff .file-diff-head'));
  assert(document.querySelectorAll('.turn-saved-diff .file-diff-head').length === 1 && document.querySelector('.turn-saved-diff .file-diff-head')?.textContent?.includes("saved.ts"), "File click opened the entire turn instead of the selected file");
  button("Hide diff").click(); await until(() => !document.querySelector('.turn-saved-diff'));
  const binaryRow = document.querySelectorAll<HTMLButtonElement>('.changed-file-row')[1]!;
  binaryRow.focus();
  // This window stays hidden. Chromium updates activeElement but suppresses
  // native focus events while unfocused; deliver the event without stealing
  // focus from the developer's actual app.
  if (!document.hasFocus()) binaryRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await until(() => document.querySelector('.saved-diff-preview')?.textContent?.includes("Binary file changed"));
  binaryRow.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
  assert(document.activeElement?.textContent === "Open file diff", "Keyboard could not enter the preview");
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await until(() => !document.querySelector('.saved-diff-preview'));
  assert(document.activeElement === binaryRow, "Escape did not return focus to the file");
  binaryRow.blur(); changedRow.focus();
  if (!document.hasFocus()) changedRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true, relatedTarget: binaryRow }));
  await until(() => document.querySelector('.saved-diff-preview'));
  button("Open file diff").click();
  await until(() => document.querySelector('.turn-saved-diff') && !document.querySelector('.saved-diff-preview'));
  assert(document.querySelectorAll('.turn-saved-diff .file-diff-head').length === 1, "Preview action did not open the selected file");
  button("All changed files").click();
  await until(() => document.querySelectorAll('.turn-saved-diff .file-diff-head').length === 2);
  button("Hide diff").click(); await until(() => !document.querySelector('.turn-saved-diff'));
  changedRow.focus();
  if (!document.hasFocus()) changedRow.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await until(() => document.querySelector('.saved-diff-preview'));
  root.render(<TurnOutcome run={{ ...outcomeRun, id: "different-run", checkpointRef: undefined }} />);
  await until(() => !document.querySelector('.saved-diff-preview'));
  assert(!document.body.textContent?.includes("saved0"), "Previous turn's hover contents leaked into another run");
  (document.getElementById("composer-test-styles") as HTMLStyleElement).media = "not all";
  root.unmount(); root = createRoot(host);
  let logReads = 0;
  window.testWorkspace = { settings: {}, api: { listRunEventPage: async (_runId: string, before?: unknown) => {
    logReads++;
    return { events: [{ id: before ? "old" : "new", type: "error", timestamp: "2026-01-01T00:00:00Z", message: before ? "Earlier diagnostic" : "Recent diagnostic" }], hasMore: !before, before: before ? undefined : { timestamp: "2026-01-01T00:00:00Z", id: "new" } };
  } } };
  root.render(<RunEventLog runId="failed-run" failed />);
  await until(() => document.querySelector("summary"));
  assert(logReads === 0, "Closed log eagerly loaded its history");
  document.querySelector("summary")!.click(); await until(() => document.body.textContent?.includes("Recent diagnostic"));
  button("Older events").click(); await until(() => document.body.textContent?.includes("Earlier diagnostic"));
  assert(!document.body.textContent?.includes("Recent diagnostic"), "Log pagination retained the previous page");
  button("Newer events").click(); await until(() => document.body.textContent?.includes("Recent diagnostic"));
  root.unmount(); root = createRoot(host);
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
  let rejectSend: ((error: Error) => void) | undefined;
  let delayFailure = false;
  let projectReads = 0, historyReads = 0, eventReads = 0, artifactReads = 0;
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const emit = (event: string, payload: unknown) => { for (const callback of handlers.get(event) ?? []) callback(payload); };
  const savedRuns: Run[] = [];
  const savedEvents: RunEvent[] = [];
  const recent: ChatMessage[] = [];
  const older: ChatMessage[] = [];
  let holdEvents: ((rows: RunEvent[]) => void) | undefined;
  let deferEvents = false;
  const nativeApi = window.capsule;
  window.capsule = {
    listProjects: async () => { projectReads += 1; return [project]; }, listAgents: async () => [{ id: "general", name: "Fixture" }],
    listSkills: async () => [], listSkillPacks: async () => [], getStatus: async () => ({ kind: "openclaw", state: "connected" }),
    getSubsystemStatus: async () => ({}), listApprovals: async () => [], listHarnesses: async () => [],
    getSettings: async () => ({ ...DEFAULT_CAPSULE_SETTINGS, defaultMode: "chat", defaultAgentId: "general" }),
    listSessions: async () => [...threads], listHarnessSessions: async () => [], listRuns: async () => [...savedRuns],
    listRunEventPage: async () => { eventReads += 1; const events = deferEvents ? await new Promise<RunEvent[]>((resolve) => { holdEvents = resolve; }) : [...savedEvents]; return { events, hasMore: false }; },
    listArtifacts: async () => { artifactReads += 1; return [{ id: "saved-output", runId: "stream-run" }]; },
    gitStatus: async () => ({ isRepo: false }), listFiles: async () => [],
    validateAttachments: async (files: unknown[]) => files,
    on: (event: string, callback: (payload: unknown) => void) => {
      const callbacks = handlers.get(event) ?? new Set(); callbacks.add(callback); handlers.set(event, callbacks);
      return () => { callbacks.delete(callback); };
    },
    listMessagePage: async (_id: string, options: { before?: unknown }) => {
      historyReads += 1;
      if (failRead) { failRead = false; throw new Error("History read failed"); }
      return { messages: [...(options.before ? older : recent)], hasMore: !options.before && older.length > 0 };
    },
    createSession: async (input: Partial<Session>) => { const thread = { ...input, id: `send-thread-${threads.length}`, state: "active" } as Session; threads.push(thread); return thread; },
    sendMessage: async () => { sends += 1; if (failSend) throw new Error("Send rejected"); if (delayFailure) return new Promise<void>((_resolve, reject) => { rejectSend = reject; }); await new Promise<void>((resolve) => { finishSend = resolve; }); },
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
  actualWorkspace.setDraft("recover this submission"); await until(() => actualWorkspace.draft === "recover this submission");
  delayFailure = true;
  const failing = actualWorkspace.send(); await until(() => Boolean(rejectSend));
  actualWorkspace.setDraft("new work typed while waiting");
  await actualWorkspace.attachFiles(["/fixture/new.txt"]);
  await until(() => actualWorkspace.draft === "new work typed while waiting");
  rejectSend!(new Error("Offline")); await failing; delayFailure = false;
  await until(() => actualWorkspace.notice?.includes("saved in Stash"));
  assert(actualWorkspace.draft === "new work typed while waiting" && actualWorkspace.attachments[0]?.name === "new.txt", "Rejected send overwrote the new draft or attachments");
  assert(actualWorkspace.promptStashes.some((stash) => stash.prompt === "recover this submission"), "Failed submission was not recoverable");

  await new Promise((resolve) => setTimeout(resolve, 100));
  const baseline = { projectReads, historyReads, eventReads, artifactReads };
  const running: Run = { id: "stream-run", sessionId: actualWorkspace.sessionId!, projectId: project.id, agentId: "general", status: "running", prompt: "large edit", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
  emit("run", running);
  const streamed: RunEvent[] = Array.from({ length: 1_000 }, (_, index) => ({ id: `event-${index}`, runId: running.id, sessionId: running.sessionId, timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(), type: "tool-output", message: `Output ${index}` }));
  for (const frame of streamed) emit("run", frame);
  await until(() => actualWorkspace.events.length === 1_000);
  assert(projectReads === baseline.projectReads && historyReads === baseline.historyReads && eventReads === baseline.eventReads, "Streaming reloaded workspace/history/event snapshots");
  emit("run", streamed[0]);
  emit("run", { ...streamed[0], id: "foreign-event", runId: "foreign-run", sessionId: "foreign-thread" });
  const done = { ...running, status: "completed" as const, updatedAt: "2026-01-01T00:30:00Z", completedAt: "2026-01-01T00:30:00Z" };
  emit("run", done);
  await until(() => actualWorkspace.runs[0]?.completedAt && artifactReads === baseline.artifactReads + 1);
  assert(actualWorkspace.events.length === 1_000, "Duplicate or background frames contaminated the thread");
  assert(projectReads === baseline.projectReads && historyReads === baseline.historyReads, "Completion reloaded the workspace");

  savedRuns.push(done); savedEvents.push(...streamed.slice(0, 10));
  recent.push({ id: "recent", sessionId: running.sessionId, role: "assistant", content: "Recent result", createdAt: "2026-01-01T00:30:00Z" });
  older.push({ ...recent[0]!, id: "older", content: "Older result", createdAt: "2025-12-31T00:00:00Z" });
  emit("connection", {});
  await until(() => actualWorkspace.messages.some((message) => message.id === "recent"));
  await actualWorkspace.loadOlderMessages();
  await until(() => actualWorkspace.messages.some((message) => message.id === "older"));
  deferEvents = true; emit("connection", {}); await until(() => Boolean(holdEvents));
  const late = { ...streamed[0]!, id: "late-event", message: "Late output" };
  emit("run", late);
  holdEvents!([...savedEvents]); deferEvents = false;
  await until(() => actualWorkspace.events.some((event) => event.id === "late-event"));
  assert(actualWorkspace.events.length === 1_000 && actualWorkspace.events[0]?.data?.earlierEvents, "Snapshot did not retain a bounded, disclosed live-event window");
  assert(actualWorkspace.messages.some((message) => message.id === "older") && !actualWorkspace.hasOlderMessages, "Reconnect discarded older pages or reset their cursor");
  assert(actualWorkspace.artifacts.length === 1, "Saved artifacts did not load");
  emit("run", { ...running, id: "next-run", createdAt: "2026-01-02T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" });
  await until(() => actualWorkspace.runs[0]?.id === "next-run" && actualWorkspace.events.length === 0);
  assert(actualWorkspace.artifacts.length === 0, "Previous turn artifacts followed the new run");
  let stopCalls = 0;
  let rejectStop!: (error: Error) => void;
  window.capsule.stopRun = async () => { stopCalls++; await new Promise<void>((_resolve, reject) => { rejectStop = reject; }); };
  const stopping = actualWorkspace.stopRun();
  await until(() => actualWorkspace.stoppingRunIds.includes("next-run"));
  await actualWorkspace.stopRun();
  assert(stopCalls === 1 && actualWorkspace.activeRun?.status === "running", "Stop duplicated the request or prematurely ended the run");
  rejectStop(new Error("Runtime did not stop")); await stopping;
  await until(() => !actualWorkspace.stoppingRunIds.length && actualWorkspace.notice?.includes("Runtime did not stop"));
  assert(actualWorkspace.activeRun?.status === "running", "Rejected stop claimed the agent had ended");
  emit("state", { command: "open-browser", url: "https://example.test/agent" });
  await until(() => actualWorkspace.inspectorOpen && actualWorkspace.inspectorTab === "browser" && actualWorkspace.browserUrl === "https://example.test/agent");
  window.testWorkspace = { ...actualWorkspace, draft: "", attachments: [], activeRun: undefined, busy: false, session: undefined, sessionId: undefined,
    git: { isRepo: true, branch: "feature/a-deliberately-long-branch-name", branches: ["main", "feature/a-deliberately-long-branch-name"], dirty: true },
  };
  root.unmount(); root = createRoot(host);
  (document.getElementById("pet-test-styles") as HTMLStyleElement).media = "not all";
  (document.getElementById("composer-test-styles") as HTMLStyleElement).media = "all";
  host.style.width = "360px";
  root.render(<Composer />);
  await until(() => document.querySelector('.composer-options-overflow') && getComputedStyle(document.querySelector('.composer-options-overflow')!).display === "block");
  const controls = document.querySelector('.composer-controls')!.getBoundingClientRect();
  const actions = document.querySelector('.composer-actions-right')!.getBoundingClientRect();
  assert(controls.right <= actions.left + 1, "Compact composer controls overlap send/attachment actions");
  assert(getComputedStyle(document.querySelector('.composer-options-inline')!).display === "none", "Compact composer left redundant settings in the toolbar");
  const glass = document.querySelector('.composer-glass')!.getBoundingClientRect();
  const context = document.querySelector('.composer-context')!.getBoundingClientRect();
  assert(context.width < glass.width && context.top < glass.bottom, "Workspace strip is not inset beneath the composer");
  assert(context.height < 64, "Compact repository context wrapped into multiple rows");
  (document.querySelector('[aria-label="Composer options"]') as HTMLButtonElement).click();
  await until(() => document.querySelector('[role="listbox"]'));
  const popup = document.querySelector('[role="listbox"]')!.getBoundingClientRect();
  assert(popup.left >= 0 && popup.top >= 0 && popup.right <= innerWidth + 1 && popup.bottom <= innerHeight + 1, "Overflow menu escaped the viewport");
  assert(document.querySelector('[role="listbox"]')!.textContent?.includes("Prompt stash"), "Compact composer lost prompt stash");
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  host.style.width = "900px";
  await until(() => getComputedStyle(document.querySelector('.composer-options-overflow')!).display === "none");
  assert(getComputedStyle(document.querySelector('.composer-options-inline')!).display === "flex", "Wide composer did not restore its controls");
  (document.querySelector('[aria-label="Conversation workspace"]') as HTMLButtonElement).click();
  await until(() => document.querySelector('[role="listbox"]'));
  assert(document.querySelector('[role="listbox"]')!.textContent?.includes("Change folder"), "Repository context lost the folder chooser");
  root.unmount(); root = createRoot(host); host.style.width = "360px";
  let connectionCalls = 0, detailReads = 0;
  const completed = { ...running, id: "completed-details", status: "completed", result: "Saved the requested changes." } as Run;
  window.testWorkspace = { ...window.testWorkspace,
    session: { id: completed.sessionId, projectId: project.id, workingDirectory: project.workingDirectory }, sessionId: completed.sessionId,
    agents: pickerAgents, harnesses: pickerHarnesses, agentId: "claude", ready: true, connected: false,
    status: { state: "disconnected", kind: "openclaw" }, sendBlockReason: GATEWAY_CONNECTION_REQUIRED,
    runs: [completed], steps: [{ id: "command-1", label: "Ran a command", status: "complete" }], events: [], messages: [
      { id: "details-prompt", runId: completed.id, sessionId: completed.sessionId, role: "user", content: completed.prompt, createdAt: completed.createdAt },
      { id: "details-reply", runId: completed.id, sessionId: completed.sessionId, role: "assistant", content: completed.result, createdAt: completed.updatedAt },
    ],
    api: { ...actualWorkspace.api,
      connectGateway: async () => { connectionCalls++; throw new Error("Gateway could not be reached"); },
      listRunEventPage: async () => { detailReads++; return { events: [], hasMore: false }; },
    },
  };
  root.render(<Conversation />);
  await until(() => document.querySelector('.gateway-recovery') && document.querySelector('.run-summary-header'));
  assert(document.querySelectorAll('.gateway-recovery').length === 1 && !document.querySelector('.composer-preflight'), "Gateway warning is duplicated across chat and composer");
  assert(!document.querySelector('.turn-verification') && !document.querySelector('.run-event-log'), "Completed turn still stacks unopened diagnostics and verification cards");
  assert(document.querySelector('.run-activity-state')?.textContent?.includes("not verified"), "Consolidation hid the unverified state");
  button("Connect").click();
  await until(() => document.querySelector('.gateway-recovery-error'));
  assert(connectionCalls === 1 && !button("Retry connection").disabled, "Failed connection was not recoverable");
  document.querySelector<HTMLButtonElement>('.run-summary-header')!.click();
  await until(() => document.querySelector('.turn-verification') && document.querySelector('.run-event-log'));
  assert(document.querySelector('[data-verification-run]')?.getAttribute('data-verification-run') === completed.id, "Expanded checks belong to another turn");
  const beforeLog = detailReads;
  document.querySelector<HTMLElement>('.run-event-log summary')!.click();
  await until(() => detailReads > beforeLog && document.querySelector('.run-event-log')?.textContent?.includes("No recorded events"));
  document.querySelector<HTMLButtonElement>('.run-summary-header')!.click();
  await until(() => document.querySelector('.run-summary-body')?.hasAttribute("hidden"));
  document.querySelector<HTMLButtonElement>('.run-summary-header')!.click();
  await until(() => !document.querySelector('.run-summary-body')?.hasAttribute("hidden"));
  assert(document.querySelector<HTMLDetailsElement>('.run-event-log')?.open && detailReads === beforeLog + 1, "Collapsing activity discarded diagnostic state or repeated its read");
  window.testWorkspace = { ...window.testWorkspace, sendBlockReason: undefined, harnesses: pickerHarnesses.map((item) => ({ ...item, runtimeRoute: "direct" })) };
  root.render(<Conversation />);
  await until(() => !document.querySelector('.gateway-recovery'));
  assert(!document.querySelector('.composer-preflight'), "Direct route is incorrectly blocked by Gateway recovery");
  root.unmount(); host.style.width = ""; window.capsule = nativeApi;
  return "Renderer regressions passed: recovery, editor ownership and memoization, browser navigation and discovery, bounded diff pages and review notes, terminal persistence, send admission, 1,000 stream frames without snapshot reloads, reconnect/history reconciliation.";
};
