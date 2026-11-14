import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  encodeThemeShareString,
  resolveThemeTokens,
  type ThemeAppearance,
  type ThemeSelection,
  type ThemeState,
  type ThemeSummary,
} from "@capsule/shared";
import { previewThemeId } from "../../lib/appearance";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import "./appearance.css";

const SOURCE_LABELS: Record<ThemeSummary["source"], string> = { bundled: "Built in", user: "Yours", project: "Project", plugin: "Plugin" };

/** `theme` with empty parts dropped, so a reset leaves no `{}` behind in the file. */
export function prunedSelection(selection: ThemeSelection): ThemeSelection | undefined {
  const next = Object.fromEntries(Object.entries(selection).filter(([, value]) => value !== undefined && !(typeof value === "object" && Object.keys(value).length === 0)));
  return Object.keys(next).length ? next : undefined;
}

/** Writes `theme` to your settings file. Built-in picks are removed, since they are the default. */
export function useThemeWriter() {
  const { config, setConfigValue } = useWorkspace();
  return (change: (current: ThemeSelection) => ThemeSelection) => {
    const current = config?.themes.selection ?? {};
    return setConfigValue({ key: "theme", value: prunedSelection(change(current)), scope: "user" });
  };
}

function shareTheme(theme: ThemeSummary): string {
  return encodeThemeShareString({ id: theme.id, name: theme.name, appearance: theme.appearance, tokens: theme.tokens, ...(theme.backdrop ? { backdrop: theme.backdrop } : {}) });
}

/**
 * Settings → Appearance → Themes. Resting the pointer or keyboard focus on a
 * theme shows it at once; leaving the list or Escape goes back. Click or
 * Enter chooses it.
 */
export function ThemesCard() {
  const { api, config } = useWorkspace();
  const state = config?.themes;
  const writeTheme = useThemeWriter();
  const desktop = api.isDesktop === true;
  const [share, setShare] = useState("");
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string }>();
  useEffect(() => () => previewThemeId(undefined), []);
  if (!state) return null;

  const choose = (appearance: ThemeAppearance, id: string) => {
    previewThemeId(undefined);
    if (!desktop) {
      setMessage({ tone: "info", text: "Choosing a theme is available in the desktop app." });
      return;
    }
    void writeTheme((current) => ({ ...current, [appearance]: id === `capsule-${appearance}` ? undefined : id })).catch((error: unknown) => setMessage({ tone: "error", text: formatUserError(error) }));
  };

  const imported = async (run: () => Promise<Awaited<ReturnType<typeof api.themesImport>>>) => {
    setMessage(undefined);
    try {
      const result = await run();
      if (!result.imported) return;
      await writeTheme((current) => ({ ...current, [result.appearance]: result.id }));
      const notes = result.problems.map((problem) => problem.message).join(" ");
      setMessage({ tone: "info", text: `Imported ${result.name} and chose it for ${result.appearance}.${notes ? ` ${notes}` : ""}` });
      setShare("");
    } catch (error) {
      setMessage({ tone: "error", text: formatUserError(error) });
    }
  };

  return (
    <div className="card themes-card">
      <h3>Themes</h3>
      <p className="muted">One theme for Light and one for Dark. Point at a theme to try it; choose it to keep it.</p>
      <div className="theme-lists">
        {(["light", "dark"] as const).map((appearance) => (
          <ThemeList
            key={appearance}
            appearance={appearance}
            state={state}
            onChoose={(id) => choose(appearance, id)}
            onCopy={(theme) => {
              void navigator.clipboard.writeText(shareTheme(theme)).then(
                () => setMessage({ tone: "info", text: `Copied ${theme.name} as a share string.` }),
                () => setMessage({ tone: "error", text: "Could not copy to the clipboard." }),
              );
            }}
          />
        ))}
      </div>
      <div className="theme-import">
        <input
          className="field-select mono"
          value={share}
          placeholder="Paste a share string"
          spellCheck={false}
          aria-label="Theme share string"
          disabled={!desktop}
          onChange={(event) => setShare(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && share.trim()) void imported(() => api.themesImport({ from: "share", text: share }));
          }}
        />
        <button type="button" className="chip" disabled={!desktop || !share.trim()} onClick={() => void imported(() => api.themesImport({ from: "share", text: share }))}>
          Import
        </button>
        <button type="button" className="ghost" disabled={!desktop} onClick={() => void imported(() => api.themesImport({ from: "file" }))}>
          Import file…
        </button>
        <button
          type="button"
          className="ghost"
          disabled={!desktop}
          onClick={() => void api.configOpenFile({ kind: "folder", folder: "themes", scope: "user" }).catch((error: unknown) => setMessage({ tone: "error", text: formatUserError(error) }))}
        >
          Open themes folder
        </button>
      </div>
      {!desktop && <p className="muted theme-note">Importing a theme is available in the desktop app.</p>}
      {message && <p className={`theme-message${message.tone === "error" ? " is-error" : ""}`} role={message.tone === "error" ? "alert" : "status"}>{message.text}</p>}
    </div>
  );
}

