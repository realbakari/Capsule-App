import { createRoot } from "react-dom/client";
import { ChangedFilesCard } from "../features/conversation/ChangedFilesCard";

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
