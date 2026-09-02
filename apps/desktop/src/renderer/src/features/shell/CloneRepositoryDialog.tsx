import { useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../../lib/workspace";
import { normalizeCloneUrl } from "../../lib/clone-url";
import { formatProjectRoot } from "../../lib/paths";
import { XIcon } from "./icons";

export function CloneRepositoryDialog({
  onClose,
  source = "git-url",
}: {
  onClose: () => void;
  /** Which row of the source picker opened it, for the copy and the example. */
  source?: "git-url" | "github";
}) {
  const { api, cloneRepository } = useWorkspace();
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [parentDirectory, setParentDirectory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const modal = (
    <div className="palette-backdrop center" onClick={onClose} role="dialog" aria-modal="true">
      <form
        className="dialog clone-repository-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const remote = normalizeCloneUrl(url);
          if (!remote || !parentDirectory || busy) return;
          setBusy(true);
          setError(undefined);
          void cloneRepository({
            url: remote,
            parentDirectory,
            ...(name.trim() ? { name: name.trim() } : {}),
          })
            .then(onClose)
            .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <div className="dialog-header">
          <div>
            <h3>Clone Git repository</h3>
            <p>Add a project from an HTTPS or SSH remote.</p>
          </div>
          <button
            type="button"
            className="dialog-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <XIcon size={14} />
          </button>
        </div>
        <label>
          <span>{source === "github" ? "Repository" : "Repository URL"}</span>
          <input
            autoFocus
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder={source === "github" ? "owner/repository" : "https://github.com/owner/repository.git"}
          />
        </label>
        <label>
          <span>Folder name <small>optional</small></span>
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Derived from the repository URL"
          />
        </label>
        <div className="clone-destination">
          <span>
            {parentDirectory
              ? formatProjectRoot(parentDirectory, { home: window.capsule?.homeDir })
              : "Choose where the repository folder will be created."}
          </span>
          <button
            className="ghost"
            type="button"
            onClick={() => {
              void api.pickDirectory().then((directory) => {
                if (directory) setParentDirectory(directory);
              });
            }}
          >
            Choose destination
          </button>
        </div>
        {error ? <p className="notice">{error}</p> : null}
        <div className="actions">
          <button className="ghost" type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="send" type="submit" disabled={!normalizeCloneUrl(url) || !parentDirectory || busy}>
            {busy ? "Cloning…" : "Clone and open"}
          </button>
        </div>
      </form>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}

