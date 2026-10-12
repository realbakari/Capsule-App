import { spawn, type ChildProcess } from "node:child_process";
import { stopChild } from "@capsule/process";
import { assertUdid } from "./simctl.js";

/**
 * Screen recording through `simctl io recordVideo`. The recorder is a child
 * this process owns until Stop sends it an interrupt, which is how `simctl`
 * finishes the file. One recording per device.
 */

interface Recording {
  child: ChildProcess;
  file: string;
  startedAt: number;
  exited: Promise<number | null>;
}

const recordings = new Map<string, Recording>();

export function isRecording(udid: string): boolean {
  return recordings.has(udid);
}

export function startRecording(udid: string, file: string): void {
  const id = assertUdid(udid);
  if (recordings.has(id)) throw new Error("This simulator is already being recorded.");
  const child = spawn("xcrun", ["simctl", "io", id, "recordVideo", "--codec=h264", "--force", file], { stdio: "ignore" });
  const exited = new Promise<number | null>((resolve) => { child.on("exit", (code) => resolve(code)); child.on("error", () => resolve(null)); });
  recordings.set(id, { child, file, startedAt: Date.now(), exited });
  void exited.then(() => { if (recordings.get(id)?.child === child) recordings.delete(id); });
}

/** Resolves with the file once `simctl` has finished writing it. */
export async function stopRecording(udid: string): Promise<string> {
  const id = assertUdid(udid);
  const recording = recordings.get(id);
  if (!recording) throw new Error("This simulator is not being recorded.");
  recordings.delete(id);
  stopChild(recording.child, "SIGINT");
  const timer = setTimeout(() => stopChild(recording.child, "SIGKILL"), 15_000);
  await recording.exited;
  clearTimeout(timer);
  return recording.file;
}

export function stopAllRecordings(): void {
  for (const udid of [...recordings.keys()]) void stopRecording(udid).catch(() => undefined);
}