function Swatch({ theme }: { theme: ThemeSummary }) {
  const tokens = resolveThemeTokens({ id: theme.id, name: theme.name, appearance: theme.appearance, tokens: theme.tokens }, theme.appearance);
  return (
    <span className="theme-swatch" style={{ background: tokens.base, borderColor: tokens["border-color"] }} aria-hidden="true">
      <span style={{ background: tokens["surface-1"] }} />
      <span style={{ background: tokens.text }} />
      <span style={{ background: tokens.accent }} />
    </span>
  );
}

function ThemeList({ appearance, state, onChoose, onCopy }: {
  appearance: ThemeAppearance;
  state: ThemeState;
  onChoose: (id: string) => void;
  onCopy: (theme: ThemeSummary) => void;
}) {
  const rank = (theme: ThemeSummary) => (theme.builtin ? 0 : theme.source === "bundled" ? 1 : 2);
  const themes = state.themes.filter((theme) => theme.appearance === appearance).sort((a, b) => rank(a) - rank(b));
  const selected = state[appearance];
  const list = useRef<HTMLDivElement>(null);
  const chosen = themes.find((theme) => theme.id === selected);

  const focusAt = (index: number) => {
    const options = list.current?.querySelectorAll<HTMLElement>("[role=option]");
    options?.[(index + (options.length || 1)) % (options.length || 1)]?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number, id: string) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      focusAt(index + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      focusAt(event.key === "Home" ? 0 : themes.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onChoose(id);
    } else if (event.key === "Escape") {
      event.stopPropagation();
      previewThemeId(undefined);
    }
  };

  return (
    <div className="theme-list-wrap">
      <div className="theme-list-head">
        <span>{appearance === "light" ? "Light" : "Dark"}</span>
        {chosen && <button type="button" className="ghost theme-copy" onClick={() => onCopy(chosen)}>Copy share string</button>}
      </div>
      <div
        ref={list}
        className="theme-list"
        role="listbox"
        aria-label={`${appearance === "light" ? "Light" : "Dark"} themes`}
        onMouseLeave={() => previewThemeId(undefined)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) previewThemeId(undefined);
        }}
      >
        {themes.map((theme, index) => {
          const active = theme.id === selected;
          return (
            <div
              key={theme.id}
              role="option"
              aria-selected={active}
              tabIndex={active || (!chosen && index === 0) ? 0 : -1}
              className={`theme-option${active ? " active" : ""}`}
              title={theme.path}
              onMouseEnter={() => previewThemeId(theme.id)}
              onFocus={() => previewThemeId(theme.id)}
              onClick={() => onChoose(theme.id)}
              onKeyDown={(event) => onKeyDown(event, index, theme.id)}
            >
              <Swatch theme={theme} />
              <span className="theme-option-name">{theme.name}</span>
              {theme.contrast.length > 0 && (
                <span className="theme-option-warning" title={theme.contrast.map((warning) => warning.message).join("\n")}>
                  {theme.contrast.length} low contrast
                </span>
              )}
              <span className="theme-option-source">{SOURCE_LABELS[theme.source]}</span>
            </div>
          );
        })}
      </div>
      {chosen && chosen.contrast.length > 0 && (
        <details className="theme-contrast">
          <summary>{chosen.name} has {chosen.contrast.length} {chosen.contrast.length === 1 ? "pair" : "pairs"} under 4.5:1</summary>
          <ul>{chosen.contrast.map((warning) => <li key={`${warning.foreground}-${warning.background}`}>{warning.message}</li>)}</ul>
        </details>
      )}
    </div>
  );
}
