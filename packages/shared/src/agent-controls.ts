import type { HarnessLiveStatus, SessionRef } from "./harness.js";
import type { AcpConfigOption } from "./harness.js";

/** Only current, reported selectors become controls. Unknown settings stay advanced. */
export function agentControls(session?: SessionRef, status?: HarnessLiveStatus) {
  const options = session && status && session.harnessState !== "closed" && session.id === status.session.id && session.openclawSessionKey === status.session.openclawSessionKey
    ? status?.parsed?.reported?.configOptions ?? [] : [];
  return reportedAgentControls(options);
}

export function reportedAgentControls(options: AcpConfigOption[] = []) {
  const select = (categories: string[], ids: string[]) => options.find((option) => option.type !== "boolean" && option.choices.length > 0
    && (categories.includes(option.category ?? "") || ids.includes(option.id)));
  return {
    model: select(["model"], ["model"]),
    effort: select(["thought_level"], ["reasoning_effort", "reasoningEffort", "effort"]),
    permissions: select(["permissions", "permission"], ["permissions", "approval_mode", "permission_mode"]),
    mode: select(["mode"], ["mode"]),
  };
}
