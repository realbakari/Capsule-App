import { useState } from "react";
import type { ActionMenuItem, MenuAnchor } from "../../../lib/action-menu";
import { copyAnchor } from "../../../lib/action-menu";
import { ActionMenu } from "../../shell/ActionMenu";
import { GitBranchIcon } from "../../shell/icons";

export type TurnAction = "fork" | "fork-worktree" | "restore-files" | "restore-conversation" | "restore-both";

const ITEMS: ActionMenuItem[] = [
  { id: "fork", label: "Fork from here", icon: "branch" },
  { id: "fork-worktree", label: "Fork into a new worktree", icon: "folder-plus" },
  { id: "restore-files", label: "Restore files…", icon: "file", separatorBefore: true },
  { id: "restore-conversation", label: "Restore conversation…", icon: "message" },
  { id: "restore-both", label: "Restore both…", icon: "history" },
];

/** The turn's own menu, on its prompt and its reply: branch from it or go back to it. */
export function TurnMenu({ onAction }: { onAction: (action: TurnAction) => void }) {
  const [anchor, setAnchor] = useState<MenuAnchor & { keyboard: boolean }>();
  return (
    <>
      <button
        type="button"
        className="icon-btn"
        title="Fork or restore this turn"
        aria-label="Fork or restore this turn"
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        onClick={(event) => setAnchor(anchor ? undefined : { ...copyAnchor(event.currentTarget.getBoundingClientRect()), keyboard: event.detail === 0 })}
      >
        <GitBranchIcon size={13} />
      </button>
      {anchor && (
        <ActionMenu
          items={ITEMS}
          point={{ x: anchor.left, y: anchor.bottom }}
          anchor={anchor}
          keyboard={anchor.keyboard}
          onClose={() => setAnchor(undefined)}
          onSelect={(id) => { setAnchor(undefined); onAction(id as TurnAction); }}
        />
      )}
    </>
  );
}
