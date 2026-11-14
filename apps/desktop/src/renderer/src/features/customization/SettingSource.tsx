import { createContext, useContext } from "react";
import type { FileSettingKey, Provenance, WritableScope } from "@capsule/shared";
import { SAVE_TARGETS, isUserOnly, sourceChip, type SettingSourceChip, type SettingsLayerView } from "../../lib/config-view";
import { UndoIcon } from "../shell/icons";

/** What a Settings row needs to say where its value came from, and to change that. */
export interface SettingSourceState {
  view: SettingsLayerView;
  /** The project's own values when saving to You, so a row can say a project file overrides it. */
  projectOverrides?: Partial<Record<string, Provenance>>;
  /** False on a paired device and in safe mode: chips still show, nothing opens or resets. */
  editable: boolean;
  open: (chip: SettingSourceChip) => void;
  reset: (key: string, layer: WritableScope) => void;
}

export const SettingSourceContext = createContext<SettingSourceState | undefined>(undefined);

/** Why a row saves to the user file while Settings saves to a project, for its hover text. */
export function useUserOnlyHint(setting: FileSettingKey | undefined): string | undefined {
  const state = useContext(SettingSourceContext);
  if (!setting || !state || state.view.target === "user" || !isUserOnly(setting)) return undefined;
  return "A project file cannot set this. Changes save to your user file.";
}

/** The file that set a row's value, a way to open it, and Reset. Nothing for a default. */
export function SettingSource({ setting }: { setting: FileSettingKey }) {
  const state = useContext(SettingSourceContext);
  if (!state) return null;
  const chip = sourceChip(state.view.provenance[setting]);
  const override = state.view.target === "user" ? sourceChip(state.projectOverrides?.[setting]) : undefined;
  const shownOverride = override && override.layer !== "user" ? override : undefined;
  if (!chip && !shownOverride) return null;
  return (
    <span className="setting-source">
      {chip && <SourceChip chip={chip} state={state} />}
      {chip && chip.layer !== "legacy" && chip.layer !== "plugin" && state.editable && (
        <button
          type="button"
          className="setting-source-reset"
          title={`Reset: remove from the ${chip.layer === "user" ? "user file" : `${chip.label} file`}`}
          aria-label={`Reset: remove from the ${chip.layer === "user" ? "user file" : `${chip.label} file`}`}
          onClick={() => state.reset(setting, chip.layer as WritableScope)}
        >
          <UndoIcon size={11} />
        </button>
      )}
      {shownOverride && <SourceChip chip={{ ...shownOverride, label: `${shownOverride.label} overrides` }} state={state} quiet />}
    </span>
  );
}

function SourceChip({ chip, state, quiet }: { chip: SettingSourceChip; state: SettingSourceState; quiet?: boolean }) {
  const className = `setting-source-chip${quiet ? " is-quiet" : ""}`;
  if (!state.editable) return <span className={className} data-layer={chip.layer} title={`Set in ${chip.path}`}>{chip.label}</span>;
  return (
    <button type="button" className={className} data-layer={chip.layer} title={`Set in ${chip.path}. Open the file.`} onClick={() => state.open(chip)}>
      {chip.label}
    </button>
  );
}

/** Which file Settings writes to while a project is open. */
export function SaveToControl({ value, onChange, projectName }: { value: WritableScope; onChange: (scope: WritableScope) => void; projectName?: string }) {
  const selected = SAVE_TARGETS.find((item) => item.scope === value) ?? SAVE_TARGETS[0]!;
  return (
    <div className="save-to">
      <span className="save-to-label" id="save-to-label">Save to</span>
      <div className="save-to-options" role="radiogroup" aria-labelledby="save-to-label">
        {SAVE_TARGETS.map((item) => (
          <button
            key={item.scope}
            type="button"
            role="radio"
            aria-checked={item.scope === value}
            className={item.scope === value ? "active" : ""}
            title={item.detail}
            onClick={() => onChange(item.scope)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <span className="save-to-detail">
        {value === "user" ? selected.detail : `${projectName ?? "This project"}: ${selected.detail.replace(/^The project's /, "")}`}
      </span>
    </div>
  );
}
