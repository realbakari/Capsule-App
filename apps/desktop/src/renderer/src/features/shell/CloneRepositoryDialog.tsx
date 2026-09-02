import { useState } from "react";
import { createPortal } from "react-dom";
import { useWorkspace } from "../../lib/workspace";
import { formatProjectRoot } from "../../lib/paths";

export function CloneRepositoryDialog({ onClose }: { onClose: () => void }) {
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
          if (!url.trim() || !parentDirectory || busy) return;
          setBusy(true);
          setError(undefined);
          void cloneRepository({
            url: url.trim(),
            parentDirectory,
            ...(name.trim() ? { name: name.trim() } : {}),
          })
            .then(onClose)
            .catch((caught) => setError(caught instanceof Error ? caught.message : String(caught)))
            .finally(() => setBusy(false));
        }}
      >
        <h3>Clone Git repository</h3>
        <p>Add a project from an HTTPS or SSH remote.</p>
        <label>
          <span>Repository URL</span>
          <input
            autoFocus
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/owner/repository.git"
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
          <button className="send" type="submit" disabled={!url.trim() || !parentDirectory || busy}>
            {busy ? "Cloning…" : "Clone and open"}
          </button>
        </div>
      </form>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(modal, document.body) : modal;
}

