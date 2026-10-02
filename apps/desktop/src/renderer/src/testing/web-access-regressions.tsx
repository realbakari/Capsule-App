import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, type CapsuleSettings, type RemoteAccessStatus } from "@capsule/shared";
import { RemoteAccessSettings } from "../features/settings/RemoteAccessSettings";
import { AnalyticsSettings } from "../features/settings/AnalyticsSettings";
import { RemoteSessionBanner } from "../features/shell/RemoteSessionBanner";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }

export async function runWebAccessRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const root = createRoot(host);
  const pairings: string[] = [];
  const patches: Partial<CapsuleSettings>[] = [];
  let copied = "";
  let status: RemoteAccessStatus = { reach: "loopback", url: "http://127.0.0.1:5000", controlAvailable: true, devices: [] };
  const api = { isDesktop: true, remoteMode: "desktop", on: () => () => {},
    remoteStatus: async () => status,
    remotePair: async (access: string) => { pairings.push(access); return "http://127.0.0.1:5000/#pair=test"; },
    analyticsStatus: async () => ({ enabled: false, configured: true, pending: 0, host: "https://us.i.posthog.com" }),
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  try {
    window.testWorkspace = { api };
    const patch = async (value: Partial<CapsuleSettings>) => { patches.push(value); };
    root.render(<RemoteAccessSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    const permissions = host.querySelector<HTMLSelectElement>('[aria-label="Device permission"]')!;
    assert(permissions.value === "read", "Pairing must start read-only");
    permissions.value = "control"; permissions.dispatchEvent(new Event("change", { bubbles: true })); await settle();
    Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Create link"))!.click(); await settle();
    assert(pairings.join() === "control" && copied === "http://127.0.0.1:5000/#pair=test", "Control pairing did not copy the scoped link");
    root.render(null); await settle();
    status = { ...status, reach: "network", controlAvailable: false };
    root.render(<RemoteAccessSettings settings={{ ...DEFAULT_CAPSULE_SETTINGS, remoteAccess: "network" }} patch={patch} />); await settle();
    assert(host.querySelector<HTMLOptionElement>('option[value="control"]')?.disabled && host.textContent?.includes("HTTP is read-only"), "Plaintext network offered control");
    root.render(<AnalyticsSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    const consent = host.querySelector<HTMLInputElement>('[aria-label="Share usage reports"]')!;
    assert(!consent.checked && host.textContent?.includes("Collection is off"), "Analytics was implicitly enabled");
    consent.click(); await settle();
    assert(patches.at(-1)?.analyticsEnabled === true, "Opt-in did not save an explicit choice");
    window.testWorkspace = { api: { ...api, isDesktop: false, remoteMode: "control" } };
    root.render(<AnalyticsSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    assert(host.querySelector<HTMLInputElement>("input")?.disabled && host.textContent?.includes("host computer"), "Browser could change host consent");
    root.render(<RemoteSessionBanner />); await settle();
    assert(host.textContent?.includes("Conversation control") && host.textContent?.includes("Supervised"), "Browser control permission is not visible");
    root.render(<RemoteAccessSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    assert(host.textContent?.includes("Manage pairing") && !host.querySelector("select"), "Remote browser offered administrative pairing");
  } finally {
    root.unmount(); window.testWorkspace = previous;
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}
