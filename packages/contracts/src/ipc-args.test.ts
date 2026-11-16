import { describe, expect, it } from "vitest";
import {
  IpcArgumentError,
  bool,
  id,
  num,
  oneOf,
  optBool,
  optNum,
  optStr,
  parseArgs,
  payload,
  str,
} from "./ipc-args.js";

/** What the log reads; the message a person sees never names the channel. */
function detailOf(call: () => unknown): string {
  try { call(); } catch (error) { if (error instanceof IpcArgumentError) return error.detail; throw error; }
  throw new Error("expected an argument error");
}

describe("str", () => {
  it("accepts a string", () => {
    expect(str("hello", "c", 0)).toBe("hello");
  });

  it("rejects what coercion would have swallowed", () => {
    // String(undefined) === "undefined", which then looks like a real id.
    expect(() => str(undefined, "capsule:getProject", 0)).toThrow(IpcArgumentError);
    expect(() => str(null, "c", 0)).toThrow();
    expect(() => str(42, "c", 0)).toThrow();
    expect(() => str({}, "c", 0)).toThrow();
  });

  it("keeps the channel out of what a person reads", () => {
    expect(() => str(undefined, "capsule:getProject", 1)).toThrow(/^Capsule couldn't complete that request\./);
    expect(() => str(undefined, "capsule:getProject", 1)).not.toThrow(/capsule:/);
  });

  it("names the channel and the argument position", () => {
    expect(detailOf(() => str(undefined, "capsule:getProject", 1))).toMatch(
      /capsule:getProject: argument 2 must be a string, received undefined/,
    );
  });
});

describe("id", () => {
  it("rejects an empty or blank string", () => {
    expect(detailOf(() => id("", "c", 0))).toMatch(/must not be empty/);
    expect(detailOf(() => id("   ", "c", 0))).toMatch(/must not be empty/);
  });

  it("keeps a real id untouched", () => {
    expect(id("proj_123", "c", 0)).toBe("proj_123");
  });
});

describe("optional parsers", () => {
  it("treat undefined and null as absent", () => {
    expect(optStr(undefined, "c", 0)).toBeUndefined();
    expect(optStr(null, "c", 0)).toBeUndefined();
    expect(optNum(null, "c", 0)).toBeUndefined();
    expect(optBool(undefined, "c", 0)).toBe(false);
  });

  it("still reject a wrong type when present", () => {
    expect(() => optStr(5, "c", 0)).toThrow();
    expect(() => optNum("5", "c", 0)).toThrow();
    expect(() => optBool("yes", "c", 0)).toThrow();
  });
});

describe("num", () => {
  it("rejects NaN and Infinity, which Number() produces from garbage", () => {
    expect(detailOf(() => num(Number.NaN, "c", 0))).toMatch(/finite number/);
    expect(() => num(Number.POSITIVE_INFINITY, "c", 0)).toThrow();
    expect(() => num("12", "c", 0)).toThrow();
  });

  it("accepts zero and negatives", () => {
    expect(num(0, "c", 0)).toBe(0);
    expect(num(-3, "c", 0)).toBe(-3);
  });
});

describe("bool", () => {
  it("does not accept truthy stand-ins", () => {
    expect(() => bool(1, "c", 0)).toThrow();
    expect(() => bool("true", "c", 0)).toThrow();
  });
});

describe("payload", () => {
  it("accepts a record and passes it through", () => {
    const parse = payload<{ name: string }>();
    expect(parse({ name: "x" }, "c", 0)).toEqual({ name: "x" });
  });

  it("rejects the shapes that would throw deep inside the engine", () => {
    const parse = payload();
    expect(detailOf(() => parse(null, "c", 0))).toMatch(/must be an object, received null/);
    expect(() => parse("{}", "c", 0)).toThrow();
    expect(detailOf(() => parse([1, 2], "c", 0))).toMatch(/received an array/);
  });
});

describe("oneOf", () => {
  it("accepts a listed value and rejects anything else", () => {
    const parse = oneOf("general", "appearance");
    expect(parse("general", "c", 0)).toBe("general");
    expect(detailOf(() => parse("nope", "c", 0))).toMatch(/must be one of general, appearance/);
  });
});

describe("parseArgs", () => {
  it("applies parsers positionally", () => {
    expect(parseArgs("c", [id, optBool], ["abc", true])).toEqual(["abc", true]);
  });

  it("fills omitted optionals", () => {
    expect(parseArgs("c", [id, optStr], ["abc"])).toEqual(["abc", undefined]);
  });

  it("ignores extra arguments rather than failing", () => {
    expect(parseArgs("c", [id], ["abc", "unused"])).toEqual(["abc"]);
  });

  it("reports the first bad argument with its position", () => {
    expect(detailOf(() => parseArgs("capsule:writeFile", [id, id], ["ok", ""]))).toMatch(
      /capsule:writeFile: argument 2 must not be empty/,
    );
  });
});
