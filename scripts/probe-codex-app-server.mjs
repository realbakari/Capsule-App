import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Read-only compatibility probe: no thread, prompt, login or configuration write.
const child = spawn(process.argv[2] ?? "codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"] });
const send = (message) => child.stdin.write(JSON.stringify(message) + "\n");
let passed = false;
const timeout = setTimeout(() => { console.error("App-server probe timed out."); child.kill("SIGTERM"); }, 15_000);
const force = setTimeout(() => child.kill("SIGKILL"), 18_000);
child.stderr.resume();
child.stdin.on("error", () => {});
child.on("error", (error) => { console.error(error.message); });
child.on("close", () => { clearTimeout(timeout); clearTimeout(force); process.exitCode = passed ? 0 : 1; });
createInterface({ input: child.stdout }).on("line", (line) => {
  try {
    const message = JSON.parse(line);
    if (message.error) { console.error("App-server rejected the compatibility probe."); child.kill("SIGTERM"); return; }
    if (message.id === 1) {
      send({ method: "initialized", params: {} });
      send({ id: 2, method: "model/list", params: { limit: 100 } });
    } else if (message.id === 2) {
      passed = Array.isArray(message.result?.data);
      console.log(passed ? `App-server handshake passed; ${message.result.data.length} model entries reported. No turn was sent.` : "Invalid model catalog.");
      child.stdin.end(); child.kill("SIGTERM");
    }
  } catch { console.error("Invalid app-server response."); child.kill("SIGTERM"); }
});
send({ id: 1, method: "initialize", params: { clientInfo: { name: "capsule", title: "Capsule", version: "0.1.0" } } });
