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
        <div className="dialog-header">
          <div>
            <h3>{action.id ? "Edit Action" : "Add Action"}</h3>
            <p>Actions are project-scoped commands you can run from the top bar or keybindings.</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>
        <label>
          <span>Name</span>
          <input
            autoFocus
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Test or Dev server"
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
            placeholder="bun test or pnpm dev"
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
            placeholder="http://localhost:5173"
          />
          <span className="field-hint">Open this URL in the in-app preview when this action runs.</span>
        </label>
        <div className="setting">
          <div className="setting-copy">
            <div>Run automatically on worktree creation</div>
            <p>A fresh checkout has no dependencies installed. Runs once when created.</p>
          </div>
          <div className="setting-control">
            <Switch
              checked={runOnWorktreeCreate}
              onChange={setRunOnWorktreeCreate}
              label="Run automatically on worktree creation"
            />
          </div>
        </div>
        {previewUrl ? (
          <div className="setting">
            <div className="setting-copy">
              <div>Open preview automatically when this action runs</div>
              <p>Shows {previewUrl} in Capsule&rsquo;s browser panel when the action runs.</p>
            </div>
            <div className="setting-control">
              <Switch
                checked={openPreview}
                onChange={setOpenPreview}
                label="Open preview automatically when this action runs"
              />
            </div>
          </div>
        ) : null}
        <div className="actions">
          <button className="ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="send" type="submit" disabled={!name.trim() || !command.trim()}>
            {action.id ? "Save changes" : "Save action"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
