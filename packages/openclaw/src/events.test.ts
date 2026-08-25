import { describe, expect, it } from "vitest";
import {
  acpCommandFailed,
  compactParams,
  extractGatewayText,
  isGatewayTurnDone,
} from "./events.js";

describe("gateway chat extraction", () => {
  it("reads ChatEvent deltaText and final message content", () => {
    expect(extractGatewayText({ deltaText: "Hel" })).toBe("Hel");
    expect(extractGatewayText({ message: { content: "ACP ready" } })).toBe("ACP ready");
    expect(
      extractGatewayText({
        message: { content: [{ type: "text", text: "spawned " }, { text: "claude" }] },
      }),
    ).toBe("spawned claude");
  });

  it("treats final and aborted states as done", () => {
    expect(isGatewayTurnDone({ state: "delta" })).toBe(false);
    expect(isGatewayTurnDone({ state: "final" })).toBe(true);
    expect(isGatewayTurnDone({ state: "aborted" })).toBe(true);
  });

  it("flags ACP spawn failures", () => {
    expect(acpCommandFailed("ACP runtime backend is not configured")).toBeTruthy();
    expect(acpCommandFailed("Spawned claude --bind here")).toBeUndefined();
  });

  it("drops undefined RPC fields", () => {
    expect(compactParams({ key: "s1", message: undefined, cwd: "/repo" })).toEqual({
      key: "s1",
      cwd: "/repo",
    });
  });
});
