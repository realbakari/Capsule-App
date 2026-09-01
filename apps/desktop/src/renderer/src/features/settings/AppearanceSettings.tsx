import { useEffect, useState } from "react";
import {
  appearanceCssVars,
  type AppearanceCodeFont,
  type AppearancePalette,
  type AppearanceTheme,
  type AppearanceUiFont,
  type CapsuleSettings,
  type TranscriptSize,
  type TranscriptWidth,
} from "@capsule/shared";
import { SettingRow } from "./controls";

const THEMES: Array<{ id: AppearanceTheme; label: string }> = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];
const UI_FONTS: Array<{ id: AppearanceUiFont; label: string }> = [
  { id: "system", label: "System" },
  { id: "rounded", label: "Rounded" },
  { id: "serif", label: "Serif" },
];
const CODE_FONTS: Array<{ id: AppearanceCodeFont; label: string }> = [
  { id: "sf-mono", label: "SF Mono" },
  { id: "menlo", label: "Menlo" },
  { id: "jetbrains", label: "JetBrains Mono" },
];
const TRANSCRIPT_SIZES: Array<{ id: TranscriptSize; label: string }> = [
  { id: "s", label: "Small" },
  { id: "m", label: "Default" },
  { id: "l", label: "Large" },
];
const TRANSCRIPT_WIDTHS: Array<{ id: TranscriptWidth; label: string }> = [
  { id: "narrow", label: "Narrow" },
  { id: "standard", label: "Default" },
  { id: "wide", label: "Wide" },
];

