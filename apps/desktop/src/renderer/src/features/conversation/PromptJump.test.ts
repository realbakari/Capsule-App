import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ChatMessage } from "@capsule/shared";
import { PromptJump } from "./PromptJump";

const prompt = (id: string, content: string): ChatMessage => ({ id, sessionId: "s", role: "user", content, createdAt: "2026-11-14T00:00:00.000Z" });
const props = { open: true, hasOlder: false, loadingOlder: false, onLoadOlder: () => {}, onOpenChange: () => {}, onLocate: () => {} };

describe("PromptJump", () => {
  it("draws nothing until the shortcut or palette opens it", () => {
    expect(renderToStaticMarkup(createElement(PromptJump, { ...props, open: false, messages: [prompt("a", "First ask"), prompt("b", "Second ask")] }))).toBe("");
  });

  it("lists prompts newest first with the first one active", () => {
    const html = renderToStaticMarkup(createElement(PromptJump, { ...props, messages: [prompt("a", "First ask"), prompt("b", "Second ask")] }));
    expect(html).toContain('role="dialog" aria-label="Jump to a prompt"');
    expect(html.indexOf("Second ask")).toBeLessThan(html.indexOf("First ask"));
    expect(html).toMatch(/aria-selected="true"[^>]*>.*?Second ask/u);
  });

  it("offers to load earlier prompts when history is cut", () => {
    const html = renderToStaticMarkup(createElement(PromptJump, { ...props, hasOlder: true, messages: [prompt("a", "Recent")] }));
    expect(html).toContain("Load earlier prompts");
  });
});
