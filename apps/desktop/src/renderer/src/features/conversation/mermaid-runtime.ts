import mermaid from "mermaid";
import type { SurfaceTheme } from "../../lib/surface-theme";

let serial = 0;
let queue: Promise<unknown> = Promise.resolve();

/*
 * Mermaid keeps one global configuration, so renders take turns: a theme
 * switch must not land between another diagram's initialize and render.
 * "strict" escapes labels and drops click handlers; SVG text labels keep the
 * diagram drawable as a plain image in the zoom view.
 */
export function renderMermaid(code: string, theme: SurfaceTheme): Promise<string> {
  const run = queue.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: theme === "dark" ? "dark" : "neutral",
      htmlLabels: false,
      suppressErrorRendering: true,
      fontFamily: getComputedStyle(document.body).fontFamily,
    });
    const { svg } = await mermaid.render(`capsule-mermaid-${++serial}`, code);
    return svg;
  });
  queue = run.catch(() => undefined);
  return run;
}
