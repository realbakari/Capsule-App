import { createRoot } from "react-dom/client";
import type { KeybindingEdit } from "@capsule/shared";
import { KeybindingsSettings } from "../features/settings/KeybindingsSettings";
import { effectiveKeymap, shortcutLabel } from "../lib/keybindings";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }

/* Settings → Shortcuts: grouped boxes, recording asks before taking another command's keys, and refuses the menu's. */
export async function runKeybindingsRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const root = createRoot(host);
  const edits: KeybindingEdit[] = [];
  try {
    window.testWorkspace = {
      ...base,
      config: { keybindings: [] },
      keyBindings: effectiveKeymap([]),
      commands: { list: { commands: [] } },
      api: { ...base.api as object, isDesktop: true, keybindingsSet: async (edit: KeybindingEdit) => { edits.push(edit); return {}; } },
    };
    root.render(<KeybindingsSettings />); await settle();
    const titles = Array.from(host.querySelectorAll(".keybindings-group h3"), (node) => node.textContent);
    assert(titles.join() === "General,Go to,Conversation,Composer,Workspace", `Shortcut groups out of order: ${titles.join()}`);
    const row = (label: string) => Array.from(host.querySelectorAll<HTMLElement>(".shortcut-setting")).find((node) => node.querySelector(".setting-label")?.textContent === label);
    const keysOf = (label: string) => row(label)!.querySelector<HTMLButtonElement>("button.shortcut-keys")!;
    assert(row("Previous turn")?.querySelector(".setting-copy p"), "A row lost its description line");
    assert(keysOf("Settings").disabled, "A menu shortcut became editable");

    const press = (target: HTMLElement, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
    keysOf("Toggle terminal").click(); await settle();
    press(keysOf("Toggle terminal"), { key: "b", code: "KeyB", metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 1700)); await settle();
    assert(edits.slice().length === 0, "Recording took Toggle sidebar's keys without asking");
    assert(row("Toggle terminal")!.textContent?.includes("already runs Toggle sidebar"), "Recording did not name the command that holds the keys");
    Array.from(row("Toggle terminal")!.querySelectorAll("button")).find((button) => button.textContent === "Use it here")!.click(); await settle();
    assert(edits.length === 1 && edits[0]!.op === "bind" && edits[0]!.sequence === "cmd+b", `Use it here did not bind: ${JSON.stringify(edits)}`);

    keysOf("Toggle terminal").click(); await settle();
    press(keysOf("Toggle terminal"), { key: "w", code: "KeyW", metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 1700)); await settle();
    assert(edits.length === 1 && row("Toggle terminal")!.textContent?.includes("belongs to the application menu"), "A menu key was bound, or refused without saying why");

    const search = host.querySelector<HTMLInputElement>('input[aria-label="Search shortcuts"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(search, shortcutLabel("open-review", effectiveKeymap([]))); search.dispatchEvent(new Event("input", { bubbles: true })); await settle();
    assert(host.querySelectorAll(".shortcut-setting").length === 1 && row("Toggle Review"), "Searching by the keys as shown did not find Toggle Review");

    window.testWorkspace = { ...window.testWorkspace, api: { ...window.testWorkspace.api as object, isDesktop: false } };
    root.render(<KeybindingsSettings key="viewer" />); await settle();
    assert(host.textContent?.includes("the browser may take some keys") && keysOf("Toggle sidebar").disabled, "A paired viewer could edit shortcuts, or was not told why keys may not arrive");
    root.render(null); await settle();
  } finally { root.unmount(); window.testWorkspace = previous; }
}
