import { describe, expect, it } from "vitest";
import { createToast, TOAST_LIMIT, toastReducer } from "./toasts";

describe("toast stack", () => {
  it("replaces a toast with the same key instead of stacking it", () => {
    let stack = toastReducer([], { type: "show", toast: createToast({ key: "browser", title: "Copied" }) });
    stack = toastReducer(stack, { type: "show", toast: createToast({ key: "browser", title: "Copied again" }) });
    expect(stack.map((toast) => toast.title)).toEqual(["Copied again"]);
  });

  it("keeps the newest few and drops the oldest", () => {
    let stack = toastReducer([], { type: "show", toast: createToast({ title: "first" }) });
    for (let index = 0; index < TOAST_LIMIT; index++) stack = toastReducer(stack, { type: "show", toast: createToast({ title: `n${index}` }) });
    expect(stack).toHaveLength(TOAST_LIMIT);
    expect(stack.some((toast) => toast.title === "first")).toBe(false);
  });

  it("gives an undo longer than news, and an error longer than success", () => {
    expect(createToast({ title: "x", action: { label: "Undo", undo: true, run: () => undefined } }).timeoutMs).toBe(10_000);
    expect(createToast({ title: "x", tone: "error" }).timeoutMs).toBeGreaterThan(createToast({ title: "x", tone: "success" }).timeoutMs);
    expect(createToast({ title: "x", timeoutMs: 0 }).timeoutMs).toBe(0);
  });

  it("dismisses by id", () => {
    const toast = createToast({ title: "x" });
    expect(toastReducer([toast], { type: "dismiss", id: toast.id })).toEqual([]);
  });
});
