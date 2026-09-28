import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { PetVoice } from "./pet-voice";

const voices: PetVoice[] = [];
function fixture(script: string) {
  const calls: Array<{ file: string; args: string[]; child: ChildProcessWithoutNullStreams }> = [];
  const voice = new PetVoice(process.execPath, "darwin", (file, args) => {
    const child = spawn(process.execPath, ["-e", script], { stdio: "pipe", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
    calls.push({ file, args, child });
    return child;
  });
  voices.push(voice);
  return { voice, calls };
}
afterEach(() => { for (const voice of voices.splice(0)) voice.cancel(); });

describe("companion voice process boundary", () => {
  it("checks availability without requesting microphone access", async () => {
    const { voice, calls } = fixture('console.log(JSON.stringify({type:"capability",available:true}))');
    expect(await voice.status()).toEqual({ inputAvailable: true, outputAvailable: true });
    expect(calls[0]?.args).toEqual(["--check"]);
  });
  it("reports unsupported platforms without starting any process", async () => {
    const voice = new PetVoice("missing", "win32", () => { throw new Error("must not launch"); });
    expect((await voice.status()).inputAvailable).toBe(false);
    await expect(voice.listen(() => {})).rejects.toThrow("macOS");
  });
  it("waits for an explicit finish and returns a single bounded command", async () => {
    const { voice } = fixture('console.log(JSON.stringify({type:"listening"})); process.stdin.once("data", () => { console.log(JSON.stringify({type:"result",text:"Dance."})); process.exit(0); });');
    const result = voice.listen(() => voice.finish());
    await expect(voice.listen(() => {})).rejects.toThrow("already active");
    expect(await result).toBe("Dance.");
  });
  it("cancels capture, discards late text, and releases admission", async () => {
    const { voice, calls } = fixture('process.on("SIGTERM", () => { console.log(JSON.stringify({type:"result",text:"dance"})); process.exit(0); }); console.log(JSON.stringify({type:"listening"})); setInterval(()=>{},1000);');
    expect(await voice.listen(() => voice.cancel())).toBeUndefined();
    expect(calls[0]?.child.exitCode).toBe(0);
    expect(await voice.listen(() => voice.cancel())).toBeUndefined();
  });
  it.each([
    'console.log("not json")',
    'console.log(JSON.stringify({type:"result",text:"a".repeat(257)}))',
    'console.log("a".repeat(4097))',
  ])("rejects malformed and oversized helper output", async script => {
    const { voice } = fixture(script);
    await expect(voice.listen(() => {})).rejects.toThrow("Invalid voice helper response");
  });
  it("reports permission errors without treating them as commands", async () => {
    const { voice } = fixture('console.log(JSON.stringify({type:"error",message:"Allow Microphone access."}))');
    await expect(voice.listen(() => {})).rejects.toThrow("Allow Microphone access");
  });
  it("rejects a helper that exits without a result", async () => {
    const { voice } = fixture('process.exit(0)');
    await expect(voice.listen(() => {})).rejects.toThrow("stopped unexpectedly");
  });
  it("speaks only aggregate status, not thread titles or contents", async () => {
    const { voice, calls } = fixture('process.exit(0)');
    await voice.speak({ state: "ready", counts: { ready: 2, running: 0, blocked: 0, "needs-input": 0 }, items: [{ sessionId: "private", title: "Sensitive title", state: "ready", at: "" }] });
    expect(calls[0]?.file).toBe("/usr/bin/say");
    expect(calls[0]?.args).toEqual(["2 ready"]);
  });
});
