import { describe, expect, it } from "vitest";
import { isAcpCancelNotice, isAcpStatusNotice } from "./control-notice.js";

describe("operator cancellation acknowledgement", () => {
  it("recognizes the complete acknowledgement with or without the status icon", () => {
    for (const prefix of ["", "✅ "]) expect(isAcpCancelNotice(`${prefix}Cancel requested for ACP session agent:claude:acp:4e3e0167-f0c1-4648-bfaf-7dd3c571a8e8.`)).toBe(true);
  });
  it("keeps user-facing errors, quoted examples and actual answers", () => {
    for (const text of [undefined, "", "Authentication required", "Cancel requested for your upload.", "The log says: Cancel requested for ACP session agent:claude:acp:abc.", "Cancel requested for ACP session agent:claude:acp:abc.\nHere is your result."]) expect(isAcpCancelNotice(text)).toBe(false);
  });
});

describe("operator status report", () => {
  const status = 'ACP status:\n-----\nsession: agent:claude:acp:abc-123\nbackend: acpx\nstate: idle\nruntimeDetails: {"configOptions":[{"id":"model","currentValue":"opus"}]}';

  it("recognizes complete and whitespace-flattened reports across harnesses", () => {
    for (const harness of ["claude", "codex", "grok", "gemini"]) {
      expect(isAcpStatusNotice(status.replace("agent:claude:", `agent:${harness}:`))).toBe(true);
    }
    expect(isAcpStatusNotice(status.replaceAll("\n", " "))).toBe(true);
  });

  it("preserves actual answers, quoted examples and failures", () => {
    for (const text of [undefined, "", "ACP status: unavailable", "ACP status: authentication required", `Here is what the report means:\n${status}`, `\`\`\`text\n${status}\n\`\`\``, "The backendSessionId=123 identifies the worker."]) {
      expect(isAcpStatusNotice(text)).toBe(false);
    }
  });
});
