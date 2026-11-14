import { useState } from "react";
import { copyAnchor, type ActionMenuItem, type MenuAnchor } from "../../lib/action-menu";
import { useWorkspace } from "../../lib/workspace";
import { ActionMenu } from "../shell/ActionMenu";
import { ChevronDownIcon } from "../shell/icons";
import { useThreadActions } from "./ThreadActions";
import "./threads.css";

/** The other ways to start a conversation, beside New conversation. */
export function NewConversationMenu() {
  const { api, createTask } = useWorkspace();
  const actions = useThreadActions();
  const [anchor, setAnchor] = useState<MenuAnchor>();
  const [keyboard, setKeyboard] = useState(false);
  /* Every entry here creates a thread on the host. */
  if (api.isDesktop === false && api.remoteMode !== "control") return null;
  const items: ActionMenuItem[] = [
    { id: "new", label: "New conversation", icon: "plus", shortcut: "⌘N" },
    { id: "temporary", label: "New temporary conversation", icon: "message", title: "Not saved, gone when Capsule quits" },
    ...(actions.writable ? [{ id: "issue", label: "From a GitHub issue…", icon: "branch" as const, title: "A worktree branch named after the issue, with the issue as the first prompt" }] : []),
  ];
  return (
    <>
      <button type="button" className="icon-btn sidebar-new-more" aria-label="More ways to start a conversation" title="More ways to start a conversation"
        aria-haspopup="menu" aria-expanded={Boolean(anchor)} data-open={anchor ? "true" : undefined}
        onClick={(event) => { setKeyboard(event.detail === 0); setAnchor(anchor ? undefined : copyAnchor(event.currentTarget.getBoundingClientRect())); }}>
        <ChevronDownIcon size={13} />
      </button>
      {anchor && (
        <ActionMenu items={items} point={{ x: anchor.left, y: anchor.bottom }} anchor={anchor} keyboard={keyboard}
          onClose={() => setAnchor(undefined)}
          onSelect={(id) => {
            setAnchor(undefined);
            if (id === "new") void createTask();
            if (id === "temporary") void createTask(undefined, undefined, { temporary: true });
            if (id === "issue") actions.openIssuePicker();
          }} />
      )}
    </>
  );
}
