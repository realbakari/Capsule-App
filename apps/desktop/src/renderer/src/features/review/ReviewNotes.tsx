import { useState, type KeyboardEvent } from "react";
import type { OmittedDiffFile } from "@capsule/shared";
import {
  editReviewComment,
  removeReviewComment,
  type ReviewComment,
} from "../../lib/review-comments";

/** One note being written or edited. ⌘Return saves, Escape cancels. */
export function NoteEditor({ initial = "", label, onSave, onCancel }: {
  initial?: string;
  label: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState(initial);
  const save = () => { if (text.trim()) onSave(text.trim()); };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onCancel(); }
    else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); save(); }
  };
  return (
    <div className="review-note-editor">
      <textarea className="field" rows={2} autoFocus value={text} aria-label={label} placeholder="Leave a note for the agent"
        onChange={(event) => setText(event.target.value)} onKeyDown={onKeyDown} />
      <span className="review-note-actions">
        <button type="button" className="chip" onClick={onCancel}>Cancel</button>
        <button type="button" className="send" disabled={!text.trim()} onClick={save}>{initial ? "Save" : "Add note"}</button>
      </span>
    </div>
  );
}

function where(comment: ReviewComment): string {
  return `${comment.path}:${comment.line}${comment.side === "left" ? " (removed)" : ""}`;
}

/** A saved note under its diff line. */
export function SavedNote({ thread, comment }: { thread: string; comment: ReviewComment }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return <NoteEditor initial={comment.text} label={`Edit note on ${where(comment)}`}
      onSave={(text) => { editReviewComment(thread, comment.id, text); setEditing(false); }} onCancel={() => setEditing(false)} />;
  }
  return (
    <div className="review-note">
      <p>{comment.text}</p>
      <span className="review-note-actions">
        <button type="button" className="chip" onClick={() => setEditing(true)}>Edit</button>
        <button type="button" className="chip" onClick={() => removeReviewComment(thread, comment.id)}>Remove</button>
      </span>
    </div>
  );
}

/**
 * The notes waiting to go to the agent: how many, each one to edit or
 * remove, and the step that puts them in the composer.
 */
export function NotesTray({ thread, comments, onSend, onDiscard }: {
  thread: string;
  comments: readonly ReviewComment[];
  onSend: () => void;
  onDiscard: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="review-notes-tray" role="region" aria-label="Review notes">
      <div className="review-notes-head">
        <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          {comments.length} {comments.length === 1 ? "note" : "notes"}
        </button>
        <span className="review-notes-spacer" />
        <button type="button" className="chip" onClick={onDiscard}>Discard</button>
        <button type="button" className="send" onClick={onSend} title="Adds every note to the message you are writing, as one block">Add to message</button>
      </div>
      {open ? (
        <ul className="review-notes-list">
          {comments.map((comment) => (
            <li key={comment.id}>
              <span className="mono review-notes-where" title={where(comment)}>{where(comment)}</span>
              <SavedNote thread={thread} comment={comment} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const SHOWN_OMITTED = 20;

function size(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  return bytes >= 1024 * 1024 ? ` (${(bytes / 1024 / 1024).toFixed(1)} MB)` : ` (${Math.round(bytes / 1024)} KB)`;
}

/**
 * Changed files the read left out. A file past the limit shows on its own;
 * one too large to show opens in the editor instead.
 */
export function OmittedFiles({ omitted, path, onShow, onOpen }: {
  omitted: readonly OmittedDiffFile[];
  /** The one file Review is showing, which needs no Show of its own. */
  path?: string;
  onShow?: (path: string) => void;
  onOpen?: (path: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? omitted : omitted.slice(0, SHOWN_OMITTED);
  const rest = omitted.length - shown.length;
  return (
    <div className="review-omitted" role="group" aria-label="Files not shown">
      <p className="review-omitted-head">{omitted.length} {omitted.length === 1 ? "file" : "files"} not shown</p>
      <ul>
        {shown.map((item) => (
          <li key={item.path}>
            <span className="mono truncate" title={item.path}>{item.path}</span>
            <span className="faint review-omitted-why">{item.reason === "too-large" ? `Too large to show${size(item.bytes)}` : "Over the limit for one read"}</span>
            {item.reason === "limit" && onShow && item.path !== path ? <button type="button" className="chip" onClick={() => onShow(item.path)}>Show</button> : null}
            {onOpen ? <button type="button" className="chip" onClick={() => onOpen(item.path)}>Open in editor</button> : null}
          </li>
        ))}
      </ul>
      {rest > 0 ? <button type="button" className="chip" onClick={() => setAll(true)}>{rest} more {rest === 1 ? "file" : "files"} not shown</button> : null}
    </div>
  );
}
