import { describe, expect, it } from "vitest";

import {
  chooseOption,
  encodeMessage,
  parseMessage,
  readPermissionRequest,
  readSessionUpdate,
  readStopReason,
  splitLines,
} from "./protocol.js";

describe("parseMessage", () => {
  it("reads a JSON-RPC line", () => {
    expect(parseMessage('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}')).toEqual({
      jsonrpc: "2.0",
      id: 1,
      result: { ok: true },
    });
  });

  it("ignores the banners and warnings agents print to stdout", () => {
    // A line that is not a message is not an error; treating it as one would
    // make every chatty CLI unusable.
    expect(parseMessage("Welcome to the CLI!")).toBeUndefined();
    expect(parseMessage("")).toBeUndefined();
    expect(parseMessage("{ not json")).toBeUndefined();
  });

  it("ignores JSON that is not this protocol", () => {
    expect(parseMessage('{"hello":"world"}')).toBeUndefined();
  });
});

describe("splitLines", () => {
  it("keeps a half-written message for the next chunk", () => {
    // A write can land mid-message. Parsing the tail would drop a whole reply.
    const { lines, rest } = splitLines('{"a":1}\n{"b":2}\n{"c":');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    expect(rest).toBe('{"c":');
  });

  it("has nothing left over when the chunk ends cleanly", () => {
    expect(splitLines('{"a":1}\n')).toEqual({ lines: ['{"a":1}'], rest: "" });
  });
});

describe("encodeMessage", () => {
  it("ends every message with the newline the agent reads on", () => {
    expect(encodeMessage({ jsonrpc: "2.0", id: 1, method: "initialize" })).toBe(
      '{"jsonrpc":"2.0","id":1,"method":"initialize"}\n',
    );
  });
});

describe("readSessionUpdate", () => {
  it("lifts assistant text", () => {
    expect(
      readSessionUpdate({
        sessionId: "s1",
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hi" } },
      }),
    ).toEqual({ sessionId: "s1", text: "Hi", thought: false });
  });

  it("marks reasoning as reasoning", () => {
    // Thoughts stream to the reader but are not the answer, so they must not
    // be folded into the message the turn produced.
    expect(
      readSessionUpdate({
        sessionId: "s1",
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } },
      })?.thought,
    ).toBe(true);
  });

  it("lifts a tool call for the work log", () => {
    expect(
      readSessionUpdate({
        update: { sessionUpdate: "tool_call", title: "Read package.json", status: "in_progress" },
      }),
    ).toEqual({ sessionId: undefined, tool: { title: "Read package.json", status: "in_progress" } });
  });

  it("says nothing about updates a reader never sees", () => {
    expect(readSessionUpdate({ update: { sessionUpdate: "plan" } })).toBeUndefined();
    expect(readSessionUpdate(undefined)).toBeUndefined();
  });
});

describe("readStopReason", () => {
  it("reads how the turn ended", () => {
    expect(readStopReason({ stopReason: "end_turn" })).toBe("end_turn");
    expect(readStopReason({})).toBeUndefined();
  });
});

describe("readPermissionRequest", () => {
  it("reads what is being asked and what may be answered", () => {
    expect(
      readPermissionRequest({
        sessionId: "s1",
        toolCall: { title: "Write src/index.ts" },
        options: [
          { optionId: "a", name: "Allow", kind: "allow_once" },
          { optionId: "r", name: "Reject", kind: "reject_once" },
        ],
      }),
    ).toEqual({
      sessionId: "s1",
      title: "Write src/index.ts",
      options: [
        { optionId: "a", name: "Allow", kind: "allow_once" },
        { optionId: "r", name: "Reject", kind: "reject_once" },
      ],
    });
  });

  it("refuses a request with no answerable options", () => {
    // The agent blocks on the reply, so a request we cannot read has to be
    // recognised as unreadable rather than half-answered.
    expect(readPermissionRequest({ options: [] })).toBeUndefined();
    expect(readPermissionRequest({ options: [{ name: "Allow" }] })).toBeUndefined();
  });
});

describe("chooseOption", () => {
  const options = [
    { optionId: "a", name: "Yes, allow", kind: "allow_once" },
    { optionId: "always", name: "Always allow", kind: "allow_always" },
    { optionId: "r", name: "No", kind: "reject_once" },
  ];

  it("goes by kind, which the protocol defines", () => {
    expect(chooseOption(options, "allow")).toBe("a");
    expect(chooseOption(options, "deny")).toBe("r");
  });

  it("falls back to the name when an agent ships no kinds", () => {
    const named = [
      { optionId: "1", name: "Approve" },
      { optionId: "2", name: "Deny" },
    ];
    expect(chooseOption(named, "allow")).toBe("1");
    expect(chooseOption(named, "deny")).toBe("2");
  });

  it("never returns nothing when there is something to pick", () => {
    // Answering the wrong option is recoverable; answering nothing hangs the turn.
    expect(chooseOption([{ optionId: "only", name: "Proceed" }], "deny")).toBe("only");
  });
});
