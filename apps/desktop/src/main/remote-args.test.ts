import { describe, expect, it } from "vitest";

import { remoteReachFromArgs } from "./remote-args.js";

describe("remoteReachFromArgs", () => {
  it("takes --remote as this Mac", () => {
    expect(remoteReachFromArgs(["electron", ".", "--remote"])).toBe("loopback");
  });

  it("takes an explicit reach", () => {
    expect(remoteReachFromArgs(["--remote=network"])).toBe("network");
    expect(remoteReachFromArgs(["--remote=loopback"])).toBe("loopback");
  });

  it("reads the environment when the launcher owns argv", () => {
    expect(remoteReachFromArgs([], { CAPSULE_REMOTE: "network" })).toBe("network");
  });

  it("says nothing when nobody asked", () => {
    expect(remoteReachFromArgs(["electron", "."])).toBeUndefined();
    // A value that is not a reach must not be guessed into one.
    expect(remoteReachFromArgs(["--remote=everywhere"])).toBeUndefined();
  });

  it("honours an explicit off", () => {
    expect(remoteReachFromArgs(["--remote=off"])).toBe("off");
  });
});
