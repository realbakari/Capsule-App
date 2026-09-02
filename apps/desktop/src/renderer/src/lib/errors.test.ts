import { describe, expect, it } from "vitest";

import { formatUserError } from "./errors";

describe("formatUserError", () => {
  it("keeps the provider's sentence and drops everything wrapped around it", () => {
    expect(
      formatUserError(
        new Error(
          "Error invoking remote method 'capsule:sendMessage': Error: ACP error " +
            "(ACP_SESSION_INIT_FAILED): This client is no longer supported for Gemini Code " +
            "Assist for individuals. To continue using Gemini, please migrate to the " +
            "Antigravity suite of products: https://antigravity.google next: If this session " +
            "is stale, recreate it with `/acp spawn` and rebind the thread.",
        ),
      ),
    ).toBe(
      "This client is no longer supported for Gemini Code Assist for individuals. To continue " +
        "using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google",
    );
  });

  it("handles the bracketed runtime form", () => {
    expect(
      formatUserError("AcpRuntimeError [ACP_TURN_FAILED]: You've hit your session limit."),
    ).toBe("You've hit your session limit.");
  });

  it("names the code when that is all there is", () => {
    expect(formatUserError("ACP error (ACP_SESSION_INIT_FAILED): ")).toBe("Session init failed.");
  });

  it("leaves a message Capsule wrote alone", () => {
    const message = "Choose a project folder before starting this harness.";
    expect(formatUserError(new Error(message))).toBe(message);
  });

  it("never returns an empty string", () => {
    expect(formatUserError(undefined)).toBe("Something went wrong.");
    expect(formatUserError("   ")).toBe("Something went wrong.");
  });
});
