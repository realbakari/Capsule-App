import { useId, useState, type KeyboardEvent } from "react";
import { MAX_TAGS_PER_THREAD, normalizeTag, normalizeTags } from "@capsule/shared";
import { XIcon } from "../shell/icons";
import "./threads.css";

/**
 * A thread's tags as chips plus one field. Enter or a comma adds what was
 * typed; Backspace in an empty field removes the last tag. Tags already used
 * elsewhere are offered as you type.
 */
export function TagEditor({ tags, suggestions, onChange, autoFocus, disabled }: {
  tags: readonly string[];
  suggestions: readonly string[];
  onChange: (next: string[]) => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const listId = useId();
  const full = tags.length >= MAX_TAGS_PER_THREAD;

  const add = (raw: string) => {
    const values = raw.split(",").map(normalizeTag).filter((tag): tag is string => Boolean(tag));
    setDraft("");
    if (values.length) onChange(normalizeTags([...tags, ...values]));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === ",") && draft.trim()) {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && !draft && tags.length) {
      onChange(tags.slice(0, -1));
    }
  };

  const offered = suggestions.filter((tag) => !tags.includes(tag));
  return (
    <div className="tag-editor" data-disabled={disabled ? "true" : undefined}>
      {tags.map((tag) => (
        <span key={tag} className="tag-chip">
          <span className="tag-chip-name">#{tag}</span>
          {!disabled && (
            <button type="button" className="tag-chip-remove" aria-label={`Remove tag ${tag}`} title={`Remove ${tag}`}
              onClick={() => onChange(tags.filter((item) => item !== tag))}><XIcon size={10} /></button>
          )}
        </span>
      ))}
      {!disabled && (
        <input
          className="tag-editor-input"
          value={draft}
          autoFocus={autoFocus}
          list={listId}
          disabled={full}
          aria-label="Add a tag"
          placeholder={full ? "Tag limit reached" : tags.length ? "Add tag" : "Add a tag, then Enter"}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => { if (draft.trim()) add(draft); }}
        />
      )}
      <datalist id={listId}>{offered.map((tag) => <option key={tag} value={tag} />)}</datalist>
      {disabled && tags.length === 0 && <span className="faint">No tags</span>}
    </div>
  );
}
