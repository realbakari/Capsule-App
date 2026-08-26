import type { ReactNode } from "react";

export function SettingRow({
  label,
  hint,
  children,
  stacked,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div className={`setting ${stacked ? "setting-stacked" : ""}`}>
      <div className="setting-copy">
        <div>{label}</div>
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
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span />
    </label>
  );
}
