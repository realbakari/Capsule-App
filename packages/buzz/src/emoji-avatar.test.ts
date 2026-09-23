import { describe, expect, it } from "vitest";
import { emojiAvatar } from "./emoji-avatar.js";
const artwork = (emoji = "😆", color = "#FFE75C", rounded = "") => `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512"${rounded} fill="${color}"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="258">${emoji}</text></svg>`;
const url = (svg: string) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
describe("relay emoji avatars", () => {
  it.each(["😆", "👩🏽‍💻", "🇦🇺", "1️⃣"])("preserves the published emoji and color: %s", (emoji) => {
    expect(emojiAvatar(url(artwork(emoji)))).toEqual({ emoji, color: "#FFE75C" });
    expect(emojiAvatar(url(artwork(emoji, "#FFE75C", ' rx="256"')))).toEqual({ emoji, color: "#FFE75C" });
  });
  it("rejects arbitrary SVG and active or oversized content", () => {
    for (const svg of [artwork("<script>alert(1)</script>"), artwork("&#x1f606;"), artwork("😆", "url(https://example.test)"), artwork().replace("<text", '<text onclick="alert(1)"'), artwork().replace("</svg>", '<image href="file:///etc/passwd"/></svg>'), artwork("😆".repeat(100))]) expect(emojiAvatar(url(svg))).toBeUndefined();
    expect(emojiAvatar("data:image/svg+xml,%zz")).toBeUndefined();
    expect(emojiAvatar("https://example.test/avatar.svg")).toBeUndefined();
  });
});
