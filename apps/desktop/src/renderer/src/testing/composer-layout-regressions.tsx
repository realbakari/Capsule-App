import { createRoot } from "react-dom/client";
import { Composer } from "../features/conversation/Composer";
import { appearanceCssVars, DEFAULT_DARK_PALETTE, DEFAULT_LIGHT_PALETTE } from "@capsule/shared";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function settle() {
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

/** Exercise the actual dock, including container queries and scaled text. */
export async function runComposerLayoutRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const savedApi = window.capsule;
  window.capsule = base.api as typeof window.capsule;
  const savedStyle = host.style.cssText;
  const savedFont = document.documentElement.style.fontSize;
  const savedRootStyle = document.documentElement.style.cssText;
  const savedTheme = document.documentElement.dataset.theme;
  const root = createRoot(host);
  try {
    for (const theme of ["dark", "light"]) {
      document.documentElement.dataset.theme = theme;
      for (const [name, value] of Object.entries(appearanceCssVars(theme === "light" ? DEFAULT_LIGHT_PALETTE : DEFAULT_DARK_PALETTE))) {
        document.documentElement.style.setProperty(name, value);
      }
      for (const fontSize of [16, 20]) {
        document.documentElement.style.fontSize = `${fontSize}px`;
        for (const width of [320, 360, 640, 900]) {
          host.style.cssText = `width:${width}px;max-width:100%;padding:0`;
          for (const scenario of ["empty", "long", "multiline", "attachment", "menu", "running", "stopping", "resting"]) {
            const label = `${theme}/${fontSize}/${width}/${scenario}`;
            const activeRun = ["running", "stopping"].includes(scenario) ? { id: "layout-run", status: "running" } : undefined;
            window.testWorkspace = { ...base, busy: false, sendBlockReason: undefined,
              session: undefined, sessionId: undefined, skillId: undefined, events: [], contextUsage: undefined,
              draft: scenario === "multiline" ? "First line\nSecond line" : scenario === "long" ? "A long draft ".repeat(30) : "",
              attachments: scenario === "attachment" ? [{ path: "/fixture/example.txt", name: "example.txt", size: 12 }] : [],
              activeRun, stoppingRunIds: scenario === "stopping" ? ["layout-run"] : [],
              git: { isRepo: true, branch: "feature/a-long-branch-name", branches: ["main"], dirty: true },
            };
            root.render(<Composer key={label} awayFromLatest={scenario === "resting"} />);
            await settle();
            const glass = host.querySelector<HTMLElement>(".composer-glass")!.getBoundingClientRect();
            const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
            const controls = host.querySelector<HTMLElement>(".composer-controls")!.getBoundingClientRect();
            const actions = host.querySelector<HTMLElement>(".composer-prompt-actions")!.getBoundingClientRect();
            assert(glass.right <= host.getBoundingClientRect().right + 1, `${label}: glass escaped the host`);
            assert(actions.right <= glass.right + 1, `${label}: actions escaped the glass`);
            if (scenario === "resting") {
              assert(controls.width === 0, `${label}: secondary controls stayed visible`);
              assert(field.getBoundingClientRect().height <= fontSize * 2.4, `${label}: resting field does not scale with text`);
              const checkout = host.querySelector('[aria-label="Conversation workspace"]')!.getBoundingClientRect();
              assert(checkout.top >= glass.bottom, `${label}: checkout is covered by glass`);
              field.focus(); await settle();
              assert(host.querySelector(".composer--resting"), `${label}: focus expanded the resting dock`);
            } else {
              assert(controls.right <= actions.left + 1, `${label}: controls overlap actions`);
              assert(Math.abs(controls.top + controls.height / 2 - actions.top - actions.height / 2) < 2, `${label}: controls and actions are misaligned`);
            }
            const buttons = Array.from(host.querySelectorAll<HTMLButtonElement>(".composer-row button"))
              .map((button) => button.getBoundingClientRect()).filter((rect) => rect.width > 0 && rect.height > 0);
            for (let i = 0; i < buttons.length; i++) {
              for (const other of buttons.slice(i + 1)) {
                const rect = buttons[i]!;
                assert(!(rect.left < other.right && rect.right > other.left && rect.top < other.bottom && rect.bottom > other.top), `${label}: action targets overlap`);
              }
            }
            assert(document.documentElement.scrollWidth <= innerWidth + 1, `${label}: document overflows horizontally`);
            if (scenario === "menu") {
              host.querySelector<HTMLButtonElement>('[aria-label="Conversation tools"]')!.click(); await settle();
              const menu = document.querySelector<HTMLElement>('[role="listbox"]')!;
              const rect = menu.getBoundingClientRect();
              assert(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, `${label}: menu escaped viewport`);
              window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await settle();
              assert(document.activeElement?.getAttribute("aria-label") === "Conversation tools", `${label}: menu lost trigger focus`);
            }
            if (scenario === "stopping") assert(host.querySelector<HTMLButtonElement>('[aria-label="Stopping"]')?.disabled, `${label}: stop is not pending`);
          }
        }
      }
    }
  } finally {
    root.unmount();
    window.testWorkspace = previous;
    window.capsule = savedApi;
    host.style.cssText = savedStyle;
    document.documentElement.style.cssText = savedRootStyle;
    document.documentElement.style.fontSize = savedFont;
    if (savedTheme === undefined) delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = savedTheme;
  }
}
