import { useEffect, useState } from "react";
import { BACKDROP_SCENES, SCENE_LABELS, type BackdropFit, type BackdropScene, type ThemeBackdrop } from "@capsule/shared";
import { previewBackdropScene } from "../../lib/appearance";
import { formatUserError } from "../../lib/errors";
import { useWorkspace } from "../../lib/workspace";
import { useThemeWriter } from "./ThemePicker";
import "./appearance.css";

type Tile = BackdropScene | "none";
const TILES: Tile[] = ["none", ...BACKDROP_SCENES];

function currentAppearance(): "light" | "dark" {
  return typeof document !== "undefined" && document.documentElement.dataset.surface === "light" ? "light" : "dark";
}

/**
 * Settings → Appearance → Backdrop. Scenes preview on hover or focus. What
 * is written goes into `theme.backdrop` in your settings file, over whatever
 * the theme itself draws.
 */
export function BackdropCard() {
  const { api, config } = useWorkspace();
  const writeTheme = useThemeWriter();
  const desktop = api.isDesktop === true;
  const [error, setError] = useState<string>();
  useEffect(() => () => previewBackdropScene(undefined), []);
  const state = config?.themes;
  const appearance = currentAppearance();
  const view = state?.backdrop[appearance];
  const own = state?.selection.backdrop;
  const [draft, setDraft] = useState<{ opacity: number; dim: number; blur: number }>();
  const shown = draft ?? { opacity: view?.opacity ?? 1, dim: view?.dim ?? 0, blur: view?.blur ?? 0 };
  if (!state) return null;

  const write = (change: (backdrop: ThemeBackdrop) => ThemeBackdrop | undefined) => {
    setError(undefined);
    if (!desktop) {
      setError("Changing the backdrop is available in the desktop app.");
      return;
    }
    void writeTheme((current) => ({ ...current, backdrop: change(current.backdrop ?? {}) }))
      .catch((reason: unknown) => setError(formatUserError(reason)))
      .finally(() => setDraft(undefined));
  };
  const pick = (tile: Tile) => {
    previewBackdropScene(undefined);
    write(({ image: _image, ...rest }) => ({ ...rest, scene: tile }));
  };
  const commit = () => {
    if (!draft) return;
    write((backdrop) => ({ ...backdrop, ...draft }));
  };
  const active: Tile | "image" = view?.imageUrl ? "image" : (view?.scene ?? "none");
  const slider = (key: "opacity" | "dim" | "blur", label: string, max: number, unit: string) => (
    <label className="backdrop-slider">
      <span>{label}</span>
      <input
        type="range"
        min={0}
        max={max}
        step={key === "blur" ? 1 : 0.05}
        value={shown[key]}
        disabled={!view}
        aria-label={`Backdrop ${label.toLowerCase()}`}
        onChange={(event) => setDraft({ ...shown, [key]: Number(event.target.value) })}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="mono">{key === "blur" ? `${shown[key]}${unit}` : `${Math.round(shown[key] * 100)}${unit}`}</span>
    </label>
  );

  return (
    <div className="card backdrop-card">
      <h3>Backdrop</h3>
      <p className="muted">Drawn behind the conversation, under the transcript and composer. Capsule veils it when text would be hard to read.</p>
      <div className="backdrop-tiles" role="radiogroup" aria-label="Backdrop" onMouseLeave={() => previewBackdropScene(undefined)}>
        {TILES.map((tile) => (
          <button
            key={tile}
            type="button"
            role="radio"
            aria-checked={active === tile}
            className={`backdrop-tile${active === tile ? " active" : ""}`}
            onMouseEnter={() => previewBackdropScene(tile)}
            onFocus={() => previewBackdropScene(tile)}
            onBlur={() => previewBackdropScene(undefined)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                previewBackdropScene(undefined);
              }
            }}
            onClick={() => pick(tile)}
          >
            <span className="backdrop-tile-stage" data-scene={tile} aria-hidden="true" />
            <span>{tile === "none" ? "None" : SCENE_LABELS[tile]}</span>
          </button>
        ))}
        {view?.imageUrl && (
          <button type="button" role="radio" aria-checked className="backdrop-tile active" title={view.imageName}>
            <span className="backdrop-tile-stage" style={{ backgroundImage: `url("${view.imageUrl}")` }} aria-hidden="true" />
            <span className="backdrop-tile-name">{view.imageName ?? "Image"}</span>
          </button>
        )}
      </div>
      <div className="backdrop-controls">
        {slider("opacity", "Opacity", 1, "%")}
        {slider("dim", "Dim", 1, "%")}
        {slider("blur", "Blur", 40, "px")}
        {view?.imageUrl && (
          <label className="backdrop-slider">
            <span>Fit</span>
            <select className="field-select" value={view.fit} onChange={(event) => write((backdrop) => ({ ...backdrop, fit: event.target.value as BackdropFit }))}>
              <option value="cover">Fill</option>
              <option value="contain">Fit</option>
              <option value="tile">Tile</option>
            </select>
          </label>
        )}
      </div>
      <div className="backdrop-actions">
        <button type="button" className="ghost" disabled={!desktop} onClick={() => {
          setError(undefined);
          void api.backdropChooseImage().catch((reason: unknown) => setError(formatUserError(reason)));
        }}>Choose image…</button>
        <button type="button" className="ghost" disabled={!desktop || !own} onClick={() => write(() => undefined)}>Reset</button>
      </div>
      <p className="muted theme-note">Images show on this computer only. A paired device shows scenes.</p>
      {error && <p className="theme-message is-error" role="alert">{error}</p>}
    </div>
  );
}
