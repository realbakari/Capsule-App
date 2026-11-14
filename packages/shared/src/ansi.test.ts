import { describe, expect, it } from "vitest";

import { ansiToSegments } from "./ansi.js";

const E = "\u001b";
const sgr = (codes: string) => `${E}[${codes}m`;

describe("ansiToSegments", () => {
  it("returns plain text as one segment and nothing for empty output", () => {
    expect(ansiToSegments("main · 3 files\n")).toEqual([[{ text: "main · 3 files" }]]);
    expect(ansiToSegments("")).toEqual([]);
    expect(ansiToSegments("\n\n")).toEqual([]);
  });

  it("turns on and off bold, dim, italic and underline", () => {
    expect(ansiToSegments(`${sgr("1")}a${sgr("2")}b${sgr("22")}c${sgr("3;4")}d${sgr("23")}e${sgr("24")}f`)).toEqual([
      [
        { text: "a", bold: true },
        { text: "b", bold: true, dim: true },
        { text: "c" },
        { text: "d", italic: true, underline: true },
        { text: "e", underline: true },
        { text: "f" },
      ],
    ]);
  });

  it("names the 16 colours so they follow the theme", () => {
    expect(ansiToSegments(`${sgr("31")}r${sgr("92;44")}g${sgr("39")}x${sgr("101")}y${sgr("0")}z`)).toEqual([
      [
        { text: "r", fg: "red" },
        { text: "g", fg: "bright-green", bg: "blue" },
        { text: "x", bg: "blue" },
        { text: "y", bg: "bright-red" },
        { text: "z" },
      ],
    ]);
  });

  it("gives 256-colour and truecolour as hex", () => {
    expect(ansiToSegments(`${sgr("38;5;208")}a${sgr("38;5;244")}b${sgr("38;5;9")}c${sgr("38;2;18;52;86;48;2;255;255;255")}d`)).toEqual([
      [
        { text: "a", fg: "#ff8700" },
        { text: "b", fg: "#808080" },
        { text: "c", fg: "bright-red" },
        { text: "d", fg: "#123456", bg: "#ffffff" },
      ],
    ]);
    expect(ansiToSegments(`${sgr("38:2::1:2:3")}e${sgr("38:5:21")}f`)).toEqual([[{ text: "e", fg: "#010203" }, { text: "f", fg: "#0000ff" }]]);
  });

  it("treats an empty SGR as a reset and ignores codes it does not know", () => {
    expect(ansiToSegments(`${sgr("1;31")}a${E}[mb${sgr("5;7")}c`)).toEqual([[{ text: "a", bold: true, fg: "red" }, { text: "bc" }]]);
  });

  it("keeps a hyperlink's text and drops its target", () => {
    const link = `${E}]8;;https://example.com/pr/1${E}\\#1${E}]8;;${E}\\`;
    expect(ansiToSegments(`PR ${link} open`)).toEqual([[{ text: "PR #1 open" }]]);
    expect(ansiToSegments(`${E}]0;window title\u0007ok`)).toEqual([[{ text: "ok" }]]);
  });

  it("drops cursor movement, erase, charset and other escapes", () => {
    expect(ansiToSegments(`${E}[2K${E}[1A${E}[?25l${E}(B${E}7a${E}Pdevice${E}\\b\u0007\u0008c`)).toEqual([[{ text: "abc" }]]);
  });

  it("never lets markup or control characters through as anything but text", () => {
    const [line] = ansiToSegments("<b>x</b>\u0000‮evil\r");
    expect(line).toEqual([{ text: "<b>x</b>evil" }]);
  });

  it("keeps style across lines and stops at the line limit", () => {
    expect(ansiToSegments(`${sgr("32")}one\ntwo\nthree`)).toEqual([[{ text: "one", fg: "green" }], [{ text: "two", fg: "green" }]]);
    expect(ansiToSegments("a\nb\nc", 3)).toHaveLength(3);
    expect(ansiToSegments("a\r\nb")).toEqual([[{ text: "a" }], [{ text: "b" }]]);
  });

  it("trims each line to 400 characters", () => {
    const [first, second] = ansiToSegments(`${"x".repeat(300)}${sgr("1")}${"y".repeat(300)}\nshort`);
    expect(first!.map((s) => s.text.length)).toEqual([300, 100]);
    expect(second).toEqual([{ text: "short", bold: true }]);
  });
});
