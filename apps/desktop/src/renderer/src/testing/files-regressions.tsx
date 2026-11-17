import { createRoot } from "react-dom/client";
import type { FileEntry } from "@capsule/shared";
import { Inspector } from "../features/shell/Inspector";
import { FILES_FIND_EVENT } from "../lib/browser-find";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Files regression did not settle: ${check}\n${document.body.textContent?.slice(0, 1800)}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
function click(selector: string) {
  const target = document.querySelector<HTMLButtonElement>(selector);
  assert(target, `Missing Files control: ${selector}`);
  target.click();
}
const entry = (name: string): FileEntry => ({ name, path: name, type: "file" });
const preview = (name: string) => ({ path: name, kind: "text" as const, contents: `Contents of ${name}`, revision: "fixture", size: 20, truncated: false });

function fill(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
const row = (path: string) => document.querySelector<HTMLButtonElement>(`.panel-tree-item[data-path="${path}"]`);
const press = (target: Element, key: string) => target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
const folder = (name: string, path = name, ignored?: true): FileEntry => ({ name, path, type: "directory", ...(ignored ? { ignored } : {}) });

/** The tree's header, rows, marks and keys, against a folder with nesting and ignored entries. */
async function runTreeRegressions(host: HTMLElement, fixture: Record<string, unknown>, remount: () => ReturnType<typeof createRoot>) {
  const listings: Record<string, FileEntry[]> = {
    "": [folder("src"), folder("node_modules", "node_modules", true), folder(".git"), entry("package.json"), entry("AGENTS.md"), entry("LICENSE"), { ...entry(".env"), ignored: true }],
    src: [folder("lib", "src/lib"), { name: "app.tsx", path: "src/app.tsx", type: "file" }],
    "src/lib": [{ name: "util.ts", path: "src/lib/util.ts", type: "file" }],
    node_modules: [folder("left-pad", "node_modules/left-pad", true)],
  };
  let rootReads = 0;
  host.style.width = "340px";
  window.testWorkspace = { ...fixture, project: { id: "files-fixture", workingDirectory: "/fixture/main" },
    api: { ...(fixture.api as object),
      listFiles: async (_project: string, path?: string) => { if (!path) rootReads++; return listings[path ?? ""] ?? []; },
      searchFiles: async () => [{ name: "util.ts", path: "src/lib/util.ts", type: "file" }],
    } };
  remount().render(<Inspector />);
  await until(() => row("src") && row("package.json"));

  const search = document.querySelector<HTMLInputElement>(".panel-tree-search")!;
  assert(search.placeholder === "Search files" && search.closest(".panel-tree-head"), "Search field is not in the tree header");
  assert(document.querySelector('.panel-tree-head [aria-label="Refresh files"]'), "Tree header has no refresh");
  assert(document.querySelector('.panel-tree-head [aria-label="Expand all folders"]'), "Tree header has no expand-all toggle");
  assert(!row(".git"), "The .git folder is listed");
  assert(row("node_modules")?.classList.contains("ignored") && row(".env")?.classList.contains("ignored"), "Ignored entries are not marked");
  assert(getComputedStyle(row("node_modules")!).color !== getComputedStyle(row("src")!).color, "Ignored folder is not dimmed");
  assert(!row("src")!.querySelector(".panel-tree-icon"), "Folders carry a glyph beside the chevron");
  const icons = Object.fromEntries(["package.json", "AGENTS.md", "LICENSE"].map((path) => [path, row(path)?.querySelector("[data-file-icon]")?.getAttribute("data-file-icon")]));
  assert(JSON.stringify(icons) === JSON.stringify({ "package.json": "npm", "AGENTS.md": "agents", LICENSE: "file" }), `Wrong file marks: ${JSON.stringify(icons)}`);
  assert(row("package.json")!.querySelector("svg"), "File mark is not a drawn icon");
  assert(Math.round(row("src")!.getBoundingClientRect().height) === 24, `Tree rows are not 24px: ${row("src")!.getBoundingClientRect().height}`);

  const reads = rootReads;
  document.querySelector<HTMLButtonElement>('[aria-label="Refresh files"]')!.click();
  await until(() => rootReads > reads);

  // Right opens a folder, then steps into it; left steps back out, then closes it.
  row("src")!.focus();
  press(row("src")!, "ArrowRight");
  await until(() => row("src/app.tsx"));
  press(row("src")!, "ArrowRight");
  assert(document.activeElement === row("src/lib"), "Right on an open folder does not step into it");
  press(row("src/lib")!, "ArrowDown");
  assert(document.activeElement === row("src/app.tsx"), "Down does not move to the next row");
  press(row("src/app.tsx")!, "ArrowLeft");
  assert(document.activeElement === row("src"), "Left on a file does not step out to its folder");
  press(row("src")!, "ArrowLeft");
  await until(() => !row("src/app.tsx"));

  document.querySelector<HTMLButtonElement>('[aria-label="Expand all folders"]')!.click();
  await until(() => row("src/lib/util.ts"));
  assert(row("node_modules")!.getAttribute("aria-expanded") === "false", "Expand all opened an ignored folder");
  document.querySelector<HTMLButtonElement>('[aria-label="Collapse all folders"]')!.click();
  await until(() => !row("src/app.tsx") && document.querySelector('[aria-label="Expand all folders"]'));

  // A search lays its hits out in the tree they live in.
  fill(search, "util");
  await until(() => row("src/lib/util.ts"));
  assert(row("src")?.getAttribute("aria-expanded") === "true" && row("src/lib")?.getAttribute("aria-expanded") === "true", "Search hits are not shown inside their open folders");
  assert(!row("package.json"), "Search keeps non-matching files");
  press(search, "Escape");
  await until(() => row("package.json") && search.value === "");

  row("src")!.focus();
  window.dispatchEvent(new CustomEvent(FILES_FIND_EVENT));
  assert(document.activeElement === search, "Find in the Files tree does not focus its search");
}

/** Exercise the real inspector and CSS, without reading any user's files. */
export async function runFilesRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const styles = document.querySelector<HTMLStyleElement>("#composer-test-styles")!;
  const previousMedia = styles.media;
  const previousWidth = localStorage.getItem("capsule.inspectorWidth");
  const previousHost = host.style.cssText;
  styles.media = "all";
  localStorage.setItem("capsule.inspectorWidth", "340");
  host.style.cssText = "width:340px;height:600px;display:flex;position:relative";
  let root = createRoot(host);
  let completePreview!: (value: ReturnType<typeof preview>) => void;
  let rejectExtra!: (error: Error) => void;
  let failExtra = true;
  let opened = 0;
  let closedPanel = false;
  const fixture = { ...base, inspectorTab: "files", inspectorOpen: true, requestedFile: undefined,
    projectId: "files-fixture", project: { id: "files-fixture", workingDirectory: "/fixture/main", extraFolders: ["/fixture/extra"] },
    session: { id: "files-thread" }, files: [entry("primary-only.ts")],
    setInspectorTab: () => {}, setInspectorOpen: () => { opened++; }, toggleInspector: () => { closedPanel = true; },
    api: { ...(base.api as object),
      listFiles: async (_project: string, _path: string, folder: string) => {
        if (folder === "/fixture/extra" && failExtra) return new Promise<FileEntry[]>((_resolve, reject) => { rejectExtra = reject; });
        return [entry(folder === "/fixture/extra" ? "extra-only.ts" : "primary-only.ts"), entry("slow.ts")];
      },
      previewFile: async (_project: string, name: string) => name === "slow.ts"
        ? new Promise<ReturnType<typeof preview>>((resolve) => { completePreview = resolve; }) : preview(name),
    },
  };
  try {
    window.testWorkspace = fixture;
    root.render(<Inspector />);
    await until(() => document.querySelector(".panel-files-workspace.compact") && document.querySelector('.panel-tree-item[title="primary-only.ts"]'));
    const pane = document.querySelector<HTMLElement>(".panel-file-preview-pane")!;
    const tree = document.querySelector<HTMLElement>(".panel-file-tree-pane")!;
    const search = document.querySelector<HTMLInputElement>(".panel-tree-search")!;
    assert(getComputedStyle(search).borderTopWidth === "0px", "Generic inspector input styling overrides the file search field");
    assert(getComputedStyle(pane).display === "none", "Narrow file tree paints over the empty preview");
    assert(tree.clientWidth >= 335 && tree.scrollWidth <= tree.clientWidth, "Narrow file tree does not own its full width");
    click('.panel-tree-item[title="primary-only.ts"]');
    await until(() => document.querySelector(".file-preview-code") && !document.querySelector(".panel-file-tree-pane"));
    assert(getComputedStyle(pane).display !== "none", "Selected file remains hidden behind navigation");
    click('[aria-label="Toggle workspace tree"]');
    await until(() => document.querySelector(".panel-file-tree-pane"));

    // An extra folder must never borrow the primary folder's rows, even while
    // its first read is pending or fails.
    Array.from(document.querySelectorAll<HTMLButtonElement>(".files-roots button")).find((item) => item.textContent === "extra")!.click();
    await until(() => rejectExtra);
    assert(!document.querySelector('.panel-tree-item[title="primary-only.ts"]'), "Extra folder borrowed primary-root rows");
    assert(document.body.textContent?.includes("Loading files"), "Pending folder read looks empty");
    rejectExtra(new Error("Fixture folder unavailable"));
    await until(() => document.body.textContent?.includes("Could not refresh files"));
    assert(!document.body.textContent?.includes("Folder is empty"), "Failed folder read looks empty");
    failExtra = false;
    click('.panel-tree-empty button');
    await until(() => document.querySelector('.panel-tree-item[title="extra-only.ts"]'));

    // A late read cannot reopen a panel the person closed. The app unmounts a closed panel.
    click('.panel-tree-item[title="slow.ts"]');
    await until(() => completePreview);
    click('[aria-label="Close panel"]');
    assert(closedPanel, "Close did not close the panel");
    root.unmount(); root = createRoot(host);
    const beforeClose = opened;
    completePreview(preview("slow.ts"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(opened === beforeClose, "Late preview reopened a closed panel");

    root.unmount(); root = createRoot(host);
    window.testWorkspace = fixture;
    root.render(<Inspector />);
    await until(() => document.querySelector('.panel-tree-item[title="slow.ts"]'));
    click('.panel-tree-item[title="slow.ts"]');
    root.unmount(); root = createRoot(host);
    completePreview(preview("slow.ts"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(opened === beforeClose, "Late preview reopened an unmounted inspector");

    // Maximize must use actual geometry rather than the saved narrow width.
    window.testWorkspace = fixture;
    root.render(<Inspector />);
    await until(() => document.querySelector(".panel-files-workspace.compact"));
    host.style.width = "800px";
    click('[aria-label="Maximize panel"]');
    await until(() => !document.querySelector(".panel-files-workspace.compact"));
    for (const fontSize of [16, 20]) {
      document.documentElement.style.fontSize = `${fontSize}px`;
      const empty = document.querySelector(".panel-empty-file-state")!;
      const fileTree = document.querySelector(".panel-file-tree-pane")!;
      assert(empty.getBoundingClientRect().right <= fileTree.getBoundingClientRect().left + 1, "Empty preview crosses the file tree divider");
      for (const child of Array.from(empty.children)) {
        assert(child.getBoundingClientRect().right <= fileTree.getBoundingClientRect().left + 1, "Empty-state content overflows into the tree");
      }
    }
    document.documentElement.style.removeProperty("font-size");
    await runTreeRegressions(host, fixture, () => { root.unmount(); root = createRoot(host); return root; });
  } finally {
    root.unmount();
    styles.media = previousMedia;
    host.style.cssText = previousHost;
    document.documentElement.style.removeProperty("font-size");
    if (previousWidth === null) localStorage.removeItem("capsule.inspectorWidth");
    else localStorage.setItem("capsule.inspectorWidth", previousWidth);
  }
}
