import { createRoot } from "react-dom/client";
import { parseUnifiedDiff } from "@capsule/shared";
import { ChangedFilesCard } from "../features/conversation/ChangedFilesCard";
import { FileDiff } from "../features/shell/FileDiff";
import { DiffView } from "../features/shell/DiffView";

const PREVIEW_FILES = ["src/conversation/activity.tsx", "src/conversation/activity.test.ts"];
const longImport = `import { ${Array.from({ length: 20 }, (_, i) => `Activity${i}`).join(", ")} } from "./activity";`;
const contextLines = Array.from({ length: 39 }, (_, i) => `${i % 3 === 0 ? "+" : " "}// Context line ${i}`).join("\n");
const previewPatch = PREVIEW_FILES.map((path) => [
  `diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`,
  "@@ -997,27 +997,40 @@", '-import { Activity } from "./activity";', `+${longImport}`, contextLines, "",
].join("\n")).join("");
const previewFile = parseUnifiedDiff(previewPatch)[0]!;

/** Synthetic long/short rows reproduce scroll and tint defects without user data. */
export function SavedDiffFixture() {
  return <ChangedFilesCard files={PREVIEW_FILES.map((path) => ({ path, action: "modified", added: 14, removed: 1 }))}
    patch={previewPatch} onOpenDiff={() => {}} />;
}

