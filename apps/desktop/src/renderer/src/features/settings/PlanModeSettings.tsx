import type { CapsuleSettings, HarnessStatus, TurnMode } from "@capsule/shared";
import { SettingRow, Switch } from "./controls";

/** Plan mode preferences: how a new conversation starts, and which model each mode selects per agent. */
export function PlanModeCard({ settings, harnesses, onPatch, editable }: {
  settings: CapsuleSettings;
  harnesses: HarnessStatus[];
  onPatch: (next: Partial<CapsuleSettings>) => void;
  editable: boolean;
}) {
  const saved = Object.entries(settings.modeModels);
  const name = (id: string) => harnesses.find((harness) => harness.id === id)?.name ?? id;
  function clear(harnessId: string, mode: TurnMode) {
    const rest: { plan?: string; act?: string } = { ...settings.modeModels[harnessId] };
    delete rest[mode];
    const next = { ...settings.modeModels };
    if (rest.plan || rest.act) next[harnessId] = rest; else delete next[harnessId];
    onPatch({ modeModels: next });
  }
  return (
    <div className="card plan-mode-card">
      <h3>Plan mode</h3>
      <p className="muted">
        A plan turn reads and investigates, then replies with a plan instead of changing files. Press ⇧Tab in the composer to switch.
      </p>
      <SettingRow label="Start in Plan mode" setting="startInPlanMode" hint="New conversations begin in Plan. Each conversation keeps its own choice afterwards.">
        <Switch label="Start in Plan mode" checked={settings.startInPlanMode} onChange={(value) => onPatch({ startInPlanMode: value })} />
      </SettingRow>
      <SettingRow label="Plan and Act models" setting="modeModels" stacked
        hint="Switching mode also switches to the model saved for it. Save one with Plan or Act on a model's row in the composer's model picker.">
        {saved.length === 0 ? <p className="faint plan-mode-models-empty">No models saved for a mode. Each mode keeps the conversation's current model.</p> : (
          <ul className="plan-mode-models" aria-label="Models saved per mode">
            {saved.map(([harnessId, models]) => (["plan", "act"] as const).filter((mode) => models[mode]).map((mode) => (
              <li key={`${harnessId}:${mode}`}>
                <span className="plan-mode-models-agent">{name(harnessId)}</span>
                <span className="plan-mode-models-mode">{mode === "plan" ? "Plan" : "Act"}</span>
                <code>{models[mode]}</code>
                <button type="button" className="ghost" disabled={!editable} aria-label={`Clear the ${mode === "plan" ? "Plan" : "Act"} model for ${name(harnessId)}`}
                  title={editable ? undefined : "Change settings on the desktop."} onClick={() => clear(harnessId, mode)}>Clear</button>
              </li>
            )))}
          </ul>
        )}
      </SettingRow>
    </div>
  );
}
