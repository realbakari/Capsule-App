import { describe, expect, it } from "vitest";
import { parseTable } from "./tables.js";

const lines = (text: string) => text.trim().split("\n");

describe("parseTable", () => {
  it("reads a table with a leading and trailing pipe", () => {
    const result = parseTable(
      lines(`
| Path | What it is |
|------|------------|
| agent-gateway/ | Cloudflare Worker |
| robots.txt | Stopgap robots |
`),
      0,
    )!;
    expect(result.table.headers).toEqual(["Path", "What it is"]);
    expect(result.table.rows).toEqual([
      ["agent-gateway/", "Cloudflare Worker"],
      ["robots.txt", "Stopgap robots"],
    ]);
    expect(result.consumed).toBe(4);
  });

  it("reads a table written without outer pipes", () => {
    const result = parseTable(lines(`
Path | What
--- | ---
a | b
`), 0)!;
    expect(result.table.headers).toEqual(["Path", "What"]);
    expect(result.table.rows).toEqual([["a", "b"]]);
  });

  it("reads column alignment", () => {
    const result = parseTable(lines(`
| L | C | R |
|:--|:-:|--:|
| 1 | 2 | 3 |
`), 0)!;
    expect(result.table.align).toEqual(["left", "center", "right"]);
  });

  it("leaves prose that merely contains a pipe alone", () => {
    expect(parseTable(lines(`
Run a | b to pipe them
and then continue
`), 0)).toBeUndefined();
    expect(parseTable(["| not a table |", "still not one"], 0)).toBeUndefined();
  });

  it("requires as many delimiter cells as headers", () => {
    // Two headers, one delimiter: not a table, and guessing would mangle it.
    expect(parseTable(["| a | b |", "| --- |", "| 1 | 2 |"], 0)).toBeUndefined();
  });

  it("keeps an escaped pipe inside a cell", () => {
    const result = parseTable(["| cmd | note |", "| --- | --- |", String.raw`| a \| b | piped |`], 0)!;
    expect(result.table.rows[0]).toEqual(["a | b", "piped"]);
  });

  it("pads a short row rather than dropping it", () => {
    const result = parseTable(["| a | b | c |", "| --- | --- | --- |", "| 1 |"], 0)!;
    expect(result.table.rows[0]).toEqual(["1", "", ""]);
  });

  it("trims a row longer than the header", () => {
    const result = parseTable(["| a | b |", "| --- | --- |", "| 1 | 2 | 3 |"], 0)!;
    expect(result.table.rows[0]).toEqual(["1", "2"]);
  });

  it("stops at a blank line so following prose is not swallowed", () => {
    const result = parseTable(lines(`
| a |
| --- |
| 1 |

after the table
`), 0)!;
    expect(result.table.rows).toEqual([["1"]]);
    expect(result.consumed).toBe(3);
  });

  it("handles a header-only table with no rows", () => {
    const result = parseTable(["| a | b |", "| --- | --- |"], 0)!;
    expect(result.table.rows).toEqual([]);
  });

  it("finds a table that does not start at the first line", () => {
    const result = parseTable(["intro", "| a |", "| --- |", "| 1 |"], 1)!;
    expect(result.table.headers).toEqual(["a"]);
  });
});
