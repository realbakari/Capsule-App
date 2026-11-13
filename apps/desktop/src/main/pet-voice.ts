import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { attentionLabel, DICTATION_SETTINGS_PANES, type AttentionSummary, type DictationEvent, type DictationOutcome, type DictationSettingsPane, type PetVoiceStatus } from "@capsule/shared";

type Launch = (file: string, args: string[]) => ChildProcessWithoutNullStreams;
const launch: Launch = (file, args) => spawn(file, args, { stdio: "pipe" });
type Operation = { child: ChildProcessWithoutNullStreams; cancel: () => void };
/** Who holds the microphone. The companion and the composer share one helper and one microphone. */
export type VoiceOwner = "companion" | "dictation";
type Mode = "--check" | "--listen" | "--dictate";

class VoiceError extends Error {
  constructor(message: string, readonly settings?: DictationSettingsPane) { super(message); }
}

const DICTATION_TEXT_LIMIT = 8000;

/** Owns the short-lived OS speech processes for the companion and composer dictation. */
export class PetVoice {
  private input?: Operation & { owner: VoiceOwner };
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
    return this.capture("--listen", event => { if (event.phase === "listening") onListening(); });
  }

  /** Free-text dictation for the composer. Partial text streams through `onEvent`; nothing is kept here. */
  async dictate(onEvent: (event: DictationEvent) => void): Promise<DictationOutcome> {
    if (this.platform !== "darwin") return { kind: "error", message: "Dictation runs on macOS." };
    if (!existsSync(this.helper)) return { kind: "error", message: "The speech helper is missing. Rebuild or reinstall Capsule." };
    if (this.input) return { kind: "error", message: this.input.owner === "companion" ? "The companion is listening. Try again when it finishes." : "Dictation is already running." };
    this.output?.cancel();
    try {
      const text = await this.capture("--dictate", onEvent);
      return text === undefined ? { kind: "cancelled" } : { kind: "text", text };
    } catch (error) {
      return { kind: "error", message: error instanceof Error ? error.message : "Dictation stopped unexpectedly.", ...(error instanceof VoiceError && error.settings ? { settings: error.settings } : {}) };
    }
  }

  finish(owner: VoiceOwner): void { if (this.input?.owner === owner) this.input.child.stdin.write("finish\n"); }
  /** Cancels one owner's capture, or every voice process when no owner is named. */
  cancel(owner?: VoiceOwner): void {
    if (!owner || this.input?.owner === owner) this.input?.cancel();
    if (owner !== "dictation") this.output?.cancel();
  }

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

  private capture(mode: Mode, onEvent?: (event: DictationEvent) => void): Promise<string | undefined> {
    if (this.input) return Promise.reject(new Error("A voice request is already active."));
    const dictating = mode === "--dictate";
    const textLimit = dictating ? DICTATION_TEXT_LIMIT : 256;
    return new Promise((resolve, reject) => {
      const child = this.start(this.helper, [mode]);
      let buffer = "", bytes = 0, listening = false, result: string | undefined, error: Error | undefined, completed = false, cancelled = false;
      const operation = { child, owner: dictating ? "dictation" as const : "companion" as const, cancel: () => { cancelled = true; stop(child); } };
      this.input = operation;
      const fail = (message: string) => { error = new Error(message); stop(child); };
      // The helper ends dictation itself at its two-minute cap; this only catches a stuck helper.
      const timer = setTimeout(() => fail("Voice input timed out. Try again."), mode === "--check" ? 5000 : dictating ? 150_000 : 45_000);
      child.stdin.on("error", () => { /* The helper can finish before the release event. */ });
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        bytes += Buffer.byteLength(chunk);
        if (!dictating && bytes > 4096) { fail("Invalid voice helper response."); return; }
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try {
            const value: unknown = JSON.parse(line);
            if (!value || typeof value !== "object" || !("type" in value)) throw new Error();
            if (value.type === "listening" && mode !== "--check") {
              listening = true;
              onEvent?.({ phase: "listening", limitMs: "limitMs" in value && typeof value.limitMs === "number" ? value.limitMs : 10_000 });
            }
            else if (value.type === "partial" && dictating && "text" in value && typeof value.text === "string" && value.text.length <= textLimit) onEvent?.({ phase: "partial", text: value.text });
            else if (value.type === "level" && dictating && "value" in value && typeof value.value === "number") onEvent?.({ phase: "level", value: Math.min(1, Math.max(0, value.value)) });
            else if (value.type === "capability" && mode === "--check" && "available" in value && typeof value.available === "boolean") { result = value.available ? "available" : undefined; completed = true; }
            else if (value.type === "result" && mode !== "--check" && "text" in value && typeof value.text === "string" && value.text.length <= textLimit) { result = value.text; completed = true; }
            else if (value.type === "cancelled") { cancelled = true; completed = true; }
            else if (value.type === "error" && "message" in value && typeof value.message === "string" && value.message.length <= 256) {
              const settings = "settings" in value ? DICTATION_SETTINGS_PANES.find(pane => pane === value.settings) : undefined;
              error = new VoiceError(value.message, settings); completed = true;
            }
            else throw new Error();
          } catch { fail("Invalid voice helper response."); }
        }
        // Dictation repeats the whole transcript on every refinement, so bound a line, not the stream.
        if (dictating && buffer.length > 4 * DICTATION_TEXT_LIMIT) fail("Invalid voice helper response.");
      });
      child.stderr.resume(); // Never persist microphone output or transcripts.
      child.on("error", () => { error = new Error(dictating ? "Could not start dictation." : "Could not start companion voice."); });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (this.input === operation) this.input = undefined;
        if (cancelled) resolve(undefined);
        else if (error) reject(error);
        // macOS aborts a process that asks for speech access from an app without a usage description.
        else if (dictating && signal === "SIGABRT" && !listening) reject(new VoiceError("macOS stopped speech recognition for this copy of Capsule. Allow Speech Recognition in Privacy & Security settings, or dictate from the installed app.", "speech"));
        else if (code !== 0 || !completed) reject(new Error(dictating ? "Dictation stopped unexpectedly." : "Companion voice stopped unexpectedly."));
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
