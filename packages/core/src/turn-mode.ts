import {
  actModeValue,
  needsPlanInstruction,
  planModeSupport,
  type AcpConfigOption,
  type PlanModeSupport,
  type PlanRoute,
  type TurnMode,
} from "@capsule/shared";

/** What the engine knows about the agent carrying this turn, and how to change its mode. */
export interface TurnModeTarget {
  route: PlanRoute;
  harnessId?: string;
  harnessName?: string;
  /** Read only when a switch might be needed: on the Gateway it costs a status round trip. */
  readOptions(): Promise<{ options?: AcpConfigOption[]; reported: boolean }>;
  setMode(optionId: string, value: string): Promise<void>;
  /** Capsule switched this agent to plan for an earlier turn, so an Act turn must switch it back. */
  switchedToPlan: boolean;
  /** The mode the user chose for Act turns, if one is saved. */
  savedActValue?: string | boolean;
}

export interface CarriedTurnMode {
  support: PlanModeSupport;
  /** The prompt needs the plan instruction ahead of it. */
  instruction: boolean;
  /** The agent is left in its plan mode after this call. */
  inPlan: boolean;
  /** A line for the run's event log, or undefined for an ordinary Act turn. */
  event?: { message: string; data: Record<string, unknown> };
}

/**
 * Put the agent in the right mode for this turn. A failed switch to plan falls
 * back to asking, and the event log says so, rather than running unplanned.
 */
export async function carryTurnMode(mode: TurnMode, target: TurnModeTarget): Promise<CarriedTurnMode> {
  const needOptions = target.route !== "mock" && (mode === "plan" || target.switchedToPlan || target.route === "direct");
  const read = needOptions ? await target.readOptions().catch(() => ({ options: undefined, reported: false })) : { options: undefined, reported: false };
  const support = planModeSupport({ harnessId: target.harnessId, harnessName: target.harnessName, route: target.route, options: read.options, reported: read.reported });
  const carrier = support.carrier;
  const option = carrier.kind === "agent-mode" ? read.options?.find((item) => item.id === carrier.optionId) : undefined;
  const data = { turnMode: mode, carrier: carrier.kind, enforced: support.enforced };
  if (mode === "plan") {
    if (carrier.kind === "agent-mode" && option && option.currentValue !== carrier.planValue) {
      try { await target.setMode(carrier.optionId, carrier.planValue); }
      catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        return { support, instruction: true, inPlan: false,
          event: { message: `Plan mode: could not switch ${target.harnessName ?? "the agent"} to its plan mode (${reason}). Asked it to plan instead; not enforced.`, data: { ...data, enforced: false, error: reason } } };
      }
    }
    return { support, instruction: needsPlanInstruction(support), inPlan: carrier.kind === "agent-mode",
      event: { message: `Plan mode: ${support.label}`, data } };
  }
  const inPlan = option ? option.currentValue === (carrier.kind === "agent-mode" ? carrier.planValue : undefined) : target.switchedToPlan;
  if (carrier.kind === "agent-mode" && option && inPlan) {
    const value = actModeValue(option, carrier.planValue, target.savedActValue);
    if (value) {
      await target.setMode(carrier.optionId, value);
      return { support, instruction: false, inPlan: false, event: { message: `Act mode: switched ${target.harnessName ?? "the agent"} out of its plan mode`, data } };
    }
  }
  return { support, instruction: false, inPlan: false };
}
