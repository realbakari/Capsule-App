import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectAction } from "@capsule/shared";

import { Switch } from "../settings/controls";
import { XIcon } from "./icons";

function withScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  return /^https?:\/\//iu.test(trimmed) ? trimmed : `http://${trimmed}`;
}

/**
 * The editor for one project action, used by the top-bar menu and the project
 * screen. A modal rather than a panel inside the menu: the form is a task of
 * its own, and a menu that reflows into a form loses the list behind it.
 */
export function ProjectActionDialog({
  action,
  onSave,
  onClose,
}: {
  action: ProjectAction;
  onSave: (next: ProjectAction) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(action.name);
  const [command, setCommand] = useState(action.command);
  const [url, setUrl] = useState(action.previewUrl ?? "");
  const [runOnWorktreeCreate, setRunOnWorktreeCreate] = useState(
    Boolean(action.runOnWorktreeCreate),
  );
  // An action with a preview URL opened it before this was a choice, so an
  // action that has never been told otherwise keeps doing that.
  const [openPreview, setOpenPreview] = useState(action.openPreview !== false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const previewUrl = withScheme(url);

  return createPortal(
    <div className="palette-backdrop center" onClick={onClose}>
      <form
        className="dialog project-action-dialog"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          if (!name.trim() || !command.trim()) return;
          onSave({
            id: action.id || `action-${crypto.randomUUID()}`,
            name: name.trim(),
            command: command.trim(),
            ...(previewUrl ? { previewUrl } : {}),
            ...(runOnWorktreeCreate ? { runOnWorktreeCreate: true } : {}),
            ...(previewUrl && !openPreview ? { openPreview: false } : {}),
          });
        }}
      >
        <header>
          <div>
            <h3>{action.id ? "Edit action" : "Add action"}</h3>
            <p>A command saved with this project, to run from the top bar.</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <XIcon size={14} />
          </button>
        </header>
        <label>
          <span>Name</span>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Dev server"
          />
        </label>
        <label>
          <span>Command</span>
          {/* A textarea: a build command with flags does not fit one line, and
              a single-line input hides its own end. */}
          <textarea
            className="field"
            rows={2}
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            placeholder="pnpm dev"
          />
        </label>
        <label>
          <span>
            Preview URL <small>optional</small>
          </span>
          <input
            type="text"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="localhost:5173"
          />
        </label>
        <div className="setting">
          <div className="setting-copy">
            <div>Run on a new worktree</div>
            <p>A fresh checkout has no dependencies installed. This runs once, when it is created.</p>
          </div>
          <div className="setting-control">
            <Switch
              checked={runOnWorktreeCreate}
              onChange={setRunOnWorktreeCreate}
              label="Run this action when a worktree is created"
            />
          </div>
        </div>
        {previewUrl ? (
          <div className="setting">
            <div className="setting-copy">
              <div>Open the preview</div>
              <p>Shows {previewUrl} in Capsule&rsquo;s browser panel when the action runs.</p>
            </div>
            <div className="setting-control">
              <Switch
                checked={openPreview}
                onChange={setOpenPreview}
                label="Open the preview when this action runs"
              />
            </div>
          </div>
        ) : null}
        <div className="actions">
          <button className="ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="send" type="submit" disabled={!name.trim() || !command.trim()}>
            Save action
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
