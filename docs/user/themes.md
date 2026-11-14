# Themes and backdrops

A theme sets Capsule's colours. You choose one theme for Light and one for
Dark; **Theme** in Settings → Appearance still decides which of the two shows,
or follows your Mac.

## Choosing a theme

Settings → Appearance → **Themes** lists every theme, Light on one side and
Dark on the other. Point at a theme, or move to it with the arrow keys, and the
whole window shows it at once. Move away or press `Esc` and your own theme
comes back. Click a theme or press `Enter` to keep it.

Capsule Light and Capsule Dark are coloured by the Light and Dark palettes
further down the page, exactly as before themes existed. With another theme
chosen, the palette's Accent, Background and Foreground show that theme's
colours, and changing one customizes that theme for you. **Use … own colours**
puts it back. Fonts, contrast and the translucent sidebar apply to every theme.

A theme whose text and background pairs read under 4.5:1 says so on its row,
and the pairs are listed under the list.

## Theme files

A theme is a JSON file in the `themes` folder of your settings folder
(`~/.capsule/themes/`), or in a project's `.capsule/themes/`. The file name is
the theme's id.

```json
{
  "$schema": "https://raw.githubusercontent.com/realbakari/Capsule-App/main/schemas/theme.schema.json",
  "name": "Dusk",
  "appearance": "dark",
  "tokens": {
    "base": "#14121c",
    "text": "#ece8f4",
    "accent": "#c9b37e"
  },
  "syntax": { "keyword": "#9fb4ff" },
  "backdrop": { "scene": "night" }
}
```

- `appearance` is `light` or `dark`. A theme is offered only for its own
  appearance.
- `tokens` names the colours Capsule draws with: `base`, `text`, `accent`,
  `surface-0`, `code-bg`, `syntax-keyword` and the rest. The schema lists every
  token with its built-in light and dark value. A token you leave out keeps the
  built-in value.
- `syntax` is a shorter way to write the `syntax-*` tokens.
- Colours are hex, `rgb()`, `hsl()` or `oklch()`. Anything else is skipped.

Edit a file and Capsule picks up the change. A file that does not parse, or a
wrong value, is listed in Settings → Diagnostics with its line, and the rest of
your themes still load. A project theme with the same id as one of yours wins
while that project is open.

To set colours on top of any theme without editing its file, use
`themeOverrides` in your settings file, keyed by theme id:

```json
{ "theme": { "dark": "dusk" }, "themeOverrides": { "dusk": { "accent": "#e0c27a" } } }
```

## Sharing a theme

**Copy share string** above each list copies the chosen theme as one line of
text that starts with `capsule-theme:`. Paste one into the field under the lists
and press **Import** to add it to your themes and choose it. **Import file…**
adds a theme file from anywhere on your Mac, and **Open themes folder** shows
the folder.

A share string carries a backdrop's scene and its numbers, never an image, so it
cannot point at a file on someone's disk. A theme file imported from elsewhere
leaves its image behind for the same reason.

## Backdrops

A backdrop is drawn behind the conversation, under the transcript and the
composer. The sidebar, the side panel and the titlebar keep their own surfaces.

Settings → Appearance → **Backdrop**:

- **Scenes.** Grain, Mesh, Night, Dots and Paper are drawn by Capsule from the
  theme's own colours, so each one suits light and dark. None of them moves.
  Point at a scene to see it.
- **Choose image…** copies a png, jpg, webp or gif of up to 8 MB into the
  `backdrops` folder of your settings folder and draws it instead of a scene.
  **Fit** fills the column, fits the whole image, or tiles it.
- **Opacity**, **Dim** and **Blur** change how strongly it shows. Dim lays the
  page colour over it.
- **Reset** goes back to whatever the chosen theme draws.
  **Clear backdrop** in the command palette turns it off.

Capsule keeps text readable over a backdrop. When the backdrop would leave the
text under 4.5:1, it veils it with the page colour until the text reads, and
never less than your own Dim.

A theme can declare a backdrop, and your settings override it field by field:

```json
{
  "theme": {
    "dark": "dusk",
    "backdrop": { "dim": 0.3, "light": { "scene": "paper" } }
  }
}
```

`backdrop` takes `scene` (`grain`, `mesh`, `night`, `dots`, `paper` or `none`),
`image`, `fit` (`cover`, `contain` or `tile`), `opacity` and `dim` from 0 to 1,
and `blur` in pixels. `light` and `dark` hold the same fields for one
appearance. An image path is relative to the theme file, or to your settings
folder for settings, and must stay inside one of those two folders. Addresses
on the web are never loaded. An image that cannot be used is listed in
Diagnostics and nothing is drawn.

## On a paired device

A paired browser shows your themes and scene backdrops. Images stay on this
computer, so a paired device shows no image. Choosing or importing a theme, and
changing the backdrop, are available in the desktop app.
