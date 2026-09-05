import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ProjectAction } from "@capsule/shared";
import { formatUserError } from "../../lib/errors";

import { Switch } from "../settings/controls";
import { XIcon } from "./icons";

function withScheme(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const hasScheme = /^[a-z][a-z\d+.-]*:/iu.test(trimmed);
  const hostAndPort = /^[^/:?#]+:\d+(?:[/?#]|$)/u.test(trimmed);
  return hasScheme && !hostAndPort ? trimmed : `http://${trimmed}`;
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
  onSave: (next: ProjectAction) => Promise<{ saved: true } | { saved: false; error: string }>;
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const savedId = useRef(action.id);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        if (!pending.current) onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const previewUrl = withScheme(url);

  async function save() {
    if (pending.current || !name.trim() || !command.trim()) return;
    if (previewUrl) {
      try {
        const parsed = new URL(previewUrl);
        if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error();
      } catch {
        setError("Enter a valid HTTP or HTTPS preview URL without a username or password.");
        return;
      }
    }
    pending.current = true; setSaving(true); setError(undefined);
    try {
      savedId.current ||= `action-${crypto.randomUUID()}`;
      const result = await onSave({
        id: savedId.current,
        name: name.trim(), command: command.trim(),
        ...(previewUrl ? { previewUrl } : {}),
        ...(runOnWorktreeCreate ? { runOnWorktreeCreate: true } : {}),
        ...(previewUrl && !openPreview ? { openPreview: false } : {}),
      });
      if (result.saved) onClose();
      else setError(result.error);
    } catch (cause) {
      setError(formatUserError(cause));
    } finally {
      pending.current = false; setSaving(false);
    }
  }

  return createPortal(
    <div className="palette-backdrop center" onClick={() => { if (!pending.current) onClose(); }}>
      <form
        className="dialog project-action-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={action.id ? "Edit action" : "Add action"}
        aria-busy={saving}
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className="dialog-header">
          <div>
            <h3>{action.id ? "Edit Action" : "Add Action"}</h3>
            <p>Actions are project-scoped commands you can run from the top bar or keybindings.</p>
          </div>
          <button type="button" className="dialog-close" aria-label="Close" disabled={saving} onClick={onClose}>
            <XIcon size={14} />
          </button>
        </div>
        <fieldset className="project-action-fields" disabled={saving}>
        <label>
          <span>Name</span>
          <input
            autoFocus
            type="text"
            value={name}
            maxLength={60}
            required
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
            maxLength={2000}
            required
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
            maxLength={500}
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
        </fieldset>
        {error && <p className="project-action-error" role="alert">{error}</p>}
        <div className="actions">
          <button className="ghost" type="button" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button className="send" type="submit" disabled={saving || !name.trim() || !command.trim()}>
            {saving ? "Saving…" : action.id ? "Save changes" : "Save action"}
          </button>
        </div>
      </form>
    </div>,
    document.body,
  );
}
