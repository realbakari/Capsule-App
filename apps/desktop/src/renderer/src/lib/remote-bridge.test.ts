import { describe, expect, it } from "vitest";

import { readPairingToken } from "./remote-bridge";

describe("readPairingToken", () => {
  it("reads the token a pairing link carries", () => {
    expect(readPairingToken("#pair=AbC123")).toBe("AbC123");
  });

  it("ignores anything that is not one", () => {
    expect(readPairingToken("")).toBeUndefined();
    expect(readPairingToken("#pair=")).toBeUndefined();
    expect(readPairingToken("#/settings")).toBeUndefined();
    expect(readPairingToken("?pair=AbC123")).toBeUndefined();
  });
});
