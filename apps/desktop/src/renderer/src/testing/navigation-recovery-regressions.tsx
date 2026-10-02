import { useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ArchiveUndoNotice } from "../features/shell/ArchiveUndoNotice";
import { HeaderPopover } from "../features/shell/HeaderPopover";
import { MenuSelect } from "../features/shell/MenuSelect";
import { HistoryView } from "../features/library/LibraryViews";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const settle = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

function LowPopover() {
  const anchor = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  return <div ref={anchor} style={{ position: "fixed", right: 8, bottom: 8 }}>
    <button aria-label="Open recovery menu" onClick={() => setOpen(true)}>Open</button>
    {open && <HeaderPopover anchor={anchor} label="Recovery menu" onClose={() => setOpen(false)}>
      {Array.from({ length: 8 }, (_, index) => <button key={index}>Action {index}</button>)}
    </HeaderPopover>}
  </div>;
}

export async function runNavigationRecoveryRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const styles = document.querySelector<HTMLStyleElement>("#composer-test-styles")!;
  const media = styles.media; styles.media = "all";
  const root = createRoot(host); const restored: string[] = []; let dismissed = false;
  try {
    window.testWorkspace = { api: { isDesktop: true, listRunPage: async () => ({ runs: [], hasMore: false }) },
      archiveUndo: { id: "archived", title: "A saved conversation" }, restoreSession: async (id: string) => { restored.push(id); }, dismissArchiveUndo: () => { dismissed = true; },
      sessions: [{ id: "archived", title: "A saved conversation", state: "archived", projectId: "p" }], projectId: "p" };
    root.render(<><textarea aria-label="Draft" /><ArchiveUndoNotice /></>); await settle();
    const draft = host.querySelector("textarea")!;
    draft.focus(); draft.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
    assert(restored.length === 0, "Archive undo stole text editing undo");
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true })); await settle();
    assert(restored.join() === "archived", "Keyboard archive undo did not restore the conversation");
    host.querySelector<HTMLButtonElement>('[aria-label="Dismiss archive notification"]')!.click(); await settle();
    assert(dismissed, "Archive notice could not be dismissed");
    root.render(<HistoryView />); await settle();
    const archived = host.querySelector<HTMLDetailsElement>(".archived-conversations")!; archived.open = true;
    archived.querySelector<HTMLButtonElement>("button")!.click(); await settle();
    assert(restored.slice().length === 2, "History did not retain a permanent restore action");
    window.testWorkspace = { ...window.testWorkspace, api: { isDesktop: false, listRunPage: async () => ({ runs: [], hasMore: false }) } };
    root.render(<HistoryView />); await settle();
    assert(host.querySelector<HTMLButtonElement>(".archived-conversations button")?.disabled, "Browser offered a host-only restore");
    root.render(<LowPopover />); await settle();
    const trigger = host.querySelector<HTMLButtonElement>('[aria-label="Open recovery menu"]')!; trigger.click(); await settle();
    const panel = document.querySelector<HTMLElement>('[aria-label="Recovery menu"]')!;
    const bounds = panel.getBoundingClientRect();
    assert(bounds.height > 80 && bounds.bottom <= trigger.getBoundingClientRect().top && bounds.left >= 0 && bounds.right <= innerWidth, "Low header menu clipped instead of flipping upward");
    panel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle();
    assert(!document.querySelector('[aria-label="Recovery menu"]') && document.activeElement === trigger, "Popover did not dismiss and restore keyboard focus");
    root.render(<div style={{ position: "fixed", bottom: 8, right: 8 }}><MenuSelect ariaLabel="Test models" value="one" options={[{ id: "one", label: "One" }, { id: "two", label: "A long reported model name that should remain inside the viewport" }]} onChange={() => {}} /></div>); await settle();
    host.querySelector<HTMLButtonElement>('[aria-label="Test models"]')!.click(); await settle();
    const menu = document.querySelector<HTMLElement>('[role="listbox"][aria-label="Test models"]')!.getBoundingClientRect();
    assert(menu.left >= 0 && menu.right <= innerWidth && menu.bottom <= innerHeight && menu.height > 30, "Model menu overflowed its viewport");
  } finally { root.unmount(); window.testWorkspace = previous; styles.media = media; }
}
