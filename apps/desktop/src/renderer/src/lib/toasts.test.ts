import { describe, expect, it } from "vitest";
import { createToast, EMPTY_TOAST_STACK, TOAST_LIMIT, toastReducer, type ToastInput, type ToastStack } from "./toasts";

const undo = { label: "Undo", undo: true, run: () => undefined };
const open = { label: "Open", run: () => undefined };

function showAll(inputs: ToastInput[], stack: ToastStack = EMPTY_TOAST_STACK): ToastStack {
  return inputs.reduce((current, input) => toastReducer(current, { type: "show", toast: createToast(input) }), stack);
}
const titles = (toasts: ReadonlyArray<{ title: string }>) => toasts.map((toast) => toast.title);

describe("toast stack", () => {
  it("replaces a toast with the same key instead of stacking it", () => {
    const stack = showAll([{ key: "browser", title: "Copied" }, { key: "browser", title: "Copied again" }]);
    expect(titles(stack.visible)).toEqual(["Copied again"]);
  });

  it("keeps the newest few and drops the oldest when nothing is at stake", () => {
    const stack = showAll([{ title: "first" }, ...Array.from({ length: TOAST_LIMIT }, (_, index) => ({ title: `n${index}` }))]);
    expect(stack.visible).toHaveLength(TOAST_LIMIT);
    expect(titles(stack.visible)).not.toContain("first");
    expect(stack.waiting).toEqual([]);
  });

  it("never pushes an Undo off the screen for a line of news", () => {
    const stack = showAll([{ title: "Archived", action: undo }, { title: "news 1" }, { title: "news 2" }, { title: "news 3" }]);
    expect(titles(stack.visible)).toEqual(["Archived", "news 2", "news 3"]);
  });

  it("drops plain news before an action toast or an error", () => {
    const stack = showAll([{ title: "news" }, { title: "Failed", tone: "error" }, { title: "Finished", action: open }, { title: "Deleted", action: undo }]);
    expect(titles(stack.visible)).toEqual(["Failed", "Finished", "Deleted"]);
  });

  it("holds news back while every slot holds an Undo, and shows it when one leaves", () => {
    let stack = showAll([{ title: "u1", action: undo }, { title: "u2", action: undo }, { title: "u3", action: undo }, { title: "news" }]);
    expect(titles(stack.visible)).toEqual(["u1", "u2", "u3"]);
    expect(titles(stack.waiting)).toEqual(["news"]);
    stack = toastReducer(stack, { type: "dismiss", id: stack.visible[0]!.id });
    expect(titles(stack.visible)).toEqual(["u2", "u3", "news"]);
    expect(stack.waiting).toEqual([]);
  });

  it("dismisses a waiting toast before it is ever shown", () => {
    const stack = showAll([{ title: "u1", action: undo }, { title: "u2", action: undo }, { title: "u3", action: undo }, { key: "slow", title: "Waiting", timeoutMs: 0 }]);
    const waiting = stack.waiting[0]!;
    const after = toastReducer(stack, { type: "dismiss", id: waiting.id });
    expect(after.waiting).toEqual([]);
    expect(titles(after.visible)).toEqual(["u1", "u2", "u3"]);
  });

  it("gives an undo longer than news, and an error longer than success", () => {
    expect(createToast({ title: "x", action: undo }).timeoutMs).toBe(10_000);
    expect(createToast({ title: "x", tone: "error" }).timeoutMs).toBeGreaterThan(createToast({ title: "x", tone: "success" }).timeoutMs);
    expect(createToast({ title: "x", timeoutMs: 0 }).timeoutMs).toBe(0);
  });

  it("dismisses by id", () => {
    const stack = showAll([{ title: "x" }]);
    expect(toastReducer(stack, { type: "dismiss", id: stack.visible[0]!.id })).toEqual(EMPTY_TOAST_STACK);
  });
});
