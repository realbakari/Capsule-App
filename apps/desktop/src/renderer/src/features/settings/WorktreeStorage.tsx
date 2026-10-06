import { useState } from "react";
import type { CapsuleSettings } from "@capsule/shared";
import { SettingRow } from "./controls";

export function WorktreeStorage({ settings, chooseFolder, save, editable }: {
  settings: CapsuleSettings;
  chooseFolder: () => Promise<string | undefined>;
  save: (patch: Partial<CapsuleSettings>) => Promise<unknown>;
  editable: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function change(reset: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const directory = reset ? "" : await chooseFolder();
      if (directory !== undefined) await save({ worktreesDirectory: directory });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save the worktree location.");
    } finally { setBusy(false); }
  }
  return <div className="card worktree-storage">
    <h3>Worktrees</h3>
    <SettingRow label="Worktree location" hint="New worktrees are created in this folder on the host computer. Existing conversations stay where they are.">
      <div className="setting-stack">
        <div className="mono setting-path">{settings.worktreesDirectory || "Default · Capsule application data"}</div>
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="ghost" disabled={busy || !editable} onClick={() => void change(false)}>Choose worktree folder</button>
          {settings.worktreesDirectory && <button type="button" className="ghost" disabled={busy || !editable} onClick={() => void change(true)}>Use default</button>}
        </div>
        {!editable && <p>Change this location in Capsule on the host computer.</p>}
        {error && <p role="alert">{error}</p>}
      </div>
    </SettingRow>
  </div>;
}
