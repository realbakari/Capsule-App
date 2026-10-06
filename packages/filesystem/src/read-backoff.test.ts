import { expect, it } from "vitest";
import { ReadBackoff } from "./read-backoff.js";

it("backs off repeated failures, allows explicit recovery, and resets after success", () => {
  const reads = new ReadBackoff();
  reads.failed("repo", "offline", 0);
  expect(reads.ready("repo", false, 29_999)).toBe(false);
  expect(reads.ready("repo", true, 1)).toBe(true);
  expect(reads.ready("repo", false, 30_000)).toBe(true);
  reads.failed("repo", "offline", 30_000);
  expect(reads.ready("repo", false, 89_999)).toBe(false);
  expect(reads.ready("different repo", false, 30_000)).toBe(true);
  reads.clear("repo");
  expect(reads.ready("repo", false, 30_001)).toBe(true);
  reads.failed("repo", "offline", 40_000);
  expect(reads.ready("repo", false, 70_000)).toBe(true);
});

it("does not let repeated refresh clicks bypass a rate-limit pause", () => {
  const reads = new ReadBackoff();
  reads.failed("repo", "API rate limit exceeded", 0);
  expect(reads.ready("repo", true, 59_999)).toBe(false);
  expect(reads.ready("repo", true, 60_000)).toBe(true);
  reads.clear();
  expect(reads.ready("repo", false, 1)).toBe(true);
});
