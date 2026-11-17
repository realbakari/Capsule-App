import { useState, type MouseEvent } from "react";
import type { ActionMenuItem } from "../../lib/action-menu";
import { showNativeContextMenu } from "../../lib/bridge";
import { withShortcut } from "../../lib/keybindings";
import { useWorkspace } from "../../lib/workspace";
import { ActionMenu } from "../shell/ActionMenu";
import { SquarePenIcon } from "../shell/icons";
import { useThreadActions } from "./ThreadActions";
import "./threads.css";

/**
 * New conversation, as one icon beside the search field. Its context menu
 * holds the other ways to start one; the command palette lists them too.
 */
export function NewConversationButton({ onNew }: { onNew: () => void }) {
  const { api, createTask, keyBindings } = useWorkspace();
  const label = withShortcut("New conversation", "new-conversation", keyBindings);
  const actions = useThreadActions();
  const [menu, setMenu] = useState<{ x: number; y: number; keyboard: boolean }>();
  /* Every entry here creates a thread on the host. */
  if (api.isDesktop === false && api.remoteMode !== "control") return null;
  const items: ActionMenuItem[] = [
    { id: "temporary", label: "New temporary conversation", icon: "message", title: "Not saved, gone when Capsule quits" },
    ...(actions.writable ? [{ id: "issue", label: "From a GitHub issue…", icon: "branch" as const, title: "A worktree branch named after the issue, with the issue as the first prompt" }] : []),
  ];
  const pick = (id: string) => {
    setMenu(undefined);
    if (id === "temporary") void createTask(undefined, undefined, { temporary: true });
    if (id === "issue") actions.openIssuePicker();
  };
  async function openMenu(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const keyboard = event.button === 0 && event.clientX === 0 && event.clientY === 0;
    const point = keyboard ? { x: rect.left, y: rect.bottom } : { x: event.clientX, y: event.clientY };
    const native = await showNativeContextMenu(items, point);
    if (native === "unavailable") setMenu({ ...point, keyboard });
    else if (native) pick(native);
  }
  return (
    <>
      <button type="button" className="icon-btn sidebar-new" aria-label={label}
        title={`${label}\nRight-click for a temporary one or one from a GitHub issue`}
        onClick={onNew} onContextMenu={(event) => void openMenu(event)}>
        <SquarePenIcon size={15} />
      </button>
      {menu && (
        <ActionMenu items={items} point={menu} keyboard={menu.keyboard} onClose={() => setMenu(undefined)} onSelect={pick} />
      )}
    </>
  );
}
