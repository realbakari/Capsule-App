import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DirectAcpSession } from "./session.js";

/*
 * A stand-in agent, so the client is exercised end to end without needing a
 * signed-in CLI. It speaks the same protocol a real one does: JSON-RPC lines
 * on stdin and stdout, an initialize handshake, a session, and a turn that
 * streams before it finishes.
 */
function fakeAgent(body: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "acp-agent-"));
  const file = path.join(dir, "agent.mjs");
  writeFileSync(
    file,
    `let buffered = "";
     const send = (message) => process.stdout.write(JSON.stringify(message) + "\\n");
     process.stdin.on("data", (chunk) => {
       buffered += chunk.toString();
       const parts = buffered.split("\\n");
       buffered = parts.pop() ?? "";
       for (const line of parts) {
         if (!line.trim()) continue;
         const message = JSON.parse(line);
         handle(message);
       }
     });
     ${body}
    `,
  );
  return file;
}

const HAPPY = `
  function handle(message) {
    if (message.method === "initialize") {
      send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
      return;
    }
    if (message.method === "session/new") {
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "sess-1" } });
      return;
    }
    if (message.method === "session/prompt") {
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "thinking" } } } });
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "tool_call", title: "Read README.md", status: "in_progress" } } });
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } } } });
      send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "sess-1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } } } });
      send({ jsonrpc: "2.0", id: message.id, result: { stopReason: "end_turn" } });
    }
  }
`;

describe("talking to an agent directly", () => {
  it("keeps a whitespace-containing cwd intact in both process spawn and session/new", async () => {
    const cwd = mkdtempSync(path.join(tmpdir(), "capsule working folder-"));
    const agent = fakeAgent(`
      function handle(message) {
        if (message.method === "initialize") {
          send({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: 1 } });
        } else if (message.method === "session/new") {
          send({ jsonrpc: "2.0", id: message.id, result: {
            sessionId: JSON.stringify({ cwd: process.cwd(), received: message.params.cwd })
          } });
        }
      }
    `);
    const session = new DirectAcpSession({ command: "node", args: [agent], cwd });
    try {
      const opened = JSON.parse(await session.start()) as { cwd: string; received: string };
      expect(realpathSync(opened.cwd)).toBe(realpathSync(cwd));
      expect(opened.received).toBe(cwd);
    } finally {
      await session.close();
      rmSync(cwd, { recursive: true, force: true });
      rmSync(path.dirname(agent), { recursive: true, force: true });
    }
  });

  it("handshakes, opens a session, and streams a turn", async () => {
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(HAPPY)] });
    const text: string[] = [];
    const thoughts: string[] = [];
    const tools: string[] = [];
    session.on("text", ({ text: chunk, thought }) =>
      (thought ? thoughts : text).push(chunk),
    );
    session.on("tool", ({ title }) => tools.push(title));

    expect(await session.start()).toBe("sess-1");
    const { stopReason } = await session.prompt("hi");

    expect(text.join("")).toBe("Hello world");
    // Reasoning arrives separately from the answer, and stays separate.
    expect(thoughts).toEqual(["thinking"]);
    expect(tools).toEqual(["Read README.md"]);
    expect(stopReason).toBe("end_turn");
    await session.close();
  });

  it("carries a message split across two writes", async () => {
    // A write can land mid-line. The client has to hold the tail rather than
    // parse it and drop a reply.
    const split = `
      function handle(message) {
        if (message.method === "initialize") {
          send({ jsonrpc: "2.0", id: message.id, result: {} });
          return;
        }
        if (message.method === "session/new") {
          const whole = JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { sessionId: "sess-2" } });
          process.stdout.write(whole.slice(0, 12));
          setTimeout(() => process.stdout.write(whole.slice(12) + "\\n"), 20);
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(split)] });
    expect(await session.start()).toBe("sess-2");
    await session.close();
  });

  it("answers a permission request rather than leaving the turn hanging", async () => {
    const asks = `
      function handle(message) {
        if (message.method === "initialize") { send({ jsonrpc: "2.0", id: message.id, result: {} }); return; }
        if (message.method === "session/new") { send({ jsonrpc: "2.0", id: message.id, result: { sessionId: "s" } }); return; }
        if (message.method === "session/prompt") {
          globalThis.turnId = message.id;
          send({ jsonrpc: "2.0", id: 99, method: "session/request_permission", params: {
            sessionId: "s", toolCall: { title: "Delete everything" },
            options: [{ optionId: "a", name: "Allow", kind: "allow_once" },
                      { optionId: "r", name: "Reject", kind: "reject_once" }] } });
          return;
        }
        if (message.id === 99) {
          send({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s",
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: message.result.outcome.optionId } } } });
          send({ jsonrpc: "2.0", id: globalThis.turnId, result: { stopReason: "end_turn" } });
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(asks)] });
    const chunks: string[] = [];
    session.on("text", ({ text }) => chunks.push(text));
    session.on("permission", ({ title, deny }) => {
      expect(title).toBe("Delete everything");
      deny();
    });
    await session.start();
    await session.prompt("go");
    // The agent was told which option, and it was the refusal.
    expect(chunks.join("")).toBe("r");
    await session.close();
  });

  it("reports what the agent said on the way out", async () => {
    // A CLI that refuses to start explains itself on stderr, and that sentence
    // is the whole answer to "why did this fail".
    const dies = `
      function handle(message) {
        if (message.method === "initialize") {
          process.stderr.write("Not signed in. Set GEMINI_API_KEY.\\n");
          process.exit(3);
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(dies)] });
    await expect(session.start()).rejects.toThrow(/Not signed in/);
  });

  it("refuses a request it never offered to serve, rather than ignoring it", async () => {
    // An unanswered request is a hung turn, so even "no" has to be sent.
    const readsFiles = `
      function handle(message) {
        if (message.method === "initialize") { send({ jsonrpc: "2.0", id: message.id, result: {} }); return; }
        if (message.method === "session/new") {
          send({ jsonrpc: "2.0", id: 7, method: "fs/read_text_file", params: { path: "/etc/passwd" } });
          globalThis.newId = message.id;
          return;
        }
        if (message.id === 7) {
          send({ jsonrpc: "2.0", id: globalThis.newId, result: { sessionId: message.error ? "refused" : "served" } });
        }
      }
    `;
    const session = new DirectAcpSession({ command: "node", args: [fakeAgent(readsFiles)] });
    expect(await session.start()).toBe("refused");
    await session.close();
  });
});
