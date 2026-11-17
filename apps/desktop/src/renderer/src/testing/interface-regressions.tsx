import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchDialog, type SearchDialogItem } from "../features/shell/SearchDialog";
import { Palette } from "../features/shell/Palette";
import { FilePicker } from "../features/shell/FilePicker";
import { Sidebar } from "../features/shell/Sidebar";
import { ToastProvider, useToasts, type Toast } from "../lib/toasts";
import type { UpdateCheck } from "@capsule/shared";
import { CopyButton } from "../features/conversation/CopyButton";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const end = performance.now() + 3000;
  while (!check()) {
    if (performance.now() > end) throw new Error(`Interface did not settle: ${check.toString()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
function fill(selector: string, value: string) {
  const input = document.querySelector<HTMLInputElement>(selector)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
function key(element: Element, value: string) {
  const event = new KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}
function PaletteFixture({ base }: { base: Record<string, unknown> }) {
  const [query, setQuery] = useState("");
  window.testWorkspace = { runs: [], ...base, palette: true, paletteQuery: query, setPaletteQuery: setQuery };
  return <Palette />;
}

/** Actual controls, not look-alike fixture rows: exercise async ownership and keyboard focus. */
export async function runInterfaceRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const originalWorkspace = window.testWorkspace;
  const originalApi = window.capsule;
  const clipboard = Object.getOwnPropertyDescriptor(navigator.clipboard, "writeText");
  const theme = document.documentElement.getAttribute("data-theme");
  const root = createRoot(host);
  try {
    let selected = "", closed = 0;
    const items: SearchDialogItem[] = Array.from({ length: 40 }, (_, index) => ({
      id: String(index), label: `Result ${index}`, detail: `src/a-long-folder-name/component-${index}.tsx`, group: "Files",
      onSelect: () => { selected = String(index); },
    }));
    const renderSearch = (entries = items) => root.render(<SearchDialog title="Find" placeholder="Find files" query=""
      onQueryChange={() => {}} items={entries} empty="Nothing found" onClose={() => { closed++; }} />);
    renderSearch([]);
    await until(() => document.querySelector('[role="combobox"]') === document.activeElement);
    key(document.activeElement!, "ArrowDown");
    renderSearch();
    await until(() => document.querySelectorAll('[role="option"]').length === 40);
    assert(document.querySelector('[role="option"][aria-selected="true"]')?.textContent?.includes("Result 0"), "Empty search left a negative selection index");
    key(document.activeElement!, "End");
    await until(() => document.querySelector('[aria-selected="true"]')?.textContent?.includes("Result 39"));
    // Scrolling or resizing rows beneath a stationary pointer must not steal
    // the keyboard selection. Chromium can emit hover events during layout.
    const firstResult = document.querySelector('[role="option"]')!;
    firstResult.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    firstResult.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" }));
    await settle();
    assert(document.querySelector('[aria-selected="true"]')?.textContent?.includes("Result 39"), "Stationary pointer replaced the keyboard search selection");
    for (const nextTheme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", nextTheme);
      for (const font of [16, 20]) {
        document.documentElement.style.fontSize = `${font}px`;
        for (const width of [320, 640]) {
          const dialog = document.querySelector<HTMLElement>(".search-dialog")!;
          dialog.style.width = `${width}px`;
          renderSearch();
          await settle();
          assert(document.querySelector('[aria-selected="true"]')?.textContent?.includes("Result 39"), `Layout changed the keyboard selection at ${width}px / ${font}px text`);
          const list = document.querySelector(".palette-list")!.getBoundingClientRect();
          const row = document.querySelector('[aria-selected="true"]')!.getBoundingClientRect();
          assert(row.top >= list.top - 1 && row.bottom <= list.bottom + 1, `Keyboard selection is clipped at ${width}px / ${font}px text: row ${row.top}–${row.bottom}, list ${list.top}–${list.bottom}`);
          assert(dialog.scrollWidth <= dialog.clientWidth + 1, "Search dialog overflows at larger text or narrow widths");
          assert(dialog.getBoundingClientRect().bottom <= innerHeight + 1, "Search dialog exceeds viewport height");
        }
      }
    }
    firstResult.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse", movementY: 1 }));
    await until(() => document.querySelector('[aria-selected="true"]')?.textContent?.includes("Result 0"));
    key(document.activeElement!, "End");
    await until(() => document.querySelector('[aria-selected="true"]')?.textContent?.includes("Result 39"));
    key(document.activeElement!, "Enter");
    await until(() => closed === 1);
    assert(selected === "39", "Keyboard search selected the wrong row");
    document.documentElement.style.removeProperty("font-size");

    // A clipboard rejection must not claim success, and retry must remain usable.
    let writes = 0;
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: async (text: string) => {
      writes++;
      assert(text === "Saved reply", "Clipboard received the wrong content");
      if (writes === 1) throw new Error("Clipboard unavailable");
    } });
    root.render(<CopyButton text="Saved reply" />);
    await until(() => document.querySelector('[aria-label="Copy message"]'));
    document.querySelector<HTMLButtonElement>('[aria-label="Copy message"]')!.click();
    await until(() => document.querySelector('.copy-action [role="status"]')?.textContent === "Copy failed · retry");
    document.querySelector<HTMLButtonElement>('[aria-label="Retry copy message"]')!.click();
    await until(() => document.querySelector('.copy-action [role="status"]')?.textContent === "Copied");
    assert(writes === 2, "Clipboard retry was lost");

    let resolveOld!: (value: unknown) => void;
    let failSearch = true;
    const searchApi = { ...originalApi, isDesktop: false, search: async (query: string) => {
      if (query === "older") return new Promise((resolve) => { resolveOld = resolve; });
      if (query === "retry" && failSearch) throw new Error("Search unavailable");
      return { messages: [{ id: query, sessionTitle: `Found ${query}`, excerpt: "A saved message", projectId: "project", sessionId: "thread" }] };
    } };
    root.render(<PaletteFixture base={{ ...base, api: searchApi, projects: [], sessions: [] }} />);
    await until(() => document.querySelector('[aria-label="Search workspace"]'));
    const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'));
    assert(!options().some((option) => option.getAttribute("aria-disabled") === "true"), "The empty palette lists rows that cannot run here");
    fill('[role="combobox"]', "new conv");
    await until(() => options().some((option) => option.textContent?.startsWith("New conversation")));
    const creation = options().find((option) => option.textContent?.startsWith("New conversation"));
    assert(creation?.getAttribute("aria-disabled") === "true" && creation.textContent?.includes("Read only on this device."), "Viewer offers creation without explaining availability");
    fill('[role="combobox"]', "older");
    await until(() => resolveOld);
    fill('[role="combobox"]', "newer");
    await until(() => document.body.textContent?.includes("Found newer"));
    resolveOld({ messages: [{ id: "old", sessionTitle: "Wrong old result" }] });
    await settle();
    assert(!document.body.textContent?.includes("Wrong old result"), "Late workspace search replaced the current query");
    fill('[role="combobox"]', "retry");
    await until(() => document.querySelector('[role="alert"]')?.textContent?.includes("Search unavailable"));
    failSearch = false;
    document.querySelector<HTMLButtonElement>('.search-dialog-feedback button')!.click();
    await until(() => document.body.textContent?.includes("Found retry"));

    // File discovery belongs to the selected checkout, even within one project.
    let oldFiles!: (value: unknown) => void;
    let fileReads = 0, attached = "";
    const paths: string[] = [];
    window.capsule = { ...originalApi, searchFiles: async (_id: string, _query: string, directory?: string) => {
      paths.push(directory ?? ""); fileReads++;
      if (fileReads === 1) return new Promise((resolve) => { oldFiles = resolve; });
      if (fileReads === 2) throw new Error("Checkout unavailable");
      return [{ name: "current.ts", path: "src/current.ts", type: "file" }];
    } } as typeof originalApi;
    window.testWorkspace = { ...base, api: window.capsule, filePicker: true, projectId: "project",
      project: { id: "project", workingDirectory: "/project" }, session: { id: "first", projectId: "project", workingDirectory: "/checkout/first" },
      mentionFile: (path: string) => { attached = path; }, setFilePicker: () => {},
    };
    root.render(<FilePicker />);
    await until(() => oldFiles);
    assert(document.body.textContent?.includes("Searching this checkout"), "File search looks empty while loading");
    window.testWorkspace = { ...window.testWorkspace, session: { id: "second", projectId: "project", workingDirectory: "/checkout/second" } };
    root.render(<FilePicker />);
    await until(() => document.body.textContent?.includes("Checkout unavailable"));
    oldFiles([{ name: "wrong.ts", path: "wrong.ts", type: "file" }]);
    await settle();
    assert(!document.body.textContent?.includes("wrong.ts"), "Previous checkout's files leaked into this picker");
    document.querySelector<HTMLButtonElement>('.search-dialog-feedback button')!.click();
    await until(() => document.querySelector('[role="option"]')?.textContent?.includes("current.ts"));
    assert(paths.join(",") === "/checkout/first,/checkout/second,/checkout/second", "File picker searched the project root instead of the worktree");
    key(document.querySelector('[role="combobox"]')!, "Enter");
    await until(() => attached === "src/current.ts");

    let navigations = 0;
    window.capsule = { ...originalApi, showContextMenu: undefined } as unknown as typeof originalApi;
    window.testWorkspace = { ...base, api: { ...base.api as object, on: () => () => {}, updateStatus: async () => ({ state: "current" }) },
      view: "chat", ready: true, projects: [{ id: "project", name: "Example workspace" }],
      sessions: [{ id: "thread", projectId: "project", title: "Review accessibility", state: "active", updatedAt: "2026-01-01T00:00:00Z" }],
      projectId: "project", sessionId: "thread", projectRuns: [], approvals: [], sidebarCollapsed: false,
      setProjectId: () => { navigations++; }, setView: () => {},
    };
    const renderSidebar = () => root.render(<><Sidebar /><div className="workspace"><button data-sidebar-control>Show sidebar</button></div></>);
    renderSidebar();
    await until(() => document.querySelector('[aria-label="Search conversations"]'));
    fill('[aria-label="Search conversations"]', "Example");
    await until(() => document.querySelector<HTMLInputElement>('[aria-label="Search conversations"]')?.value === "Example");
    assert(document.querySelector('[data-thread-item]') && !document.body.textContent?.includes("No conversations"), "Searching a project name hides all its conversations");
    const more = document.querySelector<HTMLButtonElement>('[aria-label="Conversation actions"]')!;
    more.focus();
    for (const value of ["Enter", " "]) {
      assert(!key(more, value).defaultPrevented && navigations === 0, "Thread row swallowed its child action's keyboard activation");
    }
    more.click();
    await until(() => document.querySelector('[role="menu"]'));
    window.testWorkspace = { ...window.testWorkspace, sidebarCollapsed: true };
    renderSidebar();
    await until(() => document.querySelector("aside")?.inert);
    assert(!document.querySelector('[role="menu"]'), "Collapsing sidebar left its menu floating over the workspace");
    document.querySelector<HTMLInputElement>('[aria-label="Search conversations"]')!.focus();
    assert(!document.querySelector("aside")!.contains(document.activeElement), "Collapsed sidebar still accepts keyboard focus");
    window.testWorkspace = { ...window.testWorkspace, sidebarCollapsed: false };
    renderSidebar();
    await until(() => !document.querySelector("aside")?.inert);
    document.querySelector<HTMLInputElement>('[aria-label="Search conversations"]')!.focus();
    assert(document.activeElement?.getAttribute("aria-label") === "Search conversations", "Expanded sidebar did not restore keyboard access");
    window.testWorkspace = { ...window.testWorkspace, sidebarCollapsed: true };
    renderSidebar();
    await until(() => document.activeElement === document.querySelector('.workspace [data-sidebar-control]'));
    window.testWorkspace = { ...window.testWorkspace, view: "settings" };
    renderSidebar();
    await until(() => document.querySelector('[aria-label="Search settings"]'));
    assert(document.querySelector("aside")?.inert, "Settings sidebar omitted collapsed keyboard isolation");

    // The footer's one update control: its glyph and tooltip carry the state,
    // the footer holds no update text, and only a user action raises a toast.
    let update: UpdateCheck = { state: "update-available", current: "0.13.0", latest: "0.14.0", canInstall: true };
    let updateEvent: (payload: unknown) => void = () => {};
    let checks = 0, downloads = 0, confirmTitle = "";
    const restoredIds: string[] = [];
    let toasts: Toast[] = [];
    const ToastCapture = () => { toasts = useToasts().toasts; return null; };
    const sidebarWorkspace = window.testWorkspace as Record<string, unknown>;
    const renderUpdates = (isDesktop = true) => {
      window.testWorkspace = { ...sidebarWorkspace, view: "chat", sidebarCollapsed: false,
        setConfirm: (value: { title: string }) => { confirmTitle = value.title; },
        api: { ...sidebarWorkspace.api as object, isDesktop,
          on: (_name: string, handler: typeof updateEvent) => { updateEvent = handler; return () => {}; },
          updateStatus: async () => update,
          checkForUpdates: async () => { checks++; return update; },
          downloadUpdate: async () => { downloads++; update = { ...update, state: "ready-to-install" }; return update; },
        } };
      root.render(<ToastProvider><Sidebar /><ToastCapture /></ToastProvider>);
    };
    const updateButton = () => document.querySelector<HTMLButtonElement>(".update-button");
    renderUpdates();
    await until(() => updateButton()?.dataset.updateState === "available");
    assert(updateButton()!.title === "Update 0.14.0 ready to download", "Available update tooltip did not name the version");
    assert(!document.querySelector(".sidebar-footer")!.textContent?.includes("0.14.0"), "Sidebar footer still prints update text");
    updateButton()!.click();
    await until(() => updateButton()?.dataset.updateState === "ready");
    assert(downloads === 1, "Available update did not download from the sidebar");
    await until(() => toasts.some((toast) => toast.title === "Capsule 0.14.0 downloaded" && toast.action?.label === "Release notes"));
    updateButton()!.click();
    assert(confirmTitle === "Install Capsule 0.14.0 and restart?", "Restart did not ask first, naming the version");

    update = { state: "unreachable", current: "0.13.0", development: true, detail: "This is a development build." };
    updateEvent({ command: "update-status" });
    await until(() => updateButton()?.getAttribute("aria-disabled") === "true");
    assert(updateButton()!.title === "Updates unavailable: This is a development build.", "Development build did not explain the disabled control");
    updateButton()!.click();
    await settle();
    assert(checks === 0, "Disabled update control still started a check");

    update = { state: "up-to-date", current: "0.13.0" };
    updateEvent({ command: "update-status" });
    await until(() => updateButton()?.dataset.updateState === "idle" && !updateButton()!.hasAttribute("aria-disabled"));
    updateButton()!.click();
    await until(() => toasts.some((toast) => toast.title === "You’re up to date"));
    assert(Number(checks) === 1, "Check for updates did not run");

    renderUpdates(false);
    await until(() => document.querySelector(".sidebar-footer") && !updateButton()).catch(() => undefined);
    assert(!updateButton(), "A paired device can drive the host's update");

    // The palette: one header per group, recent threads first with their age,
    // a named target for New conversation, ">" for commands only, and an
    // update row that runs the same check as the sidebar control.
    const paletteApi = { ...sidebarWorkspace.api as object, isDesktop: true, on: () => () => {}, updateStatus: async () => update,
      checkForUpdates: async () => { checks++; return update; }, search: async () => ({ sessions: [], messages: [] }) };
    root.render(<ToastProvider><PaletteFixture base={{ ...base, api: paletteApi, setPalette: () => {}, session: undefined, sessionId: undefined,
      project: { id: "project", name: "Example workspace" }, projects: [{ id: "project", name: "Example workspace" }],
      sessions: [{ id: "thread", projectId: "project", title: "Review accessibility", state: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" },
        { id: "shelved", projectId: "project", title: "An archived thread", state: "archived", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }],
      restoreSession: async (id: string) => { restoredIds.push(id); }, setProjectId: () => {}, setView: () => {} }} /><ToastCapture /></ToastProvider>);
    await until(() => document.querySelector('[aria-label="Search workspace"]'));
    const headers = Array.from(document.querySelectorAll(".search-dialog-section"), (node) => node.textContent);
    assert(headers[0] === "Recent conversations" && new Set(headers).size === headers.length, `Palette groups repeat or recent conversations do not lead: ${headers.join(", ")}`);
    assert(document.querySelector('[role="option"] .search-dialog-meta')?.textContent, "Recent conversation rows do not say how long ago they moved");
    assert(Array.from(document.querySelectorAll('[role="option"]')).some((option) => option.textContent?.startsWith("New conversation in Example workspace")), "New conversation does not name its project");
    fill('[role="combobox"]', ">review");
    await until(() => document.body.textContent?.includes("Review uncommitted changes"));
    assert(!document.body.textContent?.includes("Review accessibility"), "A leading > still lists conversations");
    fill('[role="combobox"]', "update");
    const updateRow = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent?.startsWith("Check for updates"));
    await until(updateRow);
    toasts = [];
    updateRow()!.click();
    await until(() => toasts.some((toast) => toast.title === "You’re up to date"));
    assert(Number(checks) === 2, "The palette's Check for updates did not start a check");
    fill('[role="combobox"]', "archived");
    const archivedRow = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent?.startsWith("Archived conversations"));
    await until(archivedRow);
    archivedRow()!.click();
    await until(() => document.querySelector('[role="dialog"][aria-label="Archived conversations"]'));
    const shelvedRow = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((option) => option.textContent?.startsWith("An archived thread"));
    await until(shelvedRow);
    shelvedRow()!.click();
    await until(() => restoredIds.includes("shelved"));
  } finally {
    root.unmount();
    if (clipboard) Object.defineProperty(navigator.clipboard, "writeText", clipboard);
    else delete (navigator.clipboard as unknown as Record<string, unknown>).writeText;
    window.testWorkspace = originalWorkspace;
    window.capsule = originalApi;
    document.documentElement.style.removeProperty("font-size");
    if (theme) document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
  }
}
