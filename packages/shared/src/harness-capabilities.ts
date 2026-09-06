import type { HarnessLiveStatus, HarnessStatus, SessionRef } from "./harness.js";

export interface FeatureAvailability { state: "available" | "unavailable" | "limited"; detail: string }
export function harnessCapabilities(input: { harness?: HarnessStatus; session?: SessionRef; status?: HarnessLiveStatus }) {
  const { harness, session, status } = input;
  const live = Boolean(session?.harnessId === harness?.id && session?.openclawSessionKey && session.harnessState !== "closed");
  // An existing thread keeps its route, regardless of changed defaults.
  const route = live ? session!.openclawSessionKey!.startsWith("direct:acp:") ? "direct" : "openclaw" : harness?.runtimeRoute;
  const unavailable = (detail: string): FeatureAvailability => ({ state: "unavailable", detail });
  const available = (detail: string): FeatureAvailability => ({ state: "available", detail });
  const limited = (detail: string): FeatureAvailability => ({ state: "limited", detail });
  const noSession = unavailable(harness ? "Start this agent in a thread to inspect its live capabilities." : "Select a harness to see what it supports.");
  const tuning = !live ? noSession : route === "direct"
    ? unavailable("Direct mode cannot change live options. Close the agent, configure its CLI, and start a new session.")
    : limited("Sent through the Gateway; the selected agent decides which values it accepts.");
  const models = status?.session.id === session?.id ? status?.parsed?.models?.availableModels ?? [] : [];
  return {
    route,
    model: !live ? noSession : route === "direct"
      ? unavailable("Direct mode fixes the model at startup. Close the agent and start it again to change models.")
      : models.length ? available(`${models.length} models reported by this live agent.`)
      : unavailable("This agent has not reported a model list. Refresh its status in Harnesses; a supported model ID can be entered there."),
    tuning,
    steer: !live ? noSession : route === "direct"
      ? unavailable("Direct mode cannot steer an active turn. Stop it or wait, then send a follow-up.")
      : limited("Steering is sent through the Gateway; support depends on the agent."),
    browser: !harness || !route ? unavailable("Select a harness and runtime route first.") : route === "direct"
      ? limited("Capsule offers browser status, navigation and text snapshots to direct agents that accept HTTP MCP tools. Automated clicking and typing are not provided.")
      : unavailable("Capsule does not inject its browser tools into Gateway agents. Browse manually here, or configure browser tools on the Gateway."),
    permissions: route === "direct"
      ? limited("Direct agents can request approval once in Capsule. Live permission tuning and session-wide approval are unavailable.")
      : limited("Gateway ACP Standard and Full access approve tools automatically; Supervised refuses tools that require a prompt. Agent settings may impose additional restrictions."),
  };
}
