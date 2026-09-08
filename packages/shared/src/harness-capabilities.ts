import type { HarnessLiveStatus, HarnessStatus, SessionRef } from "./harness.js";

export interface FeatureAvailability { state: "available" | "unavailable" | "limited"; detail: string }
export function harnessCapabilities(input: { harness?: HarnessStatus; session?: SessionRef; status?: HarnessLiveStatus }) {
  const { harness, session, status } = input;
  const live = Boolean(session?.harnessId === harness?.id && session?.openclawSessionKey && session.harnessState !== "closed");
  // An existing thread keeps its route, regardless of changed defaults.
  const savedDirect = session?.directSession?.harnessId === harness?.id && Boolean(session?.directSession);
  const route = live ? session!.openclawSessionKey!.startsWith("direct:acp:") ? "direct" : "openclaw" : savedDirect ? "direct" : harness?.runtimeRoute;
  const unavailable = (detail: string): FeatureAvailability => ({ state: "unavailable", detail });
  const available = (detail: string): FeatureAvailability => ({ state: "available", detail });
  const limited = (detail: string): FeatureAvailability => ({ state: "limited", detail });
  const noSession = unavailable(harness ? "Start this agent in a thread to inspect its live capabilities." : "Select a harness to see what it supports.");
  const currentStatus = live && status?.session.id === session?.id
    && status?.session.openclawSessionKey === session?.openclawSessionKey ? status : undefined;
  const models = currentStatus?.parsed?.models?.availableModels ?? [];
  const report = currentStatus?.parsed?.reported;
  const tuning = !live ? noSession : route === "direct"
    ? report?.configOptions.length ? available("Change the exact settings reported by this agent in Agent settings. Changes wait for its acknowledgement.")
      : unavailable("This agent has not reported mutable configuration. Refresh status or configure its CLI before starting it.")
    : limited("Sent through the Gateway; the selected agent decides which values it accepts.");
  const mutableModel = report?.configOptions.some((option) => (option.id === "model" || option.category === "model") && option.type !== "boolean" && option.choices.length > 0);
  const directBrowser = report && report.httpMcp !== true
    ? unavailable("This agent did not advertise HTTP MCP support. Capsule did not attach its browser tools; manual browsing is still available.")
    : limited("Direct agents that accept HTTP MCP can use snapshots, navigation, clicking, text entry, selection, scrolling, keyboard input, screenshots and page diagnostics. Enable Allow agent control in this thread’s Browser panel. Passwords, uploads and arbitrary JavaScript are not exposed; manual browsing remains available.");
  return {
    route,
    model: !live ? noSession : route === "direct"
      ? mutableModel ? available(`${models.length} models reported by this live agent. Changes require its acknowledgement.`)
        : unavailable("This agent has not reported a mutable model selector. Refresh status or configure its CLI before starting it.")
      : models.length ? available(`${models.length} models reported by this live agent.`)
      : unavailable("This agent has not reported a model list. Refresh its status in Harnesses; a supported model ID can be entered there."),
    tuning,
    steer: !live ? noSession : route === "direct"
      ? unavailable("Direct mode cannot steer an active turn. Stop it or wait, then send a follow-up.")
      : limited("Steering is sent through the Gateway; support depends on the agent."),
    browser: !harness || !route ? unavailable("Select a harness and runtime route first.") : route === "direct"
      ? directBrowser
      : unavailable("Capsule does not inject its browser tools into Gateway agents. Browse manually here, or configure browser tools on the Gateway."),
    permissions: route === "direct"
      ? limited("Direct agents can request approval once in Capsule. Agent settings may expose their own permission options; Capsule's permission profiles are not automatically mapped to them.")
      : limited("Gateway ACP Standard and Full access approve tools automatically; Supervised refuses tools that require a prompt. Agent settings may impose additional restrictions."),
  };
}
