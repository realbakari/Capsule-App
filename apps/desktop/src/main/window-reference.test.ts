import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { WindowReference } from "./window-reference";

class TestWindow extends EventEmitter {
  destroyed = false;
  contentsDestroyed = false;
  readonly messages: unknown[] = [];
  readonly contents = {
    isDestroyed: () => this.contentsDestroyed,
    send: (channel: string, payload: unknown) => {
      if (this.contentsDestroyed) throw new TypeError("Object has been destroyed");
      this.messages.push({ channel, payload });
    },
  };

  get webContents() {
    if (this.destroyed) throw new TypeError("Object has been destroyed");
    return this.contents;
  }

  isDestroyed() { return this.destroyed; }

  close() {
    this.destroyed = true;
    this.contentsDestroyed = true;
    this.emit("closed");
  }
}

describe("desktop window lifetime", () => {
  it("delivers events before close and to a reopened window, skipping the closed window", () => {
    const reference = new WindowReference<TestWindow>();
    const first = new TestWindow();
    reference.current = first;
    reference.send("state", "working");
    first.close();
    reference.send("state", "app-shutting-down");
    expect(reference.current).toBeUndefined();
    const reopened = new TestWindow();
    reference.current = reopened;
    reference.send("state", "ready");
    expect(first.messages).toEqual([{ channel: "state", payload: "working" }]);
    expect(reopened.messages).toEqual([{ channel: "state", payload: "ready" }]);
  });

  it("retains the window when closing is cancelled", () => {
    const reference = new WindowReference<TestWindow>();
    const window = new TestWindow();
    reference.current = window;
    window.emit("close");
    reference.send("state", "still running");
    expect(window.messages).toEqual([{ channel: "state", payload: "still running" }]);
    expect(reference.current).toBe(window);
  });

  it("does not let a late close clear a replacement window", () => {
    const reference = new WindowReference<TestWindow>();
    const old = new TestWindow();
    const replacement = new TestWindow();
    reference.current = old;
    reference.current = replacement;
    old.close();
    reference.send("state", "ready");
    expect(replacement.messages).toEqual([{ channel: "state", payload: "ready" }]);
  });

  it("skips independently destroyed contents and a destroyed window before its closed event", () => {
    const reference = new WindowReference<TestWindow>();
    const window = new TestWindow();
    reference.current = window;
    reference.send("state", "working");
    window.contentsDestroyed = true;
    reference.send("state", "contents gone");
    window.destroyed = true;
    reference.send("state", "window gone");
    expect(reference.current).toBeUndefined();
    expect(window.messages).toEqual([{ channel: "state", payload: "working" }]);
  });
});
