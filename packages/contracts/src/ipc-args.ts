/**
 * Argument checking for the IPC boundary.
 *
 * Handlers used to coerce whatever arrived: `String(query)`, `Boolean(flag)`,
 * `Number(limit)`. Coercion cannot fail, which is the problem — `String(undefined)`
 * is the string "undefined", so a missing project id became a lookup for a
 * project literally named "undefined", and `Number("")` is 0, which is a valid
 * page number. The renderer bug surfaced somewhere else entirely, as empty
 * results or a mysteriously missing record.
 *
 * These parsers reject instead, naming the channel and the argument, so a bad
 * call fails at the boundary it crossed. Deliberately dependency-free: the
 * whole surface is scalars, optional scalars, and pass-through objects that the
 * engine's own types already describe.
 */

export class IpcArgumentError extends Error {
  constructor(
    readonly channel: string,
    readonly index: number,
    detail: string,
  ) {
    super(`${channel}: argument ${index + 1} ${detail}`);
    this.name = "IpcArgumentError";
  }
}

export type ArgParser<T> = (value: unknown, channel: string, index: number) => T;

/** A required string. Rejects undefined, null, numbers and objects. */
export const str: ArgParser<string> = (value, channel, index) => {
  if (typeof value !== "string") {
    throw new IpcArgumentError(channel, index, `must be a string, received ${describe(value)}`);
  }
  return value;
};

/** A required, non-blank string — for ids and paths, where "" is never valid. */
export const id: ArgParser<string> = (value, channel, index) => {
  const text = str(value, channel, index);
  if (text.trim().length === 0) {
    throw new IpcArgumentError(channel, index, "must not be empty");
  }
  return text;
};

/** A string that may be omitted. `null` is accepted and normalised away. */
export const optStr: ArgParser<string | undefined> = (value, channel, index) => {
  if (value === undefined || value === null) return undefined;
  return str(value, channel, index);
};

export const bool: ArgParser<boolean> = (value, channel, index) => {
  if (typeof value !== "boolean") {
    throw new IpcArgumentError(channel, index, `must be a boolean, received ${describe(value)}`);
  }
  return value;
};

/** A boolean that may be omitted, defaulting to false. */
export const optBool: ArgParser<boolean> = (value, channel, index) => {
  if (value === undefined || value === null) return false;
  return bool(value, channel, index);
};

/** A finite number. Rejects NaN and Infinity, which coercion produces freely. */
export const num: ArgParser<number> = (value, channel, index) => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new IpcArgumentError(channel, index, `must be a finite number, received ${describe(value)}`);
  }
  return value;
};

export const optNum: ArgParser<number | undefined> = (value, channel, index) => {
  if (value === undefined || value === null) return undefined;
  return num(value, channel, index);
};

/**
 * A structured payload. Checked only for shape, because the engine method's own
 * parameter type is the real contract; this rejects the case that would throw
 * deep inside instead — a string, a number, or null arriving where a record
 * was expected.
 */
export function payload<T>(): ArgParser<T> {
  return (value, channel, index) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new IpcArgumentError(channel, index, `must be an object, received ${describe(value)}`);
    }
    return value as T;
  };
}

/** One of a fixed set. */
export function oneOf<T extends string>(...allowed: T[]): ArgParser<T> {
  return (value, channel, index) => {
    const text = str(value, channel, index);
    if (!allowed.includes(text as T)) {
      throw new IpcArgumentError(channel, index, `must be one of ${allowed.join(", ")}`);
    }
    return text as T;
  };
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value;
}

/**
 * Apply parsers positionally. Extra arguments are ignored, so a renderer that
 * passes more than the handler reads is not an error.
 */
export function parseArgs(
  channel: string,
  parsers: ReadonlyArray<ArgParser<unknown>>,
  args: readonly unknown[],
): unknown[] {
  return parsers.map((parse, index) => parse(args[index], channel, index));
}
