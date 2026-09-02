import { describe, expect, it } from "vitest";
import {
  GEMINI_FLASH_MODEL,
  PRESET_HARNESSES,
  acpLabelToken,
  gatewaySessionLabel,
} from "./harness.js";

describe("gatewaySessionLabel", () => {
  it("keeps the title readable and suffixes it with the id's tail", () => {
    expect(gatewaySessionLabel("Fix the sidebar", "sess_abc123def")).toBe(
      "Fix the sidebar (123def)",
    );
  });

  it("gives two threads with the same title different labels", () => {
    /*
     * The Gateway rejects a duplicate label and every new thread starts life
     * called "New conversation", so this is the whole reason the suffix
     * exists: without it the second thread fails to spawn with
     * "label already in use".
     */
    expect(gatewaySessionLabel("New conversation", "sess_111111")).not.toBe(
      gatewaySessionLabel("New conversation", "sess_222222"),
    );
  });

  it("collides when the caller passes the same id twice", () => {
    // Documents the contract the caller has to honour: the label is only
    // unique if the id is. Passing a harness id here is what broke it.
    expect(gatewaySessionLabel("New conversation", "claude")).toBe(
      gatewaySessionLabel("New conversation", "claude"),
    );
  });

  it("falls back to a readable name when the title is missing or blank", () => {
    expect(gatewaySessionLabel(undefined, "sess_abcdef")).toBe("Conversation (abcdef)");
    expect(gatewaySessionLabel("   ", "sess_abcdef")).toBe("Conversation (abcdef)");
  });

  it("keeps a short id whole rather than padding it", () => {
    expect(gatewaySessionLabel("Thread", "ab")).toBe("Thread (ab)");
  });
});

describe("acpLabelToken", () => {
  it("reduces a label to one token acpx can parse", () => {
    // acpx splits slash-command arguments on whitespace with no quote
    // handling, so a label with a space would be read as two arguments.
    expect(acpLabelToken("New conversation (abc123)")).not.toMatch(/\s/);
  });

  it("never returns empty, which would drop the --label value", () => {
    expect(acpLabelToken("   ")).toBe("capsule");
    expect(acpLabelToken("!!!")).toBe("capsule");
  });
});

describe("Gemini Flash", () => {
  const gemini = PRESET_HARNESSES.find((preset) => preset.id === "gemini-flash");

  it("drives the CLI's own ACP mode on the Flash model", () => {
    // `--experimental-acp` still works but is deprecated; `--acp` is current.
    expect(gemini?.acpxCommand).toEqual({
      command: "gemini",
      args: ["--acp", "--model", GEMINI_FLASH_MODEL],
    });
  });

  it("does not claim a sign-in check the CLI does not offer", () => {
    // Without a probe Capsule reports "unknown" and lets the spawn proceed,
    // rather than guessing that an unreadable state means logged out.
    expect(gemini?.loginProbeArgs).toBeUndefined();
  });

  it("is locked to Google, like the harness it wraps", () => {
    expect(gemini?.providerLocked).toBe(true);
    expect(gemini?.underlyingCli).toBe("gemini");
  });
});
