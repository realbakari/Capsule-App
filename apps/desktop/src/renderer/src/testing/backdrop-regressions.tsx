import { createRoot } from "react-dom/client";
import { appearanceCssVars, DEFAULT_DARK_PALETTE, DEFAULT_LIGHT_PALETTE } from "@capsule/shared";
import { MarkdownBody } from "../features/conversation/MarkdownBody";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

function alpha(color: string): number {
  const parts = color.match(/[\d.]+/g)?.map(Number) ?? [];
  if (color.startsWith("color(")) return parts.length > 4 ? parts[4]! : 1;
  return parts.length > 3 ? parts[3]! : 1;
}

const REPLY = "Run `pnpm test` first.\n\n```ts\n// one window per account\nexport const limit = 10;\n```";

/** Code in a reply keeps a surface of its own over every backdrop, and loses nothing without one. */
export async function runBackdropRegressions(host: HTMLElement) {
  const root = createRoot(host);
  const html = document.documentElement;
  const previous = { theme: html.getAttribute("data-theme"), backdrop: html.getAttribute("data-backdrop") };
  try {
    for (const theme of ["dark", "light"] as const) {
      html.setAttribute("data-theme", theme);
      const palette = theme === "dark" ? DEFAULT_DARK_PALETTE : DEFAULT_LIGHT_PALETTE;
      for (const backdrop of [undefined, "dots", "image"]) {
        if (backdrop) html.setAttribute("data-backdrop", backdrop);
        else html.removeAttribute("data-backdrop");
        const identity = `${theme}-${backdrop ?? "none"}`;
        root.render(<section className="main" data-backdrop-fixture={identity} style={appearanceCssVars(palette)}>
          <div className="conversation-backdrop" aria-hidden="true" />
          <div className="conversation"><MarkdownBody content={REPLY} /></div>
        </section>);
        for (let i = 0; i < 300 && host.querySelector("[data-backdrop-fixture]")?.getAttribute("data-backdrop-fixture") !== identity; i++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        const wrap = host.querySelector(".msg-code-wrap");
        const inline = host.querySelector(".body code");
        assert(wrap && inline, `Reply code did not render for ${identity}`);
        const block = getComputedStyle(wrap);
        if (backdrop) {
          assert(alpha(block.backgroundColor) >= 0.85, `A code block over the ${backdrop} backdrop shows it through (${identity}: ${block.backgroundColor})`);
          assert(alpha(block.borderTopColor) > 0, `A code block over the ${backdrop} backdrop lost its edge (${identity})`);
          assert(alpha(getComputedStyle(inline).backgroundColor) >= 0.85, `Inline code over the ${backdrop} backdrop shows it through (${identity})`);
        } else if (theme === "dark") {
          assert(alpha(block.backgroundColor) < 0.1, "Without a backdrop, a dark reply's code is no longer a faint fill");
        }
      }
    }
  } finally {
    root.unmount();
    if (previous.theme === null) html.removeAttribute("data-theme");
    else html.setAttribute("data-theme", previous.theme);
    if (previous.backdrop === null) html.removeAttribute("data-backdrop");
    else html.setAttribute("data-backdrop", previous.backdrop);
  }
}
