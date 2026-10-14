import type { Root } from "react-dom/client";
import type { HarnessDiscovery } from "@capsule/shared";
import { useHarnessDiscovery } from "../lib/harness-discovery";

function Probe({ api, harnessId }: { api: typeof window.capsule; harnessId: string }) {
  const discovery = useHarnessDiscovery(api, "project", harnessId, undefined, true);
  return <div><output>{discovery.loading ? "Loading" : discovery.error ?? discovery.result?.models?.availableModels[0]?.name}</output><button onClick={discovery.retry}>Retry discovery</button></div>;
}

export async function runDiscoveryRegressions(root: Root) {
  const pending = new Map<string, { resolve(value: HarnessDiscovery): void; reject(error: Error): void }>();
  const api = { isDesktop: true, discoverHarness: async (_project: string, id: string) => new Promise<HarnessDiscovery>((resolve, reject) => pending.set(id, { resolve, reject })) } as typeof window.capsule;
  const wait = async (check: () => unknown) => {
    const deadline = Date.now() + 3000;
    while (!check()) { if (Date.now() > deadline) throw new Error(`Discovery did not settle: ${check}`); await new Promise((resolve) => setTimeout(resolve, 10)); }
  };
  root.render(<Probe api={api} harnessId="codex" />);
  await wait(() => pending.has("codex"));
  root.render(<Probe api={api} harnessId="claude" />);
  await wait(() => pending.has("claude"));
  pending.get("codex")!.resolve({ models: { availableModels: [{ modelId: "old", name: "Stale model" }] } });
  pending.get("claude")!.reject(new Error("Sign-in required"));
  await wait(() => document.querySelector("output")?.textContent === "Sign-in required");
  const previous = pending.get("claude");
  document.querySelector<HTMLButtonElement>("button")!.click();
  await wait(() => pending.get("claude") !== previous);
  pending.get("claude")!.resolve({ models: { availableModels: [{ modelId: "actual", name: "Reported model" }] } });
  await wait(() => document.querySelector("output")?.textContent === "Reported model");
  root.render(<Probe api={{ isDesktop: true } as typeof window.capsule} harnessId="codex" />);
  await wait(() => document.querySelector("output")?.textContent?.includes("Restart Capsule"));
}
