import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, type CapsuleSettings } from "@capsule/shared";
import { WorktreeStorage } from "../features/settings/WorktreeStorage";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }

export async function runWorktreeStorageRegressions(host: HTMLElement) {
  const root = createRoot(host);
  let selected: string | undefined;
  let fail = false;
  let settings = { ...DEFAULT_CAPSULE_SETTINGS };
  const writes: Partial<CapsuleSettings>[] = [];
  const render = (editable = true) => root.render(<WorktreeStorage settings={settings} editable={editable} chooseFolder={async () => selected} save={async (patch) => {
    if (fail) throw new Error("Folder is unavailable");
    writes.push(patch);
    settings = { ...settings, ...patch };
    render();
  }} />);
  const choose = () => host.querySelector<HTMLButtonElement>("button")!;
  try {
    render(); await settle(); choose().click(); await settle();
    assert(writes.length === 0, "Cancelling the folder picker changed storage");
    selected = "/Volumes/Projects/worktrees";
    choose().click(); await settle();
    assert(host.textContent?.includes(selected) && writes[0]?.worktreesDirectory === selected, "Saved location was not shown");
    fail = true; selected = "/Volumes/Offline/worktrees";
    choose().click(); await settle();
    assert(host.querySelector('[role="alert"]')?.textContent === "Folder is unavailable" && host.textContent?.includes("/Volumes/Projects/worktrees"), "Rejected save changed the displayed location");
    fail = false;
    host.querySelectorAll<HTMLButtonElement>("button")[1]!.click(); await settle();
    assert(writes[1]?.worktreesDirectory === "" && host.querySelectorAll("button").length === 1, "Default storage could not be restored");
    render(false); await settle();
    assert(choose().disabled && host.textContent?.includes("host computer"), "Paired viewer could change host storage");
  } finally { root.unmount(); }
}
