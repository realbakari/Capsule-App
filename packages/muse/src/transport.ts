import { Connection } from "@muse-code/sdk";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { spawnCommand, stopChild } from "@capsule/process";
import type { DirectAcpOptions } from "@capsule/acp";

/** Official MSP framing on Capsule's cross-platform, owned child-process transport. */
export function openMuseTransport(options: DirectAcpOptions, onExit: (error: Error, code: number | null) => void) {
  const child = spawnCommand(options.command, options.args, {
    cwd: options.cwd, env: options.env ?? process.env,
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
  }) as ChildProcessWithoutNullStreams;
  child.stdout.setEncoding("utf8");
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr = (stderr + chunk.toString("utf8")).slice(-4096); });
  // Never publish raw stderr: it can contain credentials or terminal escapes.
  const failure = (code: number | null) => new Error(code === 5
    ? "This Muse build does not enable its session SDK. Install a build with muse serve support."
    : /auth|login|sign.in|credential/i.test(stderr)
      ? "Muse needs authentication. Sign in with the Muse CLI in a terminal, then try again."
      : "Muse stopped before the session finished. Check its installation and sign-in, then retry.");
  let ended = false;
  let pipesClosed = false;
  let closing: Promise<void> | undefined;
  let resolveExit!: () => void;
  const exited = new Promise<void>((resolve) => { resolveExit = resolve; });
  const end = (error: Error, code: number | null) => {
    if (ended) return;
    ended = true;
    onExit(error, code);
  };
  child.on("error", () => end(new Error("Could not start Muse. Install its CLI and make muse available on PATH."), null));
  // A tool may inherit the pipes after the leader exits. Do not leave the
  // current turn waiting for EOF from a process that can no longer answer.
  child.on("exit", (code) => end(failure(code), code));
  child.on("close", (code) => {
    pipesClosed = true;
    resolveExit();
    end(failure(code), code);
  });
  child.stdin.on("error", () => {});
  const close = () => closing ??= (async () => {
    child.stdin.end();
    stopChild(child, "SIGTERM", true);
    const waitForExit = async (milliseconds: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([exited, new Promise<void>((resolve) => { timer = setTimeout(resolve, milliseconds); })]);
      } finally { clearTimeout(timer); }
    };
    try {
      await waitForExit(500);
      if (!pipesClosed) {
        stopChild(child, "SIGKILL", true);
        await waitForExit(3000);
      }
      if (!ended) throw new Error("Muse has not confirmed process exit. Check its running tools before restarting it.");
    } finally {
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdin.destroy();
    }
  })();
  const connection = new Connection({
    incoming: child.stdout as AsyncIterable<string>,
    write: (frame) => new Promise<void>((resolve, reject) => {
      child.stdin.write(frame, (error) => error ? reject(error) : resolve());
    }),
    close,
  }, { frameLimitBytes: 4 * 1024 * 1024 });
  return { connection, close: () => connection.close() };
}
