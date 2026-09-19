import { expect, it } from "vitest";
import { remoteCommandFailure } from "./remote-errors.js";

it.each([
  ["Authentication failed", "access was denied"],
  ["Repository not found", "not found"],
  ["non-fast-forward", "remote branch has changed"],
  ["Could not resolve host", "connection"],
  ["Operation timed out", "may have completed"],
  ["fatal: unexpected error", "Operation failed."],
])("does not disclose credentials in %s", (error, expected) => {
  const output = error + " https://user:fixture-secret@host.test/repo?token=fixture-secret\u001b[31m";
  const result = remoteCommandFailure(output, "Operation failed.");
  expect(result).toContain(expected);
  expect(result).not.toContain("fixture-secret");
  expect(result).not.toContain("\u001b");
});
