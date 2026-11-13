import { describe, expect, it } from "vitest";
import type { Token } from "markdown-it";
import { parseMarkdown } from "./markdown";
import { fenceClosed } from "./markdown-math";

function flat(tokens: Token[]): Token[] {
  return tokens.flatMap((token) => [token, ...flat(token.children ?? [])]);
}

const math = (text: string) =>
  flat(parseMarkdown(text).tokens).filter((token) => token.type.startsWith("math_")).map((token) => [token.type, token.content]);

describe("math in replies", () => {
  it("reads inline and display formulas", () => {
    expect(math("Energy is $E = mc^2$.")).toEqual([["math_inline", "E = mc^2"]]);
    expect(math("Area $\\pi r^2$, ratio $\\frac{a}{b}$")).toEqual([["math_inline", "\\pi r^2"], ["math_inline", "\\frac{a}{b}"]]);
    expect(math("$$\\sum_{i=1}^n i$$")).toEqual([["math_block", "\\sum_{i=1}^n i"]]);
    expect(math("Before\n\n$$\na^2 + b^2\n= c^2\n$$\n\nAfter")).toEqual([["math_block", "a^2 + b^2\n= c^2"]]);
    expect(math("Inline display $$x+y$$ here")).toEqual([["math_inline", "x+y"]]);
    expect(math("$2^n$ grows")).toEqual([["math_inline", "2^n"]]);
  });

  it.each([
    "It costs $5 and $10 with tax.",
    "Between $1,000-$2,000 a month.",
    "From $5/$10 tiers.",
    "Prices: $5. Tax is 2$ extra.",
    "Use $HOME/$USER for the path.",
    "Set $PATH:$HOME before running.",
    "echo $A$B prints both.",
    "Variables $a and $b are unset.",
    "Just one $ sign.",
    "A trailing dollar $",
    "Escaped \\$x\\$ stays literal.",
    "Empty $$ $$ pair.",
    "US$5 and US$6",
  ])("leaves %j as prose", (text) => {
    expect(math(text)).toEqual([]);
    expect(flat(parseMarkdown(text).tokens).filter((token) => token.type === "text").map((token) => token.content).join("")).toContain("$");
  });

  it("never reads math inside code", () => {
    expect(math("Run `echo $HOME$` then `price=$5$`.")).toEqual([]);
    expect(math("```bash\necho \"$x$\"\n$$\nnot math\n$$\n```")).toEqual([]);
    expect(math("    $$\n    indented code\n    $$")).toEqual([]);
    expect(math("$a `b$` c")).toEqual([]);
  });

  it("leaves an unclosed display block as text while it streams", () => {
    expect(math("$$\n\\int_0^1 x")).toEqual([]);
    expect(math("$$\n\\int_0^1 x\n$$")).toEqual([["math_block", "\\int_0^1 x"]]);
  });

  it("knows whether a fence has received its closing marker", () => {
    const fence = (text: string) => parseMarkdown(text).tokens.find((token) => token.type === "fence")!;
    expect(fenceClosed(fence("```mermaid\ngraph TD\nA-->B").meta)).toBe(false);
    expect(fenceClosed(fence("```mermaid\ngraph TD\nA-->B\n```").meta)).toBe(true);
    expect(fenceClosed(fence("```mermaid\n```").meta)).toBe(true);
    expect(fenceClosed(fence("```mermaid").meta)).toBe(false);
    expect(fenceClosed(fence("> ```mermaid\n> graph TD\n> ```").meta)).toBe(true);
    expect(fenceClosed(fence("~~~~math\nx\n~~~~\n\nmore").meta)).toBe(true);
    expect(fenceClosed(fence("````\n```\nnested\n```").meta)).toBe(false);
  });
});
