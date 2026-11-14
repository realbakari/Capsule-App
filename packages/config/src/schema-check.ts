import { isDeepStrictEqual } from "node:util";
import type { JsonSchema } from "@capsule/shared";

/**
 * The subset of JSON Schema the settings registry uses: type, enum, const,
 * pattern, properties, additionalProperties, items, required, oneOf,
 * minimum, maximum and maxLength. Anything else in a fragment (format,
 * description) is documentation for editors and is not checked.
 */

export interface SchemaIssue {
  /** Dotted path from the top-level key, such as `hooks.TurnEnd[0].hooks[1]`. */
  at: string;
  message: string;
  severity: "error" | "warning";
}

export type Checked = { ok: true; value: unknown } | { ok: false };

const INVALID: Checked = { ok: false };

/**
 * Check a value and drop the smallest part that is wrong: an array item, an
 * object property, or the value itself. An entry that fails is skipped on its
 * own, so one bad rule does not take the rest of a file with it.
 */
export function pruneToSchema(schema: JsonSchema, value: unknown, at: string, issues: SchemaIssue[]): Checked {
  const fail = (message: string): Checked => {
    issues.push({ at, message, severity: "error" });
    return INVALID;
  };
  if ("const" in schema && !isDeepStrictEqual(value, schema.const)) return fail(`must be ${JSON.stringify(schema.const)}`);
  if (Array.isArray(schema.enum) && !schema.enum.some((option) => isDeepStrictEqual(option, value))) {
    return fail(`must be one of ${schema.enum.map((option) => JSON.stringify(option)).join(", ")}`);
  }
  if (schema.type !== undefined && !matchesType(schema.type, value)) return fail(`must be ${describeType(schema.type)}`);
  if (typeof value === "string") {
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return fail(`must be at most ${schema.maxLength} characters`);
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(value)) return fail(`does not match ${schema.pattern}`);
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) return fail(`must be at least ${schema.minimum}`);
    if (typeof schema.maximum === "number" && value > schema.maximum) return fail(`must be at most ${schema.maximum}`);
  }
  if (Array.isArray(schema.oneOf)) {
    const matches = (schema.oneOf as JsonSchema[]).filter((branch) => matchesSchema(branch, value)).length;
    if (matches !== 1) return fail(matches === 0 ? "does not match any allowed shape" : "matches more than one allowed shape");
  }
  if (isPlainObject(value)) return pruneObject(schema, value, at, issues);
  if (Array.isArray(value) && isPlainObject(schema.items)) {
    const items: unknown[] = [];
    value.forEach((item, index) => {
      const checked = pruneToSchema(schema.items as JsonSchema, item, `${at}[${index}]`, issues);
      if (checked.ok) items.push(checked.value);
    });
    return { ok: true, value: items };
  }
  return { ok: true, value };
}

/** True when the value matches with nothing dropped. */
export function matchesSchema(schema: JsonSchema, value: unknown): boolean {
  const issues: SchemaIssue[] = [];
  return pruneToSchema(schema, value, "", issues).ok && issues.length === 0;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pruneObject(schema: JsonSchema, value: Record<string, unknown>, at: string, issues: SchemaIssue[]): Checked {
  const properties = isPlainObject(schema.properties) ? (schema.properties as Record<string, JsonSchema>) : {};
  const extra = schema.additionalProperties;
  const kept: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const childAt = at ? `${at}.${key}` : key;
    const childSchema = properties[key] ?? (isPlainObject(extra) ? (extra as JsonSchema) : undefined);
    if (!properties[key] && extra === false) {
      issues.push({ at: childAt, message: "is not a known field", severity: "warning" });
      continue;
    }
    if (!childSchema) {
      kept[key] = child;
      continue;
    }
    const checked = pruneToSchema(childSchema, child, childAt, issues);
    if (checked.ok) kept[key] = checked.value;
  }
  for (const key of Array.isArray(schema.required) ? (schema.required as string[]) : []) {
    if (!(key in value)) {
      issues.push({ at, message: `needs "${key}"`, severity: "error" });
      return INVALID;
    }
    // Already reported where it failed.
    if (!(key in kept)) return INVALID;
  }
  return { ok: true, value: kept };
}

function matchesType(type: unknown, value: unknown): boolean {
  if (Array.isArray(type)) return type.some((option) => matchesType(option, value));
  switch (type) {
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "array": return Array.isArray(value);
    case "object": return isPlainObject(value);
    case "null": return value === null;
    default: return true;
  }
}

function describeType(type: unknown): string {
  if (Array.isArray(type)) return type.map(describeType).join(" or ");
  return type === "array" || type === "object" || type === "integer" ? `an ${type}` : `a ${String(type)}`;
}
