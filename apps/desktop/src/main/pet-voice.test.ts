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
    const result = voice.listen(() => voice.finish("companion"));
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
  it("streams dictation partials and returns the final text on finish", async () => {
    const { voice, calls } = fixture(`
      const say = value => console.log(JSON.stringify(value));
      say({type:"listening",limitMs:120000}); say({type:"level",value:4}); say({type:"partial",text:"hello"}); say({type:"partial",text:"Hello there"});
      process.stdin.once("data", () => { say({type:"result",text:"Hello there."}); process.exit(0); });`);
    const events: unknown[] = [];
    const outcome = await voice.dictate(event => { events.push(event); if (event.phase === "partial" && event.text === "Hello there") voice.finish("dictation"); });
    expect(calls[0]?.args).toEqual(["--dictate"]);
    expect(events).toEqual([{ phase: "listening", limitMs: 120000 }, { phase: "level", value: 1 }, { phase: "partial", text: "hello" }, { phase: "partial", text: "Hello there" }]);
    expect(outcome).toEqual({ kind: "text", text: "Hello there." });
  });
  it("accepts dictation far longer than a companion command", async () => {
    const long = "word ".repeat(1000).trim();
    const { voice } = fixture(`for (let i = 1; i <= 40; i++) console.log(JSON.stringify({type:"partial",text:${JSON.stringify(long)}.slice(0, i * 120)})); console.log(JSON.stringify({type:"result",text:${JSON.stringify(long)}}))`);
    expect(await voice.dictate(() => {})).toEqual({ kind: "text", text: long });
  });
  it("rejects a dictation line that never ends, and text past the cap", async () => {
    expect(await fixture('process.stdout.write("a".repeat(40000)); setInterval(()=>{},1000);').voice.dictate(() => {})).toEqual({ kind: "error", message: "Invalid voice helper response." });
    expect(await fixture('console.log(JSON.stringify({type:"result",text:"a".repeat(8001)}))').voice.dictate(() => {})).toEqual({ kind: "error", message: "Invalid voice helper response." });
  });
  it("reports a permission failure with the settings pane that fixes it", async () => {
    const { voice } = fixture('console.log(JSON.stringify({type:"error",message:"Allow Microphone access.",settings:"microphone"}))');
    expect(await voice.dictate(() => {})).toEqual({ kind: "error", message: "Allow Microphone access.", settings: "microphone" });
  });
  it("explains a helper macOS aborted before it could ask for access", async () => {
    const { voice } = fixture('process.kill(process.pid, "SIGABRT")');
    expect(await voice.dictate(() => {})).toMatchObject({ kind: "error", settings: "speech" });
  });
  it("ignores a settings pane it does not know", async () => {
    const { voice } = fixture('console.log(JSON.stringify({type:"error",message:"No.",settings:"../../etc"}))');
    expect(await voice.dictate(() => {})).toEqual({ kind: "error", message: "No." });
  });
  it("cancels dictation without touching the companion, and keeps one microphone owner", async () => {
    const { voice } = fixture('console.log(JSON.stringify({type:"listening",limitMs:120000})); setInterval(()=>{},1000);');
    const dictation = voice.dictate(event => { if (event.phase === "listening") voice.cancel("companion"); });
    await new Promise(resolve => setTimeout(resolve, 300));
    await expect(voice.listen(() => {})).rejects.toThrow("already active");
    voice.cancel("dictation");
    expect(await dictation).toEqual({ kind: "cancelled" });
  });
  it("explains dictation elsewhere without starting a process", async () => {
    const voice = new PetVoice("missing", "linux", () => { throw new Error("must not launch"); });
    expect(await voice.dictate(() => {})).toEqual({ kind: "error", message: "Dictation runs on macOS." });
  });
  it("speaks only aggregate status, not thread titles or contents", async () => {
    const { voice, calls } = fixture('process.exit(0)');
    await voice.speak({ state: "ready", counts: { ready: 2, running: 0, blocked: 0, "needs-input": 0 }, items: [{ sessionId: "private", title: "Sensitive title", state: "ready", at: "" }] });
    expect(calls[0]?.file).toBe("/usr/bin/say");
    expect(calls[0]?.args).toEqual(["2 ready"]);
  });
});