export function AppearanceSettings({
  settings,
  onPatch,
}: {
  settings: CapsuleSettings;
  onPatch: (next: Partial<CapsuleSettings>) => void;
}) {
  return (
    <div className="appearance-page">
      <div className="card">
        <h3>Appearance</h3>
        <p className="muted">
          Theme, transcript sizing, and the code font. Colors, contrast, and the
          translucent sidebar are set separately for Light and Dark below.
        </p>
        <div className="theme-picker" role="radiogroup" aria-label="Theme">
          {THEMES.map((item) => (
            <ThemeCard
              key={item.id}
              id={item.id}
              label={item.label}
              selected={settings.appearanceTheme === item.id}
              light={settings.appearanceLight}
              dark={settings.appearanceDark}
              onSelect={() => onPatch({ appearanceTheme: item.id })}
            />
          ))}
        </div>
        <SettingRow
          label="Transcript text size"
          hint="Size of the conversation transcript text."
        >
          <select
            className="field-select"
            value={settings.transcriptSize}
            onChange={(event) =>
              onPatch({ transcriptSize: event.target.value as TranscriptSize })
            }
          >
            {TRANSCRIPT_SIZES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </SettingRow>
        {/*
          * A live sample. These read the same custom properties the
          * transcript itself does (--text-message,
          * --mono, --chat-max), so they are the real result of the setting
          * rather than a mock-up that can drift from it.
          */}
        <div className="type-preview" aria-hidden>
          <p className="type-preview-prose">
            The agent edited three files and left the tests passing.
          </p>
          <pre className="type-preview-code">
            <code>{"export function formatUser(user: User) {\n  return `${user.name} <${user.email}>`; // 0O 1lI\n}"}</code>
          </pre>
        </div>
        <SettingRow
          label="Transcript width"
          hint="Maximum width of the transcript and composer columns."
        >
          <select
            className="field-select"
            value={settings.transcriptWidth}
            onChange={(event) =>
              onPatch({ transcriptWidth: event.target.value as TranscriptWidth })
            }
          >
            {TRANSCRIPT_WIDTHS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </SettingRow>
        {/* Driven by --chat-max, the transcript's own column width, so the
            options stay in true proportion to one another. */}
        <div className="width-preview" aria-hidden>
          <div className="width-preview-column">
            <span />
            <span />
            <span />
          </div>
        </div>
        <SettingRow
          label="Custom code font"
          hint="Optional monospace family for code and the terminal, e.g. JetBrains Mono."
        >
          <input
            className="field-select"
            key={settings.customCodeFont ?? ""}
            defaultValue={settings.customCodeFont ?? ""}
            placeholder="e.g. JetBrains Mono"
            spellCheck={false}
            onBlur={(event) => onPatch({ customCodeFont: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </SettingRow>
      </div>
      <PaletteEditor
        title="Light theme"
        hint="Used when Theme is Light, or when System follows a light Mac."
        palette={settings.appearanceLight}
        kind="light"
        onChange={(appearanceLight) => onPatch({ appearanceLight })}
      />
      <PaletteEditor
        title="Dark theme"
        hint="Used when Theme is Dark, or when System follows a dark Mac."
        palette={settings.appearanceDark}
        kind="dark"
        onChange={(appearanceDark) => onPatch({ appearanceDark })}
      />
    </div>
  );
}

function ThemeCard({
  id,
  label,
  selected,
  light,
  dark,
  onSelect,
}: {
  id: AppearanceTheme;
  label: string;
  selected: boolean;
  light: AppearancePalette;
  dark: AppearancePalette;
  onSelect: () => void;
}) {
  const preview = id === "light" ? light : dark;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={`theme-card ${selected ? "active" : ""}`}
      onClick={onSelect}
    >
      <span className="theme-card-stage" data-kind={id === "system" ? "split" : id}>
        {id === "system" ? (
          <>
            <MiniChrome palette={light} />
            <MiniChrome palette={dark} />
          </>
        ) : (
          <MiniChrome palette={preview} />
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

function MiniChrome({ palette }: { palette: AppearancePalette }) {
  const vars = appearanceCssVars(palette);
  return (
    <span
      className="theme-mini"
      style={{
        background: vars["--bg"],
        color: vars["--text"],
        ["--preview-accent" as string]: palette.accent,
      }}
    >
      <span className="theme-mini-sidebar" style={{ background: vars["--bg-sidebar"] }} />
      <span className="theme-mini-body">
        <span className="theme-mini-line" />
        <span className="theme-mini-line short" />
        <span className="theme-mini-accent" />
      </span>
    </span>
  );
}

function PaletteEditor({
  title,
  hint,
  palette,
  kind,
  onChange,
}: {
  title: string;
  hint: string;
  palette: AppearancePalette;
  kind: "light" | "dark";
  onChange: (next: AppearancePalette) => void;
}) {
  function set<K extends keyof AppearancePalette>(key: K, value: AppearancePalette[K]) {
    onChange({ ...palette, [key]: value });
  }
  return (
    <div className="card appearance-editor" data-kind={kind}>
      <div className="appearance-editor-head">
        <div>
          <h3>{title}</h3>
          <p className="muted">{hint}</p>
        </div>
        <div
          className="appearance-aa"
          style={{ background: palette.background, color: palette.foreground, borderColor: palette.accent }}
        >
          Aa
        </div>
      </div>
      <ColorField
        label="Accent"
        hint={kind === "light" ? "Light accent color" : "Dark accent color"}
        value={palette.accent}
        onChange={(accent) => set("accent", accent)}
      />
      <ColorField
        label="Background"
        hint={kind === "light" ? "Light background color" : "Dark background color"}
        value={palette.background}
        onChange={(background) => set("background", background)}
      />
      <ColorField
        label="Foreground"
        hint={kind === "light" ? "Light ink color" : "Dark ink color"}
        value={palette.foreground}
        onChange={(foreground) => set("foreground", foreground)}
      />
      <label className="setting">
        <div className="setting-copy">
          <div>UI font</div>
        </div>
        <div className="setting-control">
          <select
            className="field-select"
            value={palette.uiFont}
            onChange={(event) => set("uiFont", event.target.value as AppearanceUiFont)}
          >
            {UI_FONTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </label>
      <label className="setting">
        <div className="setting-copy">
          <div>Code font</div>
        </div>
        <div className="setting-control">
          <select
            className="field-select"
            value={palette.codeFont}
            onChange={(event) => set("codeFont", event.target.value as AppearanceCodeFont)}
          >
            {CODE_FONTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </div>
      </label>
      <div className="setting">
        <div className="setting-copy">
          <div>Translucent sidebar</div>
          <p>Frosted glass over the sidebar surface.</p>
        </div>
        <div className="setting-control">
          <label className="switch">
            <input
              type="checkbox"
              checked={palette.translucentSidebar}
              aria-label="Translucent sidebar"
              onChange={(event) => set("translucentSidebar", event.target.checked)}
            />
            <span />
          </label>
        </div>
      </div>
      <div className="setting contrast-row">
        <div className="setting-copy">
          <div>Contrast</div>
          <p>Separation between sidebar, panels, and the page.</p>
        </div>
        <div className="setting-control contrast-control">
          <span className="mono">{palette.contrast}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={palette.contrast}
            aria-label={`${kind} contrast`}
            onChange={(event) => set("contrast", Number(event.target.value))}
          />
        </div>
      </div>
    </div>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  return (
    <label className="setting color-field">
      <div className="setting-copy">
        <div>{label}</div>
        <p>{hint}</p>
      </div>
      <div className="setting-control color-control">
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(value) ? value : "#F3F3EE"}
          aria-label={label}
          onChange={(event) => {
            setDraft(event.target.value.toUpperCase());
            onChange(event.target.value.toUpperCase());
          }}
        />
        <input
          className="mono color-hex"
          data-color-field={label}
          value={draft}
          spellCheck={false}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onChange(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            }
          }}
        />
      </div>
    </label>
  );
}
