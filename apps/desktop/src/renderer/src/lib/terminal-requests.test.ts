import { describe, expect, it } from "vitest";
import { onTerminalCommand, requestTerminalCommand, takeTerminalCommand } from "./terminal-requests";

describe("terminal requests", () => {
  it("keeps a command for the dock that opens because of it, and hands it out once", () => {
    requestTerminalCommand("codex login");
    expect(takeTerminalCommand()).toBe("codex login");
    expect(takeTerminalCommand()).toBeUndefined();
  });
  it("gives a command to a dock on screen, and keeps it when that dock is still starting", () => {
    const seen: string[] = [];
    let ready = false;
    const off = onTerminalCommand((command) => { if (!ready) return false; seen.push(command); return true; });
    requestTerminalCommand("claude auth login");
    expect(seen).toEqual([]);
    expect(takeTerminalCommand()).toBe("claude auth login");
    ready = true;
    requestTerminalCommand("codex login");
    expect(seen).toEqual(["codex login"]);
    expect(takeTerminalCommand()).toBeUndefined();
    off();
  });
});
