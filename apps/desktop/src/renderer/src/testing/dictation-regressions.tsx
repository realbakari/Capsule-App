import { useState } from "react";
import { createRoot } from "react-dom/client";
import type { DictationOutcome } from "@capsule/shared";
import { Composer } from "../features/conversation/Composer";
import { TOGGLE_DICTATION_EVENT } from "../lib/dictation";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function until(check: () => unknown, message: string) {
  for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  throw new Error(message);
}

function Fixture({ base, api }: { base: Record<string, unknown>; api: Record<string, unknown> }) {
  const [draft, setDraft] = useState("Fix the bug");
  window.testWorkspace = { ...base, api, draft, setDraft, activeRun: undefined, sendBlockReason: undefined, attachments: [], skillId: undefined, session: undefined };
  return <Composer />;
}

/** Composer dictation against a scripted bridge: caret insertion, refinement, Escape, remote and other systems. */
export async function runDictationRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const baseApi = base.api as Record<string, unknown> & { on?: (event: string, handler: (payload: unknown) => void) => () => void };
  let emit: ((payload: unknown) => void) | undefined;
  let resolveStart: ((outcome: DictationOutcome) => void) | undefined;
  let cancels = 0, finishes = 0;
  const api = { ...baseApi, isDesktop: true, platform: "darwin",
    startDictation: () => new Promise<DictationOutcome>((resolve) => { resolveStart = resolve; }),
    finishDictation: async () => { finishes++; },
    cancelDictation: async () => { cancels++; },
    openDictationSettings: async () => {},
    on: (event: string, handler: (payload: unknown) => void) => { if (event === "dictation") { emit = handler; return () => {}; } return baseApi.on?.(event, handler) ?? (() => {}); },
  };
  const savedApi = window.capsule;
  window.capsule = api as unknown as typeof window.capsule;
  const root = createRoot(host);
  try {
    root.render(<Fixture base={base} api={api} />);
    const field = () => host.querySelector<HTMLTextAreaElement>("textarea")!;
    await until(() => field()?.value === "Fix the bug", "fixture draft missing");
    field().focus(); field().setSelectionRange(7, 7);
    host.querySelector<HTMLButtonElement>(".dictation-btn")!.click();
    await until(() => emit && host.querySelector(".dictation-status")?.textContent?.includes("Starting"), "no starting state");
    emit!({ phase: "listening", limitMs: 120_000 });
    emit!({ phase: "partial", text: "login" });
    await until(() => field().value === "Fix the login bug", "partial was not inserted at the caret");
    emit!({ phase: "partial", text: "sign in page" });
    await until(() => field().value === "Fix the sign in page bug", "refinement did not replace the partial");
    assert(field().readOnly, "prompt stayed editable while dictating");
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await until(() => field().value === "Fix the bug" && !host.querySelector(".dictation-status"), "Escape did not restore the draft");
    assert(cancels === 1, "Escape did not cancel the helper");
    resolveStart!({ kind: "cancelled" });
    resolveStart = undefined;

    field().setSelectionRange(11, 11);
    window.dispatchEvent(new CustomEvent(TOGGLE_DICTATION_EVENT));
    await until(() => host.querySelector(".dictation-status"), "chord did not start dictation");
    emit!({ phase: "listening", limitMs: 120_000 });
    emit!({ phase: "partial", text: "in the header" });
    await until(() => field().value === "Fix the bug in the header", "partial missing at end of draft");
    window.dispatchEvent(new CustomEvent(TOGGLE_DICTATION_EVENT));
    await until(() => finishes === 1 && host.querySelector(".dictation-status")?.textContent?.includes("Finishing"), "chord did not finish");
    resolveStart!({ kind: "text", text: "in the header." });
    await until(() => field().value === "Fix the bug in the header." && !field().readOnly, "final text was not kept");

    resolveStart = undefined;
    host.querySelector<HTMLButtonElement>(".dictation-btn")!.click();
    await until(() => resolveStart, "third start missing");
    resolveStart!({ kind: "error", message: "Allow Microphone access for Capsule in macOS Privacy & Security settings.", settings: "microphone" });
    await until(() => host.querySelector('.dictation-status[role="alert"]')?.textContent?.includes("Open Microphone settings"), "permission error had no way to the setting");
    assert(field().value === "Fix the bug in the header.", "a failed start changed the draft");

    for (const [variant, expected] of [[{ isDesktop: false }, "runs on the Mac"], [{ isDesktop: true, platform: "win32" }, "unavailable"]] as const) {
      root.render(<Fixture key={expected} base={base} api={{ ...api, ...variant, startDictation: () => { throw new Error("must not start"); } }} />);
      await until(() => host.querySelector<HTMLButtonElement>(".dictation-btn")?.title.includes(expected), `${expected}: button is unexplained`);
      const button = host.querySelector<HTMLButtonElement>(".dictation-btn")!;
      assert(!button.disabled, `${expected}: button is dead`);
      button.click();
      await until(() => host.querySelector(".dictation-status")?.textContent?.includes(expected), `${expected}: click gave no explanation`);
    }
  } finally {
    root.unmount();
    window.capsule = savedApi;
  }
}
