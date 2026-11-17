import { describe, expect, it } from "vitest";
import { actionTabCandidates, actionTabLabel, onTerminalCommand, requestTerminalCommand, takeTerminalCommand, terminalInput } from "./terminal-requests";

describe("terminal requests", () => {
  it("keeps a command for the dock that opens because of it, and hands it out once", () => {
    requestTerminalCommand({ kind: "type", command: "codex login" });
    expect(takeTerminalCommand()).toEqual({ kind: "type", command: "codex login" });
    expect(takeTerminalCommand()).toBeUndefined();
  });
  it("gives a command to a dock on screen, and keeps it when that dock is still starting", () => {
    const seen: string[] = [];
    let ready = false;
    const off = onTerminalCommand((request) => { if (!ready) return false; seen.push(request.command); return true; });
    requestTerminalCommand({ kind: "type", command: "claude auth login" });
    expect(seen).toEqual([]);
    expect(takeTerminalCommand()?.command).toBe("claude auth login");
    ready = true;
    requestTerminalCommand({ kind: "run", command: "pnpm dev", tab: { key: "p:dev", label: "dev" } });
    expect(seen).toEqual(["pnpm dev"]);
    expect(takeTerminalCommand()).toBeUndefined();
    off();
  });
  it("leaves a typed command for Return, and runs an action over a cleared prompt", () => {
    expect(terminalInput({ kind: "type", command: "codex login" })).toBe("codex login");
    expect(terminalInput({ kind: "run", command: "pnpm dev", tab: { key: "p:dev", label: "dev" } })).toBe("\x15pnpm dev\r");
  });
});

describe("action tabs", () => {
  const cwd = "/work/app";
  it("offers only the action's own live tabs in the dock's folder, the one on screen first", () => {
    const tabs = [
      { id: "plain" },
      { id: "dev-a", action: "p:dev" },
      { id: "test", action: "p:test" },
      { id: "dev-exited", action: "p:dev", exitCode: 1 },
      { id: "dev-moved", action: "p:dev", folder: "/elsewhere" },
      { id: "dev-b", action: "p:dev", folder: cwd },
    ];
    expect(actionTabCandidates(tabs, "p:dev", "plain", cwd)).toEqual(["dev-a", "dev-b"]);
    expect(actionTabCandidates(tabs, "p:dev", "dev-b", cwd)).toEqual(["dev-b", "dev-a"]);
    expect(actionTabCandidates(tabs, "p:lint", "dev-a", cwd)).toEqual([]);
  });
  it("names a tab after its action, numbering a second one", () => {
    expect(actionTabLabel("dev", ["Terminal 1"])).toBe("dev");
    expect(actionTabLabel("dev", ["dev"])).toBe("dev 2");
    expect(actionTabLabel("dev", ["dev", "dev 2"])).toBe("dev 3");
  });
});
