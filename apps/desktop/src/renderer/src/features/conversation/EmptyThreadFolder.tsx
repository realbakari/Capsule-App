import { useState } from "react";
import { FOLDER_REQUIRED } from "../../lib/harness-preflight";
import { useWorkspace } from "../../lib/workspace";
import { CloneRepositoryDialog } from "../shell/CloneRepositoryDialog";

/**
 * An empty thread with no folder: why that matters for the agent picked, and
 * the ways to give it one. A named project gets the folder attached to it; with
 * no project, or the Inbox, a folder or a clone becomes a project of its own.
 * Picking a folder is a dialog on the computer running Capsule, so a paired
 * device gets the words without the buttons.
 */
export function EmptyThreadFolder() {
  const { api, project, sendBlockReason, pickProjectDirectory, createProjectFromFolder } = useWorkspace();
  const [cloning, setCloning] = useState(false);
  const named = Boolean(project && project.name !== "Inbox");
  const local = api.isDesktop !== false;
  return <>
    <p>
      {named
        ? "Attach a folder so the agent can read files, run git, and make changes."
        : sendBlockReason === FOLDER_REQUIRED
          ? "Agents work inside a folder on this computer. Open one, or clone a repository."
          : "Ask anything, or open a folder when the work needs one."}
    </p>
    {local ? <div className="actions">
      {named
        ? <button className="send" onClick={() => void pickProjectDirectory()}>Attach folder</button>
        : <>
          <button className="send" onClick={() => void createProjectFromFolder()}>Open a folder</button>
          <button className="chip" onClick={() => setCloning(true)}>Clone a repository</button>
        </>}
    </div> : null}
    {cloning ? <CloneRepositoryDialog onClose={() => setCloning(false)} /> : null}
  </>;
}
