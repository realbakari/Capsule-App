import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, type CapsuleSettings, type RemoteAccessStatus } from "@capsule/shared";
import { RemoteAccessSettings } from "../features/settings/RemoteAccessSettings";
import { AnalyticsSettings } from "../features/settings/AnalyticsSettings";
import { RemoteSessionBanner } from "../features/shell/RemoteSessionBanner";

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function until<T>(read: () => T | null | undefined, message: string): Promise<T> {
  for (let tries = 0; tries < 200; tries += 1) { const value = read(); if (value) return value; await settle(); }
  throw new Error(message);
}
async function settle() { await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); }

export async function runWebAccessRegressions(host: HTMLElement) {
  const previous = window.testWorkspace;
  const clipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const root = createRoot(host);
  const pairings: string[] = [];
  const patches: Partial<CapsuleSettings>[] = [];
  let copied = "";
  let status: RemoteAccessStatus = { reach: "loopback", url: "http://127.0.0.1:5000", controlAvailable: true, devices: [] };
  const revoked: string[] = [];
  let links = [{ id: "share_1", sessionId: "s1", createdAt: new Date().toISOString() }];
  const api = { isDesktop: true, remoteMode: "desktop", on: () => () => {},
    listShareLinks: async () => links,
    revokeShareLink: async (id: string) => { revoked.push(id); links = []; },
    threadPresence: async () => [{ sessionId: "s1", viewers: [{ kind: "phone", label: "iPhone", since: Date.now() }] }],
    remoteStatus: async () => status,
    remotePair: async (access: string) => { pairings.push(access); return "http://127.0.0.1:5000/#pair=test"; },
    analyticsStatus: async () => ({ enabled: false, configured: true, pending: 0, host: "https://us.i.posthog.com" }),
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  try {
    window.testWorkspace = { api, sessions: [{ id: "s1", projectId: "p1", title: "Fix the login form" }], setProjectId: () => {}, setView: () => {} };
    const patch = async (value: Partial<CapsuleSettings>) => { patches.push(value); };
    root.render(<RemoteAccessSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    const permissions = await until(() => host.querySelector<HTMLSelectElement>('[aria-label="Device permission"]'), "Browser access card never showed the device permission");
    assert(permissions.value === "read", "Pairing must start read-only");
    permissions.value = "control"; permissions.dispatchEvent(new Event("change", { bubbles: true })); await settle();
    Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Create link"))!.click(); await settle();
    assert(pairings.join() === "control" && copied === "http://127.0.0.1:5000/#pair=test", "Control pairing did not copy the scoped link");
    const shareSettings = host.querySelector(".share-settings");
    assert(shareSettings?.textContent?.includes("iPhone") && shareSettings.textContent.includes("Viewing Fix the login form"), "Connected devices did not name the thread they view");
    assert(shareSettings?.textContent?.includes("never expires"), "Share links were not listed");
    Array.from(shareSettings!.querySelectorAll("button")).find((button) => button.textContent === "Revoke")!.click(); await settle(); await settle();
    assert(revoked.join() === "share_1" && host.querySelector(".share-settings")?.textContent?.includes("None. Share a conversation"), "Revoking a share link did not take it off the list");
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
    assert(host.textContent?.includes("Conversation control") && host.textContent?.includes("New threads use Ask"), "Browser control permission is not visible");
    root.render(<RemoteAccessSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    assert(host.textContent?.includes("Manage pairing") && !host.querySelector("select"), "Remote browser offered administrative pairing");
  } finally {
    root.unmount(); window.testWorkspace = previous;
    if (clipboard) Object.defineProperty(navigator, "clipboard", clipboard);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}
