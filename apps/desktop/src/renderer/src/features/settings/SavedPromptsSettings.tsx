import { useState } from "react";
import { normalizePromptTemplates, templateCommand, templateVariables, type CapsuleSettings, type PromptTemplate } from "@capsule/shared";
import { PlusIcon } from "../shell/icons";
import { SettingSource } from "../customization/SettingSource";
import "../conversation/composer-context.css";

/**
 * Personal saved prompts for the composer's `/` menu. A project's own live in
 * its capsule.json; these follow the user from project to project.
 */
export function SavedPromptsSettings({ settings, onPatch }: { settings: CapsuleSettings; onPatch: (next: Partial<CapsuleSettings>) => void }) {
  const prompts = settings.composerPrompts ?? [];
  const [editing, setEditing] = useState<{ index: number; draft: PromptTemplate }>();
  const [error, setError] = useState<string>();

  function save() {
    if (!editing) return;
    const draft = { ...editing.draft, name: editing.draft.name.trim(), prompt: editing.draft.prompt.trim() };
    if (!draft.name || !draft.prompt) { setError("A saved prompt needs a name and some text."); return; }
    const next = editing.index < 0 ? [...prompts, draft] : prompts.map((item, index) => index === editing.index ? draft : item);
    const clash = next.find((item, index) => next.findIndex((other) => templateCommand(other) === templateCommand(item)) !== index);
    if (clash) { setError(`Another saved prompt already answers to ${templateCommand(clash)}.`); return; }
    onPatch({ composerPrompts: normalizePromptTemplates(next) });
    setEditing(undefined);
    setError(undefined);
  }

  return (
    <div className="card saved-prompts">
      <div className="row">
        <div>
          <h3>Saved prompts <SettingSource setting="composerPrompts" /></h3>
          <p className="muted">
            Type / in the composer to use one. Write {"{{name}}"} for a blank to fill in, or {"{{name:one|two}}"} for a choice. A project can share its own in capsule.json.
          </p>
        </div>
        <button type="button" className="chip" disabled={Boolean(editing)} onClick={() => { setError(undefined); setEditing({ index: -1, draft: { name: "", prompt: "" } }); }}>
          <PlusIcon size={12} /> Add prompt
        </button>
      </div>
      {prompts.length === 0 && !editing ? <p className="faint">No saved prompts yet.</p> : null}
      {prompts.map((item, index) => editing?.index === index ? null : (
        <div className="row saved-prompt-row" key={item.name}>
          <span className="saved-prompt-copy">
            <code className="mono">{templateCommand(item)}</code>
            <span className="faint">{item.description ?? item.prompt.replace(/\s+/gu, " ")}</span>
          </span>
          <div className="actions" style={{ marginTop: 0 }}>
            {templateVariables(item.prompt).map((variable) => <span className="chip-static" key={variable.name}>{variable.name}</span>)}
            <button type="button" className="ghost" disabled={Boolean(editing)} onClick={() => { setError(undefined); setEditing({ index, draft: item }); }}>Edit</button>
            <button type="button" className="danger" disabled={Boolean(editing)} onClick={() => onPatch({ composerPrompts: prompts.filter((_, other) => other !== index) })}>Remove</button>
          </div>
        </div>
      ))}
      {editing && (
        <form className="saved-prompt-form" onSubmit={(event) => { event.preventDefault(); save(); }}>
          <label>
            <span>Name</span>
            <input autoFocus value={editing.draft.name} maxLength={60} placeholder="Review a file"
              onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, name: event.target.value } })} />
          </label>
          <label>
            <span>Prompt</span>
            <textarea className="field" rows={4} value={editing.draft.prompt} maxLength={8000}
              placeholder={"Review {{file}} for {{focus:bugs|performance|readability}} and list what you would change."}
              onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, prompt: event.target.value } })} />
          </label>
          <label>
            <span>Description <small>optional</small></span>
            <input value={editing.draft.description ?? ""} maxLength={200}
              onChange={(event) => setEditing({ ...editing, draft: { ...editing.draft, description: event.target.value || undefined } })} />
          </label>
          {error && <p className="project-action-error" role="alert">{error}</p>}
          <div className="actions">
            <button type="button" className="ghost" onClick={() => { setEditing(undefined); setError(undefined); }}>Cancel</button>
            <button type="submit" className="send">Save prompt</button>
          </div>
        </form>
      )}
    </div>
  );
}
