import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { attentionLabel, type AttentionSummary, type PetVoiceStatus } from "@capsule/shared";

type Launch = (file: string, args: string[]) => ChildProcessWithoutNullStreams;
const launch: Launch = (file, args) => spawn(file, args, { stdio: "pipe" });
type Operation = { child: ChildProcessWithoutNullStreams; cancel: () => void };

/** Owns only the companion's short-lived OS speech processes. */
export class PetVoice {
  private input?: Operation;
  private output?: Operation;
  constructor(private readonly helper: string, private readonly platform = process.platform, private readonly start: Launch = launch) {}

  async status(): Promise<PetVoiceStatus> {
    if (this.platform !== "darwin") return { inputAvailable: false, outputAvailable: false, detail: "Companion voice is available on macOS." };
    if (!existsSync(this.helper)) return { inputAvailable: false, outputAvailable: true, detail: "The companion voice helper is missing. Rebuild or reinstall Capsule." };
    try {
      const result = await this.capture("--check");
      const available = result === "available";
      return { inputAvailable: available, outputAvailable: true, ...(!available ? { detail: "On-device English recognition is unavailable. Check Dictation languages in macOS Keyboard settings." } : {}) };
    } catch {
      return { inputAvailable: false, outputAvailable: true, detail: "Could not check on-device speech recognition." };
    }
  }

  listen(onListening: () => void): Promise<string | undefined> {
    if (this.platform !== "darwin") return Promise.reject(new Error("Companion voice input requires macOS."));
    if (this.input) return Promise.reject(new Error("A voice request is already active."));
    this.output?.cancel();
    return this.capture("--listen", onListening);
  }

  finish(): void { this.input?.child.stdin.write("finish\n"); }
  cancel(): void { this.input?.cancel(); this.output?.cancel(); }

  speak(summary: AttentionSummary): Promise<void> {
    if (this.platform !== "darwin") return Promise.reject(new Error("Spoken status requires macOS."));
    if (this.input) return Promise.reject(new Error("Finish the voice command before reading status."));
    this.output?.cancel();
    // No message contents, project paths, or user-supplied speech arguments.
    const text = attentionLabel(summary)?.replaceAll(" · ", ". ") ?? "Nothing waiting in your workspace.";
    return new Promise((resolve, reject) => {
      const child = this.start("/usr/bin/say", [text]);
      let cancelled = false;
      const operation: Operation = { child, cancel: () => { cancelled = true; stop(child); } };
      this.output = operation;
      const timer = setTimeout(() => { cancelled = true; stop(child); }, 20_000);
      child.on("error", () => reject(new Error("Could not read workspace status.")));
      child.on("close", code => {
        clearTimeout(timer);
        if (this.output === operation) this.output = undefined;
        if (code === 0 || cancelled) resolve(); else reject(new Error("Could not read workspace status."));
      });
      child.stdout.resume(); child.stderr.resume();
      child.stdin.end();
    });
  }

  private capture(mode: "--check" | "--listen", onListening?: () => void): Promise<string | undefined> {
    if (this.input) return Promise.reject(new Error("A voice request is already active."));
    return new Promise((resolve, reject) => {
      const child = this.start(this.helper, [mode]);
      let buffer = "", bytes = 0, result: string | undefined, error: Error | undefined, completed = false, cancelled = false;
      const operation: Operation = { child, cancel: () => { cancelled = true; stop(child); } };
      this.input = operation;
      const fail = (message: string) => { error = new Error(message); stop(child); };
      const timer = setTimeout(() => fail("Voice input timed out. Try again."), mode === "--check" ? 5000 : 45_000);
      child.stdin.on("error", () => { /* The helper can finish before the release event. */ });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4096) { fail("Invalid voice helper response."); return; }
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const value: unknown = JSON.parse(line);
            if (!value || typeof value !== "object" || !("type" in value)) throw new Error();
            if (value.type === "listening" && mode === "--listen") onListening?.();
            else if (value.type === "capability" && mode === "--check" && "available" in value && typeof value.available === "boolean") { result = value.available ? "available" : undefined; completed = true; }
            else if (value.type === "result" && mode === "--listen" && "text" in value && typeof value.text === "string" && value.text.length <= 256) { result = value.text; completed = true; }
            else if (value.type === "cancelled") { cancelled = true; completed = true; }
            else if (value.type === "error" && "message" in value && typeof value.message === "string" && value.message.length <= 256) { error = new Error(value.message); completed = true; }
            else throw new Error();
          } catch { fail("Invalid voice helper response."); }
        }
      });
      child.stderr.resume(); // Never persist microphone output or transcripts.
      child.on("error", () => { error = new Error("Could not start companion voice."); });
      child.on("close", code => {
        clearTimeout(timer);
        if (this.input === operation) this.input = undefined;
        if (cancelled) resolve(undefined);
        else if (error) reject(error);
        else if (code !== 0 || !completed) reject(new Error("Companion voice stopped unexpectedly."));
        else resolve(result);
      });
    });
  }
}

function stop(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }, 1000);
  timer.unref();
  child.once("close", () => clearTimeout(timer));
}
