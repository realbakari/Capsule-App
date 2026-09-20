import { createRoot } from "react-dom/client";
import { PRESET_HARNESSES, type AcpConfigOption, type HarnessLiveStatus, type HarnessStatus, type SessionRef } from "@capsule/shared";
import { CapabilityDetails } from "../features/harness/CapabilityDetails";
import { ComposerTools } from "../features/conversation/ComposerTools";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }

export async function runMuseSettingsRegressions(host: HTMLElement, base: Record<string, unknown>) {
  const previous = window.testWorkspace;
  const root = createRoot(host);
  const harness = { ...PRESET_HARNESSES.find((preset) => preset.id === "muse"), runtimeRoute: "direct" } as HarnessStatus;
  const session = { id: "settings-thread", harnessId: "muse", openclawSessionKey: "direct:msp:muse:fixture" } as SessionRef;
  const option: AcpConfigOption = { id: "reasoning_effort", name: "Reasoning effort", choices: [{ value: "none", name: "None" }, { value: "max", name: "Maximum" }] };
  const status = (selected: SessionRef, value?: string) => ({ session: selected, parsed: { reported: { configOptions: [{ ...option, currentValue: value }] } } }) as HarnessLiveStatus;
  try {
    for (const surface of ["harness", "composer"] as const) {
      let accepted: (() => void) | undefined;
      let rejected: ((error: Error) => void) | undefined;
      const writes: unknown[][] = [];
      const refreshes: string[] = [];
      window.testWorkspace = { ...base, api: { ...base.api as object, isDesktop: true,
        setHarnessConfig: (...args: unknown[]) => { writes.push(args); return new Promise<void>((resolve, reject) => { accepted = resolve; rejected = reject; }); },
      }, refreshHarnessStatus: async (id: string) => { refreshes.push(id); } };
      const render = (selected = session, value?: string) => {
        const liveStatus = status(selected, value);
        root.render(surface === "harness"
          ? <CapabilityDetails harness={harness} session={selected} status={liveStatus} initiallyOpen />
          : <ComposerTools harness={harness} session={selected} status={liveStatus} stashCount={0} onContext={() => {}} onStash={() => {}} />);
      };
      render(); await settle();
      if (surface === "composer") {
        host.querySelector<HTMLButtonElement>('[aria-label="Conversation tools"]')!.click(); await settle();
        Array.from(document.querySelectorAll<HTMLButtonElement>('[role="option"]')).find((button) => button.textContent?.includes("Agent settings and capabilities"))!.click(); await settle();
      }
      const settings = () => document.querySelector<HTMLDetailsElement>(".agent-configuration")!;
      settings().open = true;
      const select = () => settings().querySelector<HTMLSelectElement>("select")!;
      assert(select().value === "" && select().textContent?.includes("Not reported"), `${surface}: missing value became an invented default`);
      const change = (value: string) => { select().value = value; select().dispatchEvent(new Event("change", { bubbles: true })); };
      change("max"); await settle();
      assert(select().disabled && writes.length === 1 && select().value === "", `${surface}: pending setting was optimistic or not disabled`);
      accepted!(); await settle(); render(session, "max"); await settle();
      assert(!select().disabled && select().value === "max" && refreshes[0] === session.id, `${surface}: accepted setting did not recover`);
      change("none"); await settle(); rejected!(new Error("Setting rejected")); await settle();
      assert(settings().querySelector('[role="alert"]') && select().value === "max" && !select().disabled, `${surface}: rejection lost the reported setting`);
      change("none"); await settle();
      render({ ...session, id: "other-settings-thread", openclawSessionKey: "direct:msp:muse:other" }); await settle();
      rejected!(new Error("Old thread failed")); await settle();
      assert(!settings().querySelector('[role="alert"]') && !select().disabled && select().value === "", `${surface}: pending operation leaked into another thread`);
      window.testWorkspace = { ...window.testWorkspace, api: { ...window.testWorkspace.api as object, isDesktop: false } };
      render({ ...session, id: "viewer-thread" }); await settle();
      assert(select().disabled && settings().textContent?.includes("read-only"), `${surface}: paired viewer can change settings`);
      root.render(null); await settle();
    }
  } finally { root.unmount(); window.testWorkspace = previous; }
}
