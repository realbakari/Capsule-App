import type { ReactNode } from "react";
import type { FileSettingKey } from "@capsule/shared";
import { SettingSource, useUserOnlyHint } from "../customization/SettingSource";

export function SettingRow({
  label,
  hint,
  children,
  stacked,
  setting,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  stacked?: boolean;
  /** The settings-file key this row edits, so the row can show which file set it. */
  setting?: FileSettingKey;
}) {
  return (
    <div className={`setting ${stacked ? "setting-stacked" : ""}`} title={useUserOnlyHint(setting)}>
      <div className="setting-copy">
        <div>{label}{setting ? <SettingSource setting={setting} /> : null}</div>
        {hint ? <p>{hint}</p> : null}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
  title,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Why it is off, said on hover. */
  title?: string;
}) {
  return (
    <label className="switch" title={title}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span />
    </label>
  );
}
