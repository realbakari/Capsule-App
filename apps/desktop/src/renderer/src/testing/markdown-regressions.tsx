import { createRoot } from "react-dom/client";
import { appearanceCssVars, DEFAULT_DARK_PALETTE, DEFAULT_LIGHT_PALETTE } from "@capsule/shared";
import { MarkdownBody } from "../features/conversation/MarkdownBody";

export const MARKDOWN_PREVIEW = '# A readable reply\n\nReview **changes**, *details*, and `src/main.ts` without leaving the conversation.\n\n## Next steps\n\n1. Check the implementation\n   - Keep nested items aligned\n   - Preserve `<!-- examples -->`\n2. Run the tests\n\n- [x] Parsing verified\n- [ ] Ready for review\n\n```ts\n// Keep the original text and its meaning\nexport function greet(name: string) {\n  const attempts = 3;\n  return `Hello, ${name}`;\n}\n```\n\n```css\n#app { color: #b0b0aa; display: grid; }\n```\n\n> [!NOTE]\n> Code examples stay readable in quotes.\n>\n> ```html\n> <div>Example</div>\n> ```\n\n| Check | Result |\n| :--- | ---: |\n| Parser | **Passed** |\n| Theme | Readable |\n- Text after the table: alpha | beta | gamma\n\n[Documentation](https://example.test/a(b) "Documentation")';

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function until(check: () => unknown) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Markdown did not settle: ${check.toString()}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function luminance(color: string): number {
  const channels = color.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  assert(channels?.length === 3, `Cannot measure CSS color: ${color}`);
  const values = channels.map((value) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
}

function assertContrast(foreground: string, background: string) {
  const a = luminance(foreground), b = luminance(background);
  const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  assert(ratio >= 4.5, `Code contrast ${ratio.toFixed(2)} is below 4.5 (${foreground} on ${background})`);
}

/** Real CSS, DOM identity and actions, without a provider or the user's profile. */
export async function runMarkdownRegressions(host: HTMLElement) {
  const root = createRoot(host);
  const originalTheme = document.documentElement.getAttribute("data-theme");
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  let copied = "", opened = "";
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  try {
    for (const theme of ["dark", "light"]) {
      document.documentElement.setAttribute("data-theme", theme);
      const palette = theme === "dark" ? DEFAULT_DARK_PALETTE : DEFAULT_LIGHT_PALETTE;
      for (const width of [320, 760]) {
        for (const size of [15, 20]) {
          for (const review of [false, true]) {
            const identity = `${theme}-${width}-${size}-${review}`;
            root.render(<div className={review ? "inspector" : undefined} data-markdown-fixture={identity} style={{ ...appearanceCssVars(palette), width, fontSize: size }}>
              <MarkdownBody content={MARKDOWN_PREVIEW} githubBaseUrl={review ? "https://github.com/example/repo/pull/1" : undefined} />
            </div>);
            await until(() => document.querySelector("[data-markdown-fixture]")?.getAttribute("data-markdown-fixture") === identity);
            const fixture = document.querySelector<HTMLElement>("[data-markdown-fixture]")!;
            const paragraph = fixture.querySelector<HTMLElement>(".body > .md-p")!;
            const paragraphStyle = getComputedStyle(paragraph);
            assert(parseFloat(paragraphStyle.lineHeight) / parseFloat(paragraphStyle.fontSize) >= 1.6, "Prose lost its readable line spacing");
            assert(parseFloat(paragraphStyle.marginBottom) >= size * .8, "Paragraph separation became too tight");
            assert(getComputedStyle(paragraph.querySelector("strong")!).fontWeight === "600", "Inline emphasis became excessively heavy");
            assert(fixture.scrollWidth <= width + 1, `Markdown overflows at ${identity}`);
            const code = fixture.querySelector<HTMLElement>(".msg-code")!;
            const styles = getComputedStyle(code);
            assert(parseFloat(styles.fontSize) >= size * 0.89, "Code does not follow the transcript size");
            assert(parseFloat(getComputedStyle(fixture.querySelector("h4.md-h")!).fontSize) >= size, "Inspector styles shrank a Markdown heading");
            for (const token of Array.from(code.querySelectorAll("span[class^=tok-]"))) {
              assertContrast(getComputedStyle(token).color, styles.backgroundColor);
            }
            const label = fixture.querySelector(".msg-code-lang")!;
            assertContrast(getComputedStyle(label).color, getComputedStyle(label.parentElement!).backgroundColor);
            const nested = fixture.querySelector("ol > li > ul")!;
            assert(nested.getBoundingClientRect().left > fixture.querySelector("ol")!.getBoundingClientRect().left, "Nested list did not indent");
            assert(fixture.textContent?.includes("alpha | beta | gamma"), "Following table text was lost");
            assert(!fixture.querySelector("img, script, iframe"), "Untrusted content created an active element");
            assert(fixture.querySelectorAll('[aria-label="Completed"]').length === 1, "Task state is not accessible");
          }
        }
      }
    }

    const prefix = '```ts\nconst first = 1;\n```\n\n<details><summary>Details</summary>\n\nNotes\n</details>\n\n';
    const renderReply = (tail: string) => root.render(<MarkdownBody content={prefix + tail}
      githubBaseUrl="https://github.com/example/repo/pull/1" onOpenLink={(href) => { opened = href; }} />);
    renderReply("Starting");
    await until(() => document.querySelector("details"));
    const pre = document.querySelector(".msg-code")!;
    const disclosure = document.querySelector("details")!;
    disclosure.open = true;
    document.querySelector<HTMLButtonElement>('[aria-label="Copy code"]')!.click();
    await until(() => document.querySelector(".copy-action-feedback")?.textContent === "Copied");
    assert(copied === "const first = 1;\n", "Copy did not preserve the source");
    for (const tail of ["Starting more", "Starting more\n\n```css\n#app {", "Starting more\n\n```css\n#app {}\n```\n\n[Docs](https://example.test/a(b))"]) {
      renderReply(tail);
      const expected = tail.includes("#app {}") ? "#app {}" : tail.includes("#app") ? "#app {" : "Starting more";
      await until(() => document.querySelector(".body")?.textContent?.includes(expected));
      assert(document.querySelector(".msg-code") === pre, "Appending text remounted a completed code block");
      assert(document.querySelector("details") === disclosure && disclosure.open, "Appending text reset a disclosure");
      assert(document.querySelector(".copy-action-feedback")?.textContent === "Copied", "Appending text reset copy feedback");
    }
    await until(() => document.querySelector('a[href="https://example.test/a(b)"]'));
    document.querySelector<HTMLAnchorElement>('a[href="https://example.test/a(b)"]')!.click();
    assert(opened === "https://example.test/a(b)", "Link action used a truncated destination");
  } finally {
    root.unmount();
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (originalTheme) document.documentElement.setAttribute("data-theme", originalTheme);
    else document.documentElement.removeAttribute("data-theme");
  }
}
