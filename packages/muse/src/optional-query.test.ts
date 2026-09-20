import { afterEach, expect, it, vi } from "vitest";
import { OptionalQuery } from "./optional-query.js";

afterEach(() => vi.useRealTimers());

it("allows only one underlying request, even after timeout and late rejection", async () => {
  vi.useFakeTimers();
  const query = new OptionalQuery();
  let reject!: (error: Error) => void;
  const request = vi.fn(() => new Promise<string>((_, fail) => { reject = fail; }));
  const pending = query.run(request);
  await vi.advanceTimersByTimeAsync(3_000);
  expect(await pending).toBeUndefined();
  expect(await query.run(request)).toBeUndefined();
  reject(new Error("late failure"));
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(1);
});

it("discards a result after deadline or close and clears its timer", async () => {
  vi.useFakeTimers();
  for (const ending of ["timeout", "close"]) {
    const query = new OptionalQuery();
    let finish!: (value: string) => void;
    const pending = query.run(() => new Promise<string>((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(0);
    if (ending === "close") query.close();
    else await vi.advanceTimersByTimeAsync(3_000);
    finish("obsolete");
    expect(await pending).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  }
});

it("returns timely observations and contains optional errors", async () => {
  expect(await new OptionalQuery().run(async () => "reported")).toBe("reported");
  expect(await new OptionalQuery().run(async () => { throw new Error("unsupported"); })).toBeUndefined();
});
