import { createRoot } from "react-dom/client";
import { Composer } from "../features/conversation/Composer";
import { appearanceCssVars, DEFAULT_DARK_PALETTE, DEFAULT_LIGHT_PALETTE, PRESET_HARNESSES } from "@capsule/shared";
import { openComposerControl } from "../lib/composer-controls";
import { isMac } from "../lib/keybindings";

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
          for (const scenario of ["empty", "long", "multiline", "attachment", "menu", "running", "queue", "stopping", "full", "resting", "dictating"]) {
            const label = `${theme}/${fontSize}/${width}/${scenario}`;
            const activeRun = ["running", "queue", "stopping"].includes(scenario) ? { id: "layout-run", status: "running" } : undefined;
            let emitDictation: ((payload: unknown) => void) | undefined;
            const baseApi = base.api as { on?: (event: string, handler: (payload: unknown) => void) => () => void };
            const api = scenario === "dictating" ? { ...baseApi, isDesktop: true, platform: "darwin",
              startDictation: () => new Promise(() => {}), finishDictation: async () => {}, cancelDictation: async () => {},
              on: (event: string, handler: (payload: unknown) => void) => { if (event === "dictation") { emitDictation = handler; return () => {}; } return baseApi.on?.(event, handler) ?? (() => {}); },
            } : base.api;
            window.testWorkspace = { ...base, api, busy: false, sendBlockReason: undefined,
              session: undefined, sessionId: undefined, skillId: undefined, events: [],
              contextUsage: { used: scenario === "full" ? 95_000 : 3_000, limit: 100_000, fraction: scenario === "full" ? 0.95 : 0.03 },
              draft: scenario === "multiline" ? "First line\nSecond line" : scenario === "long" ? "A long draft ".repeat(30) : scenario === "queue" ? "One more thing" : "",
              attachments: scenario === "attachment" ? [{ path: "/fixture/example.txt", name: "example.txt", size: 12 }] : [],
              activeRun, stoppingRunIds: scenario === "stopping" ? ["layout-run"] : [],
              git: { isRepo: true, branch: "feature/a-long-branch-name", branches: ["main"], dirty: true },
            };
            root.render(<Composer key={label} awayFromLatest={scenario === "resting"} />);
            await settle();
            if (scenario === "dictating") {
              host.querySelector<HTMLButtonElement>(".dictation-btn")!.click(); await settle();
              emitDictation?.({ phase: "listening", limitMs: 120_000 });
              emitDictation?.({ phase: "partial", text: "A spoken request that keeps going for a while" });
              await settle();
              const status = host.querySelector<HTMLElement>(".dictation-status");
              assert(status?.textContent?.includes("Listening"), `${label}: no recording state`);
              const statusRect = status!.getBoundingClientRect();
              assert(statusRect.right <= host.querySelector<HTMLElement>(".composer-glass")!.getBoundingClientRect().right + 1, `${label}: dictation status escaped the glass`);
            }
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
            assert(!host.querySelector('[aria-label="Conversation tools"]'), `${label}: the footer still carries a catch-all tools menu`);
            assert(!host.querySelector(".turn-mode-chip"), `${label}: Act mode is drawn as a chip`);
            assert(!host.querySelector(".steer-row"), `${label}: a second steer field is back`);
            assert(!host.querySelector(".composer-dirty"), `${label}: an unexplained changes dot is back`);
            const contextRow = getComputedStyle(host.querySelector(".composer-context")!);
            assert(contextRow.borderTopWidth === "0px" && contextRow.borderBottomWidth === "0px" && contextRow.backgroundColor === "rgba(0, 0, 0, 0)", `${label}: workspace row is drawn as a tray`);
            assert(Boolean(host.querySelector(".context-meter-ring")) === (scenario === "full"), `${label}: the context ring shows at normal usage or hides when nearly full`);
            if (!["running", "queue", "stopping", "resting", "dictating"].includes(scenario)) {
              assert(field.placeholder === "Ask anything. @ files, $ skills, / commands", `${label}: idle placeholder is "${field.placeholder}"`);
            }
            if (scenario === "running") {
              assert(host.querySelector('[aria-label="Stop"]') && !host.querySelector('[aria-label="Send message"]'), `${label}: an empty draft during a turn does not offer Stop`);
              assert(field.placeholder === "Queue a follow-up", `${label}: running placeholder is "${field.placeholder}"`);
            }
            if (scenario === "queue") {
              assert(host.querySelector('[aria-label="Queue follow-up"]') && !host.querySelector('[aria-label="Stop"]'), `${label}: a draft during a turn does not keep Send`);
            }
            if (scenario === "menu") {
              host.querySelector<HTMLButtonElement>('[aria-label="Agent and model"]')!.click(); await settle();
              const picker = document.querySelector<HTMLElement>(".agent-model-picker")!;
              const rect = picker.getBoundingClientRect();
              assert(rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight + 1, `${label}: picker escaped viewport`);
              const rail = picker.querySelector<HTMLElement>(".agent-model-rail")!.getBoundingClientRect();
              const list = picker.querySelector<HTMLElement>(".agent-model-list")!.getBoundingClientRect();
              const reasoning = picker.querySelector<HTMLElement>(".agent-model-reasoning");
              assert(reasoning && rail.right <= list.left + 1 && list.right <= reasoning.getBoundingClientRect().left + 1, `${label}: rail, models and Reasoning are not three columns`);
              assert(reasoning.querySelector("header")?.textContent?.startsWith("Reasoning") && reasoning.textContent!.length > "Reasoning".length, `${label}: the Reasoning column is empty instead of saying why`);
              const footer = picker.querySelector<HTMLElement>(".agent-model-picker-footer");
              assert(!footer || footer.getBoundingClientRect().top >= reasoning.getBoundingClientRect().bottom - 1, `${label}: the footer does not run under the columns`);
              assert(!footer || (footer.querySelectorAll("button").length === 1 && footer.querySelector('[data-setting="Permissions"]')), `${label}: the footer holds more than Permissions`);
              assert(!picker.querySelector('[aria-label="Plan mode"]') && !Array.from(picker.querySelectorAll("button")).some((button) => /Compact conversation|Agent commands/.test(button.textContent ?? "")), `${label}: plan, compact or agent commands are back in the picker`);
              const attach = host.querySelector<HTMLElement>('[aria-label="Attach files"]')!.getBoundingClientRect();
              const trigger = host.querySelector<HTMLElement>('[aria-label="Agent and model"]')!.getBoundingClientRect();
              assert(attach.right <= trigger.left && trigger.right <= actions.left + 1, `${label}: attach is not left of the model, or the model is not beside send`);
              picker.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle();
              assert(!document.querySelector(".agent-model-picker"), `${label}: picker did not close`);
              assert(document.activeElement?.getAttribute("aria-label") === "Agent and model", `${label}: picker lost trigger focus`);
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

/** The model picker inside the real composer: columns, reasoning, permissions, jump keys and the read-only viewer. */
export async function runModelPickerRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const savedApi = window.capsule;
  window.capsule = base.api as typeof window.capsule;
  const root = createRoot(host);
  const writes: unknown[][] = [];
  const options: string[] = [];
  const approvals: string[] = [];
  const models = { currentModelId: "model-one", availableModels: [{ modelId: "model-one", name: "Reasoning model" }, { modelId: "model-two", name: "Fast model" }] };
  const live = (key: string) => {
    const session = { id: "picker-thread", projectId: "app", harnessId: "codex", harnessState: "running", openclawSessionKey: key };
    return { session, sessionId: session.id, harnessStatuses: { [session.id]: { session, parsed: { models, reported: { configOptions: [
      { id: "model", category: "model", name: "Model", currentValue: "model-one", choices: [{ value: "model-one", name: "Reasoning model" }, { value: "model-two", name: "Fast model" }] },
      { id: "reasoning_effort", category: "thought_level", name: "Reasoning effort", currentValue: "high", choices: [{ value: "low", name: "low" }, { value: "high", name: "high" }] },
    ] } } } } };
  };
  const render = (key: string, api: Record<string, unknown> = {}) => {
    window.testWorkspace = { ...base, ...live(key), agentId: "codex", messages: [], activeRun: undefined, busy: false,
      api: { ...(base.api as object), isDesktop: true, setHarnessConfig: async (...args: unknown[]) => { writes.push(args); }, ...api },
      agents: [{ id: "codex", name: "Codex" }],
      harnesses: PRESET_HARNESSES.map((item) => ({ ...item, runtimeRoute: "direct", readiness: item.id === "codex" ? "ready" : "missing_cli", detail: "Setup required", liveSessionIds: [], dedicatedProjectIds: [], acpxEnabled: false })),
      setHarnessOption: async (name: string, value: string) => { options.push(`${name}=${value}`); },
      setPermissionProfile: async (id: string) => { approvals.push(id); },
      refreshHarnessStatus: async () => {}, loadHarnessStatus: async () => {},
    };
    root.render(<Composer key={`${key}-${String(api.isDesktop)}`} />);
  };
  const trigger = () => host.querySelector<HTMLButtonElement>('[aria-label="Agent and model"]')!;
  const picker = () => document.querySelector<HTMLElement>(".agent-model-picker");
  const effort = (name: string) => Array.from(picker()?.querySelectorAll<HTMLButtonElement>('.agent-model-reasoning [role="radio"]') ?? []).find((row) => row.textContent === name)!;
  const key = (target: Element, init: KeyboardEventInit) => target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  try {
    host.style.cssText = "width:900px;padding:0";
    render("direct:codex:codex:picker"); await settle();
    assert(trigger().textContent === "Reasoning modelHigh", `Trigger reads "${trigger().textContent}", not the model then its effort`);
    trigger().click(); await settle();
    assert(picker()?.querySelector(".agent-model-reasoning header")?.textContent === "ReasoningReasoning model", "The Reasoning column does not name the current model");
    assert(effort("High")?.getAttribute("aria-checked") === "true" && effort("Low")?.getAttribute("aria-checked") === "false", "Effort rows do not check the current level");
    const rows = Array.from(picker()!.querySelectorAll(".agent-model-row"));
    assert(rows[0]?.querySelector(".agent-model-jump")?.textContent === `${isMac() ? "⌘" : "Ctrl+"}1` && rows[1]?.querySelector(".agent-model-jump")?.textContent === `${isMac() ? "⌘" : "Ctrl+"}2`, "Model rows lack their jump keys");
    assert(!rows[0]?.querySelector("small"), "Model rows still carry an id line");
    effort("Low").click(); await settle();
    assert(JSON.stringify(writes[0]) === JSON.stringify(["picker-thread", "reasoning_effort", "low"]), "Effort row did not write the reported option");
    key(picker()!, isMac() ? { key: "2", metaKey: true } : { key: "2", ctrlKey: true }); await settle();
    assert(options.includes("model=model-two") && !picker(), "⌘2 did not pick the second model and close");
    assert(document.activeElement === trigger(), "Jump key lost the trigger focus");

    trigger().click(); await settle();
    const permissions = picker()!.querySelector<HTMLButtonElement>('.agent-model-picker-footer [data-setting="Permissions"]')!;
    assert(permissions.getAttribute("aria-label") === "Permissions: Auto", "Footer does not name the approval mode");
    permissions.click(); await settle();
    const pop = document.querySelector<HTMLElement>(".permissions-pop")!;
    const segments = Array.from(pop.querySelectorAll<HTMLButtonElement>('[aria-label="Approvals"] [role="radio"]'));
    assert(segments.map((item) => item.getAttribute("aria-label")).join("|") === "Ask|Auto|Full" && segments.every((item) => item.querySelector("svg") && !item.textContent), "Approvals are not an icon-only toggle");
    const shownLabel = () => pop.querySelector(".permissions-shown [data-shown] span")?.textContent;
    assert(document.activeElement === segments[1] && shownLabel() === "Auto", "Permissions popover does not focus and describe the current mode");
    assert(segments.every((item) => item.title === item.getAttribute("aria-label")), "Segments are not titled with their mode");
    for (const item of segments) {
      const icon = item.querySelector("svg")!.getBoundingClientRect(), box = item.getBoundingClientRect();
      assert(Math.abs(icon.left + icon.width / 2 - box.left - box.width / 2) < 1.5, `The ${item.getAttribute("aria-label")} icon is not centred in its segment`);
    }
    const filled = segments.filter((item) => getComputedStyle(item).backgroundColor !== "rgba(0, 0, 0, 0)");
    assert(filled.length === 1 && filled[0] === segments[1], "A segment other than the selected one is filled");
    const resting = JSON.stringify(pop.getBoundingClientRect());
    for (const item of segments) {
      item.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" })); await settle();
      assert(shownLabel() === item.getAttribute("aria-label"), "Hovering a segment does not preview its mode");
      assert(JSON.stringify(pop.getBoundingClientRect()) === resting, "Previewing a mode moved or resized the Permissions popover");
      item.dispatchEvent(new PointerEvent("pointerout", { bubbles: true, pointerType: "mouse" })); await settle();
    }
    assert(shownLabel() === "Auto", "Leaving the toggle did not return to the selected mode");
    key(segments[1]!, { key: "ArrowRight" }); await settle();
    assert(document.activeElement === segments[2] && shownLabel() === "Full", "Arrow keys do not move along the toggle and preview the mode");
    segments[2]!.click(); await settle();
    assert(approvals[0] === "approve-all" && !document.querySelector(".permissions-pop") && picker(), "Picking a mode did not save it and close only the popover");
    permissions.click(); await settle();
    key(document.querySelector(".permissions-pop")!, { key: "Escape" }); await settle();
    assert(!document.querySelector(".permissions-pop") && picker() && document.activeElement === permissions, "Escape in Permissions closed the picker or lost focus");
    key(picker()!, { key: "Escape" }); await settle();
    assert(!picker() && document.activeElement === trigger(), "Escape did not close the picker back to its trigger");

    assert(!openComposerControl("effort"), "⇧⌘E refused to open effort"); await settle(); await settle();
    assert(document.activeElement === effort("High"), "⇧⌘E did not land on the current effort level");
    key(document.activeElement!, { key: "ArrowLeft" });
    assert(document.activeElement?.closest(".agent-model-row") === picker()!.querySelector(".agent-model-row"), "Left from Reasoning did not return to the current model");
    key(picker()!, { key: "Escape" }); await settle();
    assert(!openComposerControl("mode"), "⇧⌘M refused to open Permissions"); await settle();
    assert(document.querySelector(".permissions-pop") && host.querySelector('.composer-context [data-setting="Permissions"]')?.getAttribute("aria-expanded") === "true", "⇧⌘M did not open Permissions from the row under a new conversation");
    key(document.querySelector(".permissions-pop")!, { key: "Escape" }); await settle();

    render("agent:codex:acp:picker"); await settle();
    trigger().click(); await settle();
    assert(picker()?.querySelector(".agent-model-reasoning-note")?.textContent === "Effort isn't adjustable on the Gateway route.", "Gateway route hides why there is no effort");
    assert(picker()?.querySelector('.agent-model-picker-footer [data-setting="Permissions"]'), "Gateway route lost Permissions");
    key(picker()!, { key: "Escape" }); await settle();

    let statusReads = 0;
    const mismatched = live("direct:codex:codex:picker");
    for (let pass = 0; pass < 6; pass++) {
      window.testWorkspace = { ...window.testWorkspace, ...mismatched,
        harnessStatuses: { "picker-thread": { ...mismatched.harnessStatuses["picker-thread"], session: { ...mismatched.session, openclawSessionKey: "direct:codex:codex:other" } } },
        loadHarnessStatus: async () => { statusReads++; } };
      root.render(<Composer key="status-mismatch" />); await settle();
    }
    assert(statusReads === 1, `A status under another session key was re-read ${statusReads} times instead of once`);

    const before = writes.length;
    render("direct:codex:codex:picker", { isDesktop: false }); await settle();
    trigger().click(); await settle();
    effort("Low").click();
    assert(writes.length === before && effort("Low").getAttribute("aria-disabled") === "true", "A read-only viewer changed effort");
    assert(Array.from(picker()!.querySelectorAll<HTMLButtonElement>("[data-model-choice]")).every((row) => row.disabled), "A read-only viewer can pick a model");
    picker()!.querySelector<HTMLButtonElement>('[data-setting="Permissions"]')!.click(); await settle();
    const viewerSegments = Array.from(document.querySelectorAll<HTMLButtonElement>('.permissions-pop [role="radio"]'));
    viewerSegments[0]!.click(); await settle();
    assert(viewerSegments.every((item) => item.getAttribute("aria-disabled") === "true") && approvals.length === 1, "A read-only viewer changed approvals");
  } finally {
    root.unmount();
    window.testWorkspace = previous;
    window.capsule = savedApi;
  }
}
