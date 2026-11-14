import { useEffect, useState } from "react";
import {
  appearanceCssVars,
  DEFAULT_DARK_PALETTE,
  DEFAULT_LIGHT_PALETTE,
  type AppearanceCodeFont,
  type AppearancePalette,
  type AppearanceTheme,
  type AppearanceUiFont,
  type CapsuleSettings,
  type ThemeSummary,
  type TranscriptSize,
  type TranscriptWidth,
} from "@capsule/shared";
import {
  resolveThemeTokens,
  themeColorHex,
} from "@capsule/shared";
import { SettingRow } from "./controls";
import { SettingSource } from "../customization/SettingSource";
import { BackdropCard } from "../appearance/BackdropCard";
import { ThemesCard } from "../appearance/ThemePicker";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";

/** The token each palette colour stands for, when a theme other than the built-in is chosen. */
const COLOUR_TOKENS = { accent: "accent", background: "base", foreground: "text" } as const;
type ColourKey = keyof typeof COLOUR_TOKENS;

/**
 * With Capsule Light or Dark chosen, the palette's colours are the theme.
 * With another theme, they show that theme's colours, and a change is
 * written to `themeOverrides` for it, as a Customize layer on the theme.
 */
function useThemeColours(appearance: "light" | "dark") {
  const { config, setConfigValue } = useWorkspace();
  const state = config?.themes;
  const theme = state?.themes.find((item) => item.id === state[appearance]);
  if (!state || !theme || theme.builtin) return undefined;
  const resolved = resolveThemeTokens({ id: theme.id, name: theme.name, appearance: theme.appearance, tokens: theme.tokens }, theme.appearance);
  const own = state.overrides[theme.id] ?? {};
  const write = (next: Record<string, string>) => setConfigValue({
    key: "themeOverrides",
    value: Object.keys(next).length ? { ...state.overrides, [theme.id]: next } : Object.fromEntries(Object.entries(state.overrides).filter(([id]) => id !== theme.id)),
    scope: "user",
  });
  return {
    theme,
    colours: Object.fromEntries((Object.keys(COLOUR_TOKENS) as ColourKey[]).map((key) => [key, themeColorHex(resolved[COLOUR_TOKENS[key]]) ?? "#000000"])) as Record<ColourKey, string>,
    customized: (Object.values(COLOUR_TOKENS) as string[]).some((token) => token in own),
    set: (key: ColourKey, value: string) => write({ ...own, [COLOUR_TOKENS[key]]: value }),
    reset: () => write(Object.fromEntries(Object.entries(own).filter(([token]) => !(Object.values(COLOUR_TOKENS) as string[]).includes(token)))),
  };
}

export type ThemeColours = NonNullable<ReturnType<typeof useThemeColours>>;

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
  const light = settings.appearanceLight ?? DEFAULT_LIGHT_PALETTE;
  const dark = settings.appearanceDark ?? DEFAULT_DARK_PALETTE;
  const lightTheme = useThemeColours("light");
  const darkTheme = useThemeColours("dark");

  return (
    <div className="appearance-page">
      <div className="card">
        <h3>Theme and text<SettingSource setting="appearanceTheme" /></h3>
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
              light={light}
              dark={dark}
              onSelect={() => onPatch({ appearanceTheme: item.id })}
            />
          ))}
        </div>
        <SettingRow
          label="Transcript text size" setting="transcriptSize"
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
        <div className="appearance-sample" aria-hidden="true">
          <div className="appearance-sample-label">Preview</div>
          <div className="appearance-sample-bubble">
            <code>export async function verify(contract: Contract)</code>
            <p>Runs the contract test suite against the changed files.</p>
          </div>
        </div>
        <SettingRow
          label="Transcript width" setting="transcriptWidth"
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
        <SettingRow label="Time format" setting="timeFormat" hint="How message times are written.">
          <select
            className="field-select"
            value={settings.timeFormat}
            onChange={(event) => onPatch({ timeFormat: event.target.value as CapsuleSettings["timeFormat"] })}
          >
            <option value="system">System default</option>
            <option value="12h">12-hour</option>
            <option value="24h">24-hour</option>
          </select>
        </SettingRow>
        <SettingRow label="Tool calls" setting="toolCallDisplay" hint="Whether a turn's tool calls start folded to one line or listed in full.">
          <select
            className="field-select"
            value={settings.toolCallDisplay}
            onChange={(event) => onPatch({ toolCallDisplay: event.target.value as CapsuleSettings["toolCallDisplay"] })}
          >
            <option value="compact">Folded to one line</option>
            <option value="expanded">Listed in full</option>
          </select>
        </SettingRow>
        <SettingRow
          label="Custom code font" setting="customCodeFont"
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
      <ThemesCard />
      <BackdropCard />
      <PaletteEditor
        title="Light theme"
        hint="Used when Theme is Light, or when System follows a light Mac."
        palette={light}
        kind="light"
        theme={lightTheme}
        onChange={(appearanceLight) => onPatch({ appearanceLight })}
      />
      <PaletteEditor
        title="Dark theme"
        hint="Used when Theme is Dark, or when System follows a dark Mac."
        palette={dark}
        kind="dark"
        theme={darkTheme}
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
  theme,
  onChange,
}: {
  title: string;
  hint: string;
  palette: AppearancePalette;
  kind: "light" | "dark";
  theme?: ThemeColours;
  onChange: (next: AppearancePalette) => void;
}) {
  const [error, setError] = useState<string>();
  function set<K extends keyof AppearancePalette>(key: K, value: AppearancePalette[K]) {
    onChange({ ...palette, [key]: value });
  }
  const colour = (key: ColourKey) => theme ? theme.colours[key] : palette[key];
  const setColour = (key: ColourKey, value: string) => {
    if (!theme) {
      set(key, value);
      return;
    }
    if (!/^#?[0-9a-f]{6}$/i.test(value.trim())) return;
    setError(undefined);
    void theme.set(key, value.trim().startsWith("#") ? value.trim() : `#${value.trim()}`).catch((reason: unknown) => setError(formatUserError(reason)));
  };
  return (
    <div className="card appearance-editor" data-kind={kind}>
      <div className="appearance-editor-head">
        <div>
          <h3>{theme ? `${title} · ${theme.theme.name}` : title}</h3>
          <p className="muted">{theme ? `The colours below customize ${theme.theme.name}. Fonts, contrast and the sidebar apply to every theme.` : hint}</p>
          {theme?.customized && (
            <button type="button" className="ghost palette-reset" onClick={() => void theme.reset().catch((reason: unknown) => setError(formatUserError(reason)))}>
              Use {theme.theme.name}'s own colours
            </button>
          )}
          {error && <p className="theme-message is-error" role="alert">{error}</p>}
        </div>
        <div
          className="appearance-aa"
          style={{ background: colour("background"), color: colour("foreground"), borderColor: colour("accent") }}
        >
          Aa
        </div>
      </div>
      <ColorField
        label="Accent"
        hint={kind === "light" ? "Light accent color" : "Dark accent color"}
        value={colour("accent")}
        onChange={(accent) => setColour("accent", accent)}
      />
      <ColorField
        label="Background"
        hint={kind === "light" ? "Light background color" : "Dark background color"}
        value={colour("background")}
        onChange={(background) => setColour("background", background)}
      />
      <ColorField
        label="Foreground"
        hint={kind === "light" ? "Light ink color" : "Dark ink color"}
        value={colour("foreground")}
        onChange={(foreground) => setColour("foreground", foreground)}
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
