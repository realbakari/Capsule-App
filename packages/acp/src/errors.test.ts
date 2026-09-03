import { describe, expect, it } from "vitest";

import { explainDirectFailure, readCliError } from "./errors.js";

describe("reading what a CLI said as it died", () => {
  it("takes the error, not the last thing printed", () => {
    /*
     * This is the bug as it reached a thread: the only explanation shown was
     * the usage footer, because that is what a CLI prints last.
     */
    const stderr = [
      "error: unexpected argument '--session' found",
      "",
      "Usage: grok acp [OPTIONS]",
      "",
      "For more information, try '--help'.",
    ].join("\n");
    expect(readCliError(stderr)).toBe("unexpected argument '--session' found");
  });

  it("finds the error wherever in the output it sits", () => {
    expect(readCliError("warming up\nfatal: Authentication required\nbye")).toBe(
      "Authentication required",
    );
  });

  it("falls back to the first line that is not the CLI describing itself", () => {
    expect(readCliError("Usage: grok [OPTIONS]\n  --help\nSomething broke")).toBe("Something broke");
  });

  it("has nothing to say when the CLI only printed its own usage", () => {
    expect(readCliError("Usage: grok [OPTIONS]\n\nFor more information, try '--help'.")).toBeUndefined();
  });

  it("says nothing for empty output rather than an empty message", () => {
    expect(readCliError("")).toBeUndefined();
    expect(readCliError("   \n  \n")).toBeUndefined();
  });
});

describe("saying what to do about it", () => {
  it("turns an auth failure into the thing the reader has to go and do", () => {
    const said = explainDirectFailure("Authentication required", "Grok Build");
    expect(said).toMatch(/not signed in/i);
    expect(said).toMatch(/Grok Build/);
  });

  it("names the agent, since the thread does not say which one failed", () => {
    expect(explainDirectFailure("command not found", "Gemini")).toMatch(/Gemini/);
  });

  it("does not say the same thing twice", () => {
    const said = explainDirectFailure("Grok Build is not signed in. Sign in to it in a terminal, then try again.", "Grok Build");
    expect(said.match(/not signed in/gi)).toHaveLength(1);
  });

  it("leaves a failure it has no advice for exactly as the CLI put it", () => {
    expect(explainDirectFailure("disk is on fire", "Grok Build")).toBe("disk is on fire");
  });

  it("still says something when the CLI said nothing at all", () => {
    expect(explainDirectFailure("", "Grok Build")).toMatch(/Grok Build/);
  });
});