export async function focusSavedPreview(host: HTMLElement, index = 0) {
  const row = host.querySelectorAll<HTMLButtonElement>(".changed-file-row")[index]!;
  row.focus();
  if (!document.hasFocus()) row.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await until(() => document.querySelector(".saved-diff-preview-head")?.textContent?.includes(PREVIEW_FILES[index]!));
  return document.querySelector<HTMLElement>(".saved-diff-preview-code")!;
}

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const pause = (duration: number) => new Promise((resolve) => setTimeout(resolve, duration));
async function until(check: () => unknown) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Saved preview did not settle: ${check}`);
    await pause(10);
  }
}
function pointer(element: Element, type: "pointerover" | "pointerout", relatedTarget: Element | null = null) {
  element.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: "mouse", relatedTarget }));
}

function assertContrast(element: Element, background: string) {
  const luminance = (color: string) => {
    const values = color.match(/[\d.]+/g)!.slice(0, 3).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
  };
  const a = luminance(getComputedStyle(element).color), b = luminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert(ratio >= 4.5, `Diff text contrast is ${ratio.toFixed(2)}: ${element.className}`);
}

function assertCodeContrast(code: Element, background: string) {
  for (const token of [code, ...Array.from(code.querySelectorAll("span[class^=tok-]"))]) assertContrast(token, background);
}

/** Exercise lazy (summary-only) diffs, not just an already embedded patch. */
export async function runSavedPreviewRegressions(host: HTMLElement) {
  const root = createRoot(host);
  let reads = 0;
  const patch = "diff --git a/example.ts b/example.ts\n--- a/example.ts\n+++ b/example.ts\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n";
  const loadPatch = async () => { reads++; return { patch }; };
  const renderCard = () => root.render(<ChangedFilesCard
    files={[{ path: "example.ts", action: "modified", added: 1, removed: 1 }]}
    loadPatch={loadPatch} onOpenDiff={() => {}} />);
  try {
    renderCard();
    await until(() => host.querySelector(".changed-file-row"));
    const row = host.querySelector<HTMLButtonElement>(".changed-file-row")!;
    pointer(row, "pointerover");
    await until(() => document.querySelector(".saved-diff-preview-line"));
    const panel = document.querySelector(".saved-diff-preview")!;
    const firstLine = panel.querySelector(".saved-diff-preview-line");
    pointer(row, "pointerout", panel); pointer(panel, "pointerover", row);
    await pause(220);
    pointer(panel, "pointerout", row); pointer(row, "pointerover", panel);
    await pause(320);
    assert(reads === 1, "Returning to the same file reloaded its open preview");
    assert(panel.querySelector(".saved-diff-preview-line") === firstLine, "Returning to the file replaced the preview with a loading state");

    renderCard(); // Unrelated chat updates must keep the active excerpt.
    await pause(30);
    assert(document.querySelector(".saved-diff-preview") === panel && reads === 1, "Chat render remounted or reread the preview");
    const unrelated = document.createElement("div"); document.body.append(unrelated);
    unrelated.dispatchEvent(new Event("scroll")); unrelated.remove();
    await pause(30);
    assert(document.querySelector(".saved-diff-preview") === panel, "Scrolling another panel dismissed the chat preview");
    host.dispatchEvent(new Event("scroll"));
    await until(() => !document.querySelector(".saved-diff-preview"));
  } finally { root.unmount(); }
}

/** Both scroll axes belong to one file, not to the preview reused for the next. */
export async function runSavedPreviewLayoutRegressions(host: HTMLElement) {
  const root = createRoot(host);
  const originalTheme = document.documentElement.getAttribute("data-theme");
  try {
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      root.render(<div data-diff-theme={theme}><SavedDiffFixture key={theme} /></div>);
      await until(() => host.querySelector(`[data-diff-theme="${theme}"] .changed-file-row`));
      const scroller = await focusSavedPreview(host);
      await pause(30);
      assert(scroller.scrollWidth > scroller.clientWidth, "Fixture must exercise horizontal scrolling");
      assert(scroller.scrollHeight > scroller.clientHeight, "Fixture must exercise vertical scrolling");
      scroller.scrollLeft = 150;
      scroller.scrollTop = 70;
      await pause(30);
      const next = await focusSavedPreview(host, 1);
      assert(next.scrollLeft === 0 && next.scrollTop === 0, "Switching preview files retained another file's scroll position");

      const codes = Array.from(next.querySelectorAll<HTMLElement>(".saved-diff-preview-line code"));
      for (const code of codes) assertCodeContrast(code, getComputedStyle(code).backgroundColor);
      for (const gutter of Array.from(next.querySelectorAll(".preview-line-gutter"))) {
        for (const item of Array.from(gutter.children)) assertContrast(item, getComputedStyle(gutter).backgroundColor);
      }
      const right = codes[0]!.getBoundingClientRect().right;
      assert(codes.every((code) => Math.abs(code.getBoundingClientRect().right - right) < 1), "Short and long preview rows do not share one width");
      const number = next.querySelector<HTMLElement>(".preview-line-number")!;
      const left = number.getBoundingClientRect().left;
      next.scrollLeft = 180;
      await pause(30);
      assert(Math.abs(number.getBoundingClientRect().left - left) < 1, "Line numbers disappear when the preview scrolls horizontally");
      root.render(<div data-diff-theme={theme}><SavedDiffFixture key={theme} /></div>);
      await pause(30);
      assert(document.querySelector(".saved-diff-preview-code") === next && next.scrollLeft === 180, "Unrelated render reset the same file's scroll position");
      assert(getComputedStyle(next, "::-webkit-scrollbar-corner").backgroundColor !== "rgb(255, 255, 255)", "Diff has a white scrollbar corner");
      const panel = document.querySelector<HTMLElement>(".saved-diff-preview")!;
      const bounds = panel.getBoundingClientRect();
      assert(bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight, "Diff preview escaped the viewport");
      const header = panel.querySelector<HTMLElement>(".saved-diff-preview-head")!;
      const footer = panel.querySelector<HTMLElement>(".saved-diff-preview-footer")!;
      assert(header.scrollWidth <= header.clientWidth && footer.scrollWidth <= footer.clientWidth, "Diff header or footer overflowed");
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      await until(() => !document.querySelector(".saved-diff-preview"));

      // The same palette reaches saved full-file, Review split/unified, and
      // raw fallback diffs. Check actual cells, not just token declarations.
      for (const split of [false, true]) {
        for (const wrap of [false, true]) {
          const identity = `${theme}-${split}-${wrap}`;
          root.render(<div data-diff-case={identity}>
            <FileDiff file={previewFile} split={split} wrap={wrap} />
            <DiffView text={previewPatch} />
          </div>);
          await until(() => host.querySelector(`[data-diff-case="${identity}"] .file-diff-body`));
          const body = host.querySelector<HTMLElement>(".file-diff-body")!;
          if (wrap) assert(body.scrollWidth <= body.clientWidth + 1, "Wrapped diff overflows its surface");
          for (const code of Array.from(body.querySelectorAll(".diff-text"))) {
            const background = getComputedStyle(code).backgroundColor;
            assertCodeContrast(code, background === "rgba(0, 0, 0, 0)" ? getComputedStyle(body).backgroundColor : background);
          }
          for (const line of Array.from(host.querySelectorAll(".diff-view .add, .diff-view .del"))) {
            assertContrast(line, getComputedStyle(line).backgroundColor);
          }
        }
      }
    }
  } finally {
    root.unmount();
    if (originalTheme) document.documentElement.dataset.theme = originalTheme;
    else document.documentElement.removeAttribute("data-theme");
  }
}
