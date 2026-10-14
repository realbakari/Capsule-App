import { expect, it } from "vitest";
import { agentControls } from "./agent-controls.js";
import type { HarnessLiveStatus, SessionRef } from "./harness.js";

it("promotes reported controls without mistaking workflow modes for permission profiles", () => {
  const session: SessionRef = { id: "s", projectId: "p", agentId: "codex", harnessId: "codex", title: "Task", mode: "code", state: "active", harnessState: "waiting", openclawSessionKey: "direct:codex:1" };
  const choice = [{ value: "one", name: "One" }];
  const status: HarnessLiveStatus = { session, state: "waiting", parsed: { reported: { configOptions: [
    { id: "thinking", category: "thought_level", name: "Effort", choices: choice },
    { id: "agent-mode", category: "mode", name: "Mode", choices: choice },
    { id: "permissions", name: "Permissions", choices: choice },
  ] } } };
  expect(agentControls(session, status).effort?.id).toBe("thinking");
  expect(agentControls(session, status).permissions?.id).toBe("permissions");
  expect(agentControls(session, status).mode?.id).toBe("agent-mode");
  expect(agentControls({ ...session, openclawSessionKey: "replacement" }, status).effort).toBeUndefined();
  expect(agentControls({ ...session, harnessState: "closed" }, status).permissions).toBeUndefined();
});
