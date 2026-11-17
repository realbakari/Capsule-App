import { describe, expect, it } from "vitest";
import { composerPrimaryAction } from "./composer-primary-action";

const idle = { running: false, stopping: false, hasContent: true, bang: false, steer: false, compactFirst: false };

describe("composer primary action", () => {
  it("sends when no turn is running", () => {
    expect(composerPrimaryAction(idle)).toEqual({ kind: "send" });
  });

  it("keeps Send while a turn runs and the draft has text, queueing or steering", () => {
    expect(composerPrimaryAction({ ...idle, running: true })).toEqual({ kind: "queue" });
    expect(composerPrimaryAction({ ...idle, running: true, steer: true })).toEqual({ kind: "steer" });
  });

  it("becomes Stop only when a turn runs and the draft is empty", () => {
    expect(composerPrimaryAction({ ...idle, running: true, hasContent: false })).toEqual({ kind: "stop", stopping: false });
    expect(composerPrimaryAction({ ...idle, running: true, hasContent: false, stopping: true })).toEqual({ kind: "stop", stopping: true });
  });

  it("compacts first only when chosen and nothing is running", () => {
    expect(composerPrimaryAction({ ...idle, compactFirst: true })).toEqual({ kind: "compact-send" });
    expect(composerPrimaryAction({ ...idle, compactFirst: true, running: true })).toEqual({ kind: "queue" });
  });

  it("runs a !command here in any state", () => {
    expect(composerPrimaryAction({ ...idle, bang: true, running: true })).toEqual({ kind: "run-command" });
  });
});
