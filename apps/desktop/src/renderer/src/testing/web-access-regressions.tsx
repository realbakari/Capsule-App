import { createRoot } from "react-dom/client";
import { DEFAULT_CAPSULE_SETTINGS, type CapsuleSettings, type RemoteAccessStatus } from "@capsule/shared";
import { RemoteAccessSettings } from "../features/settings/RemoteAccessSettings";
import { AnalyticsSettings } from "../features/settings/AnalyticsSettings";
import { RemoteSessionBanner } from "../features/shell/RemoteSessionBanner";
import { Troubleshooting } from "../features/settings/Troubleshooting";
import { VoiceSettings } from "../features/settings/VoiceSettings";

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
  const revokedDevices: string[] = [];
  let confirmOpen = false;
  let links = [{ id: "share_1", sessionId: "s1", createdAt: new Date().toISOString() }];
  const api = { isDesktop: true, remoteMode: "desktop", on: () => () => {},
    listShareLinks: async () => links,
    revokeShareLink: async (id: string) => { revoked.push(id); links = []; },
    threadPresence: async () => [{ sessionId: "s1", viewers: [{ kind: "phone", label: "iPhone", since: Date.now() }] }],
    remoteStatus: async () => status,
    remotePair: async (access: string) => { pairings.push(access); return "http://127.0.0.1:5000/#pair=test"; },
    remoteRevoke: async (id: string) => { revokedDevices.push(id); status = { ...status, devices: status.devices.filter((device) => device.id !== id) }; return true; },
    analyticsStatus: async () => ({ enabled: false, configured: true, pending: 0, host: "https://us.i.posthog.com" }),
    getDiagnostics: async () => ({ capsuleVersion: "9.9.9", electronVersion: "43.0.0", gatewayStatus: "disconnected", databaseStatus: "connected", connectionLogs: ["Engine started.", "Removed 2 checkpoints for a deleted conversation."] }),
  };
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (value: string) => { copied = value; } } });
  try {
    window.testWorkspace = { api, sessions: [{ id: "s1", projectId: "p1", title: "Fix the login form" }], setProjectId: () => {}, setView: () => {},
      setConfirm: (confirm?: { title: string; onConfirm: () => void }) => { confirmOpen = Boolean(confirm); if (confirm?.title.startsWith("Revoke all 2")) confirm.onConfirm(); } };
    const patch = async (value: Partial<CapsuleSettings>) => { patches.push(value); };
    root.render(<RemoteAccessSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    const permissions = await until(() => host.querySelector<HTMLSelectElement>('[aria-label="Browser link permission"]'), "Browser access card never showed the device permission");
    assert(permissions.value === "read", "Pairing must start read-only");
    permissions.value = "control"; permissions.dispatchEvent(new Event("change", { bubbles: true })); await settle();
    Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Create link"))!.click(); await settle();
    assert(pairings.join() === "control" && copied === "http://127.0.0.1:5000/#pair=test", "Control pairing did not copy the scoped link");
    const shareSettings = host.querySelector(".share-settings");
    assert(shareSettings?.textContent?.includes("iPhone") && shareSettings.textContent.includes("Viewing Fix the login form"), "Connected devices did not name the thread they view");
    assert(shareSettings?.textContent?.includes("never expires"), "Share links were not listed");
    Array.from(shareSettings!.querySelectorAll("button")).find((button) => button.textContent === "Revoke")!.click(); await settle(); await settle();
    assert(revoked.join() === "share_1" && host.querySelector(".share-settings")?.textContent?.includes("None. Share a conversation"), "Revoking a share link did not take it off the list");
    const now = Date.now();
    status = { ...status, devices: [
      { id: "d1", label: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", transport: "browser", scopes: ["read"], createdAt: now - 3_600_000, lastSeenAt: now - 120_000, expiresAt: now + 11 * 3_600_000 },
      { id: "d2", label: "Pixel", transport: "phone", scopes: ["read", "control"], createdAt: now - 3 * 86_400_000, lastSeenAt: now - 2 * 86_400_000, expiresAt: now + 365 * 86_400_000 },
    ] };
    root.render(<RemoteAccessSettings settings={{ ...DEFAULT_CAPSULE_SETTINGS, remoteAccess: "loopback" }} patch={patch} />); await settle(); await settle();
    const devices = await until(() => host.querySelector(".remote-devices-heading")?.parentElement, "Paired devices never listed");
    assert(devices.textContent?.includes("Safari on iPhone") && !devices.textContent.includes("Mozilla"), "A paired browser was named by its raw user agent");
    assert(devices.textContent?.includes("Read only · last active 2m ago · expires in 11h"), "A browser pairing did not say what it may do and when it ends");
    assert(devices.textContent?.includes("Phone, encrypted · Conversation control · last active 2 days ago") && !devices.textContent.includes("read, control"), "A phone pairing showed raw scopes");
    Array.from(devices.querySelectorAll("button")).find((button) => button.textContent === "Revoke all")!.click(); await settle(); await settle();
    assert(revokedDevices.join() === "d1,d2" && !confirmOpen, "Revoke all did not end every pairing and close its confirmation");
    await until(() => host.textContent?.includes("None yet. A device appears here"), "Revoked devices stayed listed");
    // A reach set at launch holds until quit, so the setting cannot be a live control.
    status = { ...status, heldByLaunch: true };
    root.render(<RemoteAccessSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle(); await settle();
    const reach = await until(() => host.querySelector<HTMLSelectElement>('[aria-label="Who can reach it"]'), "Reach control missing");
    await until(() => reach.disabled && reach.value === "loopback" && host.textContent?.includes("stays until Capsule quits"), "A launch-held reach showed the saved setting as if it applied");
    status = { ...status, heldByLaunch: undefined };
    // Switching to This network while Conversation control is chosen falls back to read, without a remount.
    status = { ...status, reach: "network", controlAvailable: false };
    root.render(<RemoteAccessSettings settings={{ ...DEFAULT_CAPSULE_SETTINGS, remoteAccess: "network" }} patch={patch} />); await settle(); await settle();
    assert(host.querySelector<HTMLSelectElement>('[aria-label="Browser link permission"]')?.value === "read", "An unavailable Conversation control stayed selected");
    assert(host.querySelector<HTMLOptionElement>('option[value="control"]')?.disabled && host.textContent?.includes("HTTP is read-only"), "Plaintext network offered control");
    root.render(<AnalyticsSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    const consent = host.querySelector<HTMLInputElement>('[aria-label="Share usage reports"]')!;
    assert(!consent.checked && host.textContent?.includes("Collection is off"), "Analytics was implicitly enabled");
    consent.click(); await settle();
    assert(patches.at(-1)?.analyticsEnabled === true, "Opt-in did not save an explicit choice");
    window.testWorkspace = { api: { ...api, isDesktop: false, remoteMode: "control" } };
    root.render(<AnalyticsSettings settings={DEFAULT_CAPSULE_SETTINGS} patch={patch} />); await settle();
    assert(host.querySelector<HTMLInputElement>("input")?.disabled && host.textContent?.includes("host computer"), "Browser could change host consent");
    root.render(<Troubleshooting />); await settle();
    const troubleshooting = await until(() => host.querySelector(".troubleshooting")?.textContent?.includes("Capsule 9.9.9") ? host.querySelector(".troubleshooting") : null, "Troubleshooting never showed the version");
    assert(troubleshooting.textContent?.includes("Not connected. It is optional") && troubleshooting.textContent.includes("Recent log · 2 lines"), "Troubleshooting did not show the Gateway state in words or the log");
    Array.from(troubleshooting.querySelectorAll("button")).find((button) => button.textContent === "Copy diagnostics")!.click();
    await until(() => troubleshooting.textContent?.includes("Copied"), "Copy diagnostics did not confirm");
    assert(copied.includes("\"capsuleVersion\": \"9.9.9\"") && copied.includes("Removed 2 checkpoints") && copied.includes("rendererPerformance"), "Copied diagnostics missed the version, log or timings");
    const panes: string[] = [];
    const voiceApi = { ...api, platform: "darwin", getPetVoiceStatus: async () => ({ inputAvailable: true, outputAvailable: true }),
      openDictationSettings: async (pane: string) => { panes.push(pane); } };
    window.testWorkspace = { api: voiceApi, keyBindings: [] };
    root.render(<VoiceSettings />); await settle();
    await until(() => host.querySelector(".voice-settings")?.textContent?.includes("Available on this Mac"), "Voice did not report speech recognition as available");
    Array.from(host.querySelectorAll<HTMLButtonElement>(".voice-settings button")).find((button) => button.textContent === "Microphone")!.click(); await settle();
    assert(panes.join() === "microphone", "Voice did not open the microphone privacy pane");
    window.testWorkspace = { api: { ...voiceApi, getPetVoiceStatus: async () => ({ inputAvailable: false, outputAvailable: true, detail: "On-device English recognition is unavailable." }) }, keyBindings: [] };
    root.render(null); await settle(); root.render(<VoiceSettings />); await settle();
    await until(() => host.querySelector(".voice-settings")?.textContent?.includes("On-device English recognition is unavailable."), "Voice hid why speech recognition is unavailable");
    window.testWorkspace = { api: { ...voiceApi, isDesktop: false, remoteMode: "control" }, keyBindings: [] };
    root.render(null); await settle(); root.render(<VoiceSettings />); await settle();
    assert(host.textContent?.includes("Dictation runs on the Mac") && !host.querySelector(".voice-settings button"), "A paired device was offered the host's privacy settings");
    window.testWorkspace = { api: { ...api, isDesktop: false, remoteMode: "control" } };
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
