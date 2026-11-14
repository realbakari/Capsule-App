import { describe, expect, it, vi } from "vitest";
import type { AcpConfigOption } from "@capsule/shared";
import { carryTurnMode, type TurnModeTarget } from "./turn-mode.js";

const modeOption = (currentValue: string): AcpConfigOption => ({ id: "mode", category: "mode", name: "Mode", currentValue,
  choices: [{ value: "code", name: "Code" }, { value: "plan", name: "Plan" }, { value: "ask", name: "Ask" }] });

function target(patch: Partial<TurnModeTarget> & { options?: AcpConfigOption[]; reported?: boolean }): TurnModeTarget & { setMode: ReturnType<typeof vi.fn>; readOptions: ReturnType<typeof vi.fn> } {
  const { options, reported = Boolean(options), ...rest } = patch;
  return { route: "gateway", harnessId: "gemini", harnessName: "Gemini CLI", switchedToPlan: false,
    readOptions: vi.fn(async () => ({ options, reported })), setMode: vi.fn(async () => undefined), ...rest } as never;
}

describe("carryTurnMode", () => {
  it("switches a reporting Gateway agent into plan with a control command and back for Act", async () => {
    const plan = target({ options: [modeOption("code")] });
    const planned = await carryTurnMode("plan", plan);
    expect(plan.setMode).toHaveBeenCalledWith("mode", "plan");
    expect(planned).toMatchObject({ instruction: false, inPlan: true, support: { enforced: true, label: "Enforced by Gemini CLI" } });

    const act = target({ options: [modeOption("plan")], switchedToPlan: true });
    const acted = await carryTurnMode("act", act);
    expect(act.setMode).toHaveBeenCalledWith("mode", "code");
    expect(acted.inPlan).toBe(false);
    expect(acted.event?.message).toMatch(/out of its plan mode/);
  });

  it("does not ask the Gateway for status on an Act turn it never switched", async () => {
    const act = target({ options: [modeOption("code")] });
    const acted = await carryTurnMode("act", act);
    expect(acted).toMatchObject({ instruction: false, inPlan: false });
    expect(acted.event).toBeUndefined();
    expect(act.readOptions).not.toHaveBeenCalled();
  });

  it("asks without enforcing when the agent reports no plan mode, and says so", async () => {
    const plan = target({ options: [{ id: "model", category: "model", name: "Model", choices: [{ value: "a", name: "A" }] }] });
    const planned = await carryTurnMode("plan", plan);
    expect(plan.setMode).not.toHaveBeenCalled();
    expect(planned).toMatchObject({ instruction: true, inPlan: false, support: { enforced: false, label: "Asked, not enforced" } });
    expect(planned.support.detail).toMatch(/does not report a plan mode through the Gateway/);
  });

  it("falls back to asking when the switch fails, rather than running an unplanned turn silently", async () => {
    const plan = target({ options: [modeOption("code")], setMode: vi.fn(async () => { throw new Error("busy"); }) });
    const planned = await carryTurnMode("plan", plan);
    expect(planned).toMatchObject({ instruction: true, inPlan: false });
    expect(planned.event?.message).toMatch(/could not switch Gemini CLI.*busy.*not enforced/);
  });

  it("uses each direct adapter's own mode and adds the instruction only where the adapter needs it", async () => {
    const options = (current: string): AcpConfigOption[] => [{ id: "mode", category: "mode", name: "Mode", currentValue: current,
      choices: [{ value: "default", name: "Act" }, { value: "plan", name: "Plan" }] }];
    const claude = target({ route: "direct", harnessId: "claude", harnessName: "Claude Code", options: options("default") });
    expect(await carryTurnMode("plan", claude)).toMatchObject({ instruction: false, support: { label: "Enforced by Claude Code" } });
    expect(claude.setMode).toHaveBeenCalledWith("mode", "plan");
    const codex = target({ route: "direct", harnessId: "codex", harnessName: "Codex", options: options("default") });
    expect(await carryTurnMode("plan", codex)).toMatchObject({ instruction: true, support: { label: "Read-only, enforced by Codex" } });
    const back = target({ route: "direct", harnessId: "claude", harnessName: "Claude Code", options: options("plan") });
    await carryTurnMode("act", back);
    expect(back.setMode).toHaveBeenCalledWith("mode", "default");
  });

  it("leaves the demo runtime alone: its plan flag travels with the message", async () => {
    const mock = target({ route: "mock" });
    expect(await carryTurnMode("plan", mock)).toMatchObject({ instruction: false, support: { carrier: { kind: "mock" } } });
    expect(mock.readOptions).not.toHaveBeenCalled();
  });
});
