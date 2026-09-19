import { createRoot } from "react-dom/client";
import type { FileEntry } from "@capsule/shared";
import { Inspector } from "../features/shell/Inspector";

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
  const fixture = { ...base, inspectorTab: "files", inspectorOpen: true, requestedFile: undefined,
    projectId: "files-fixture", project: { id: "files-fixture", workingDirectory: "/fixture/main", extraFolders: ["/fixture/extra"] },
    session: { id: "files-thread" }, files: [entry("primary-only.ts")],
    setInspectorTab: () => {}, setInspectorOpen: () => { opened++; },
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
    await until(() => document.querySelector(".codex-files-workspace.compact") && document.querySelector('.codex-tree-item[title="primary-only.ts"]'));
    const pane = document.querySelector<HTMLElement>(".codex-file-preview-pane")!;
    const tree = document.querySelector<HTMLElement>(".codex-file-tree-pane")!;
    const search = document.querySelector<HTMLInputElement>(".codex-tree-search")!;
    assert(getComputedStyle(search).borderTopWidth === "0px", "Generic inspector input styling overrides the file search field");
    assert(getComputedStyle(pane).display === "none", "Narrow file tree paints over the empty preview");
    assert(tree.clientWidth >= 335 && tree.scrollWidth <= tree.clientWidth, "Narrow file tree does not own its full width");
    click('.codex-tree-item[title="primary-only.ts"]');
    await until(() => document.querySelector(".file-preview-code") && !document.querySelector(".codex-file-tree-pane"));
    assert(getComputedStyle(pane).display !== "none", "Selected file remains hidden behind navigation");
    click('[aria-label="Toggle workspace tree"]');
    await until(() => document.querySelector(".codex-file-tree-pane"));

    // An extra folder must never borrow the primary folder's rows, even while
    // its first read is pending or fails.
    Array.from(document.querySelectorAll<HTMLButtonElement>(".files-roots button")).find((item) => item.textContent === "extra")!.click();
    await until(() => rejectExtra);
    assert(!document.querySelector('.codex-tree-item[title="primary-only.ts"]'), "Extra folder borrowed primary-root rows");
    assert(document.body.textContent?.includes("Loading files"), "Pending folder read looks empty");
    rejectExtra(new Error("Fixture folder unavailable"));
    await until(() => document.body.textContent?.includes("Could not refresh files"));
    assert(!document.body.textContent?.includes("Folder is empty"), "Failed folder read looks empty");
    failExtra = false;
    click('.codex-tree-empty button');
    await until(() => document.querySelector('.codex-tree-item[title="extra-only.ts"]'));

    // Late reads cannot reopen a closed tab or a dismissed inspector.
    click('.codex-tree-item[title="slow.ts"]');
    await until(() => completePreview);
    click('.codex-tab-close');
    await until(() => document.querySelector(".codex-launcher"));
    const beforeClose = opened;
    completePreview(preview("slow.ts"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(document.querySelector(".codex-launcher") && opened === beforeClose, "Late preview reopened a closed Files tab");

    root.unmount(); root = createRoot(host);
    window.testWorkspace = fixture;
    root.render(<Inspector />);
    await until(() => document.querySelector('.codex-tree-item[title="slow.ts"]'));
    click('.codex-tree-item[title="slow.ts"]');
    root.unmount(); root = createRoot(host);
    completePreview(preview("slow.ts"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(opened === beforeClose, "Late preview reopened an unmounted inspector");

    // Maximize must use actual geometry rather than the saved narrow width.
    window.testWorkspace = fixture;
    root.render(<Inspector />);
    await until(() => document.querySelector(".codex-files-workspace.compact"));
    host.style.width = "800px";
    click('[aria-label="Maximize panel"]');
    await until(() => !document.querySelector(".codex-files-workspace.compact"));
    for (const fontSize of [16, 20]) {
      document.documentElement.style.fontSize = `${fontSize}px`;
      const empty = document.querySelector(".codex-empty-file-state")!;
      const fileTree = document.querySelector(".codex-file-tree-pane")!;
      assert(empty.getBoundingClientRect().right <= fileTree.getBoundingClientRect().left + 1, "Empty preview crosses the file tree divider");
      for (const child of Array.from(empty.children)) {
        assert(child.getBoundingClientRect().right <= fileTree.getBoundingClientRect().left + 1, "Empty-state content overflows into the tree");
      }
    }
  } finally {
    root.unmount();
    styles.media = previousMedia;
    host.style.cssText = previousHost;
    document.documentElement.style.removeProperty("font-size");
    if (previousWidth === null) localStorage.removeItem("capsule.inspectorWidth");
    else localStorage.setItem("capsule.inspectorWidth", previousWidth);
  }
}
