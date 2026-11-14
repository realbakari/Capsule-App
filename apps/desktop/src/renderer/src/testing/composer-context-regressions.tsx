import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { MessageAttachment, ResolvedContext } from "@capsule/shared";
import { Composer } from "../features/conversation/Composer";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until(check: () => unknown, label: string) {
  const deadline = Date.now() + 3000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Composer context regression did not settle: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
const field = () => document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]')!;
const options = () => Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).map((item) => item.querySelector(".suggest-name")?.textContent ?? "");

function type(value: string) {
  const textarea = field();
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}
function key(name: string) {
  field().dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));
}

function Fixture({ base }: { base: Record<string, unknown> }) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<MessageAttachment[]>((base.attachments as MessageAttachment[]) ?? []);
  window.testWorkspace = {
    ...base, draft, setDraft, attachments,
    removeAttachment: (path: string) => setAttachments((current) => current.filter((item) => item.path !== path)),
    attachContext: async (resolved: ResolvedContext) => {
      (base.attached as ResolvedContext[]).push(resolved);
      setAttachments((current) => [...current, { name: resolved.fileName, path: `/tmp/${current.length}.md`, size: resolved.text.length, context: resolved.context }]);
      return true;
    },
  };
  return <Composer />;
}

/** `@` sources, `!` commands, saved prompts and context chips, against a stand-in workspace. */
export async function runComposerContextRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const root = createRoot(host);
  const originalApi = window.capsule;
  const ran: string[] = [];
  const attached: ResolvedContext[] = [];
  const sent: string[] = [];
  const api = {
    ...(base.api as object), isDesktop: true,
    runDiagnostics: async () => ({ status: "none" }),
    runComposerCommand: async (_project: string, command: string) => { ran.push(command); return { command, exitCode: 0, output: "a.txt\nb.txt", truncated: false, durationMs: 5 }; },
  };
  window.capsule = api as unknown as typeof window.capsule;
  const fixture = {
    ...base, api, attached, sessions: [], projects: [],
    sendPrompt: async (text: string) => { sent.push(text); return true; },
    settings: { ...(base.settings as object), composerPrompts: [{ name: "Review", prompt: "Review {{file}} for {{focus:bugs|speed}}" }] },
    attachments: [{ name: "Web page - Example.md", path: "/tmp/page.md", size: 5000, context: { kind: "url", label: "Example", excerpt: "Hello from the page", detail: "https://example.com/" } }],
  };
  try {
    root.render(<Fixture base={fixture} />);
    await until(() => field(), "composer mounted");

    const chip = document.querySelector<HTMLButtonElement>('[aria-label="Preview web page: Example"]');
    assert(chip, "Context attachment did not render as a context chip");
    chip.focus();
    await until(() => document.querySelector(".composer-context-preview")?.textContent?.includes("Hello from the page"), "chip preview on focus");
    chip.blur();
    await until(() => !document.querySelector(".composer-context-preview"), "preview closes on blur");
    document.querySelector<HTMLButtonElement>('[aria-label="Remove Example"]')!.click();
    await until(() => !document.querySelector('[aria-label="Preview web page: Example"]'), "chip removed");

    field().focus();
    type("@di");
    await until(() => options().includes("@diff") && options().includes("@diagnostics"), "@ offers matching sources");
    assert(!options().includes("@thread"), "@di offered a source that does not match");
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.querySelector(".suggest-name")?.textContent === "@diagnostics")!.click();
    await until(() => document.querySelector(".composer-context-chip.is-error")?.textContent?.includes("No check command found."), "no-check error chip");
    assert(Array.from(document.querySelectorAll("button")).some((item) => item.textContent === "Project actions"), "No-check chip has no way to project actions");
    assert(field().value === "", "Choosing a source left its @ text in the prompt");

    type("@dif");
    await until(() => options().includes("@diff"), "@dif offers @diff");
    Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((item) => item.querySelector(".suggest-name")?.textContent === "@diff")!.click();
    await until(() => document.querySelector('[data-picker="diff"]'), "diff picker opens");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(document.querySelector('[data-picker="diff"]')!.contains(document.activeElement), "The prompt took focus back from the diff picker");
    document.querySelector<HTMLButtonElement>('[data-picker="diff"] [aria-label="Close context picker"]')!.click();
    await until(() => !document.querySelector('[data-picker="diff"]'), "diff picker closes");

    type("!ls -a");
    await until(() => document.querySelector(".composer-bang-hint")?.textContent?.includes("ls -a"), "! hint");
    assert(document.querySelector('[aria-label="Run command"]'), "Send did not become Run for a ! command");
    key("Enter");
    await until(() => ran.includes("ls -a") && attached.some((item) => item.context.kind === "command"), "! command ran and attached");
    await until(() => field().value === "", "! command left the prompt");
    assert(attached.find((item) => item.context.kind === "command")!.text.includes("a.txt"), "Command output missing from attachment");

    type("/rev");
    await until(() => options().includes("/review"), "/ lists saved prompts");
    key("Enter");
    await until(() => document.querySelector('form[aria-label="Fill in Review"]'), "template form opens");
    const input = document.querySelector<HTMLInputElement>('form[aria-label="Fill in Review"] input')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "src/a.ts"); input.dispatchEvent(new Event("input", { bubbles: true }));
    const select = document.querySelector<HTMLSelectElement>('form[aria-label="Fill in Review"] select')!;
    select.value = "speed"; select.dispatchEvent(new Event("change", { bubbles: true }));
    document.querySelector<HTMLButtonElement>('form[aria-label="Fill in Review"] button[type="submit"]')!.click();
    await until(() => field().value === "Review src/a.ts for speed", "template filled the prompt");

    type("/init");
    await until(() => options().includes("/init"), "/ offers /init");
    key("Enter");
    await until(() => sent.some((text) => text.includes("Write or refresh AGENTS.md")), "/init sent its prompt");
    assert(field().value === "", "/init left its command in the prompt");

    root.render(<Fixture base={{ ...fixture, attachments: [], api: { ...api, isDesktop: false, remoteMode: "control" } }} />);
    window.capsule = { ...api, isDesktop: false, remoteMode: "control" } as unknown as typeof window.capsule;
    await until(() => (window.testWorkspace.api as { isDesktop: boolean }).isDesktop === false, "remote fixture");
    type("@");
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert(!options().some((item) => item.startsWith("@")), "A paired browser was offered @ context sources");
  } finally {
    root.unmount();
    window.capsule = originalApi;
  }
}
