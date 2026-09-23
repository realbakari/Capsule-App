import { describe, expect, it } from "vitest";
import { RequestSlots } from "./request-slots.js";

describe("relay request slots", () => {
  it("queues ordinary overlap in arrival order and never exceeds its limit", async () => {
    const slots = new RequestSlots(2);
    const signal = new AbortController().signal;
    const first = await slots.acquire(signal), second = await slots.acquire(signal);
    let thirdStarted = false, fourthStarted = false;
    const third = slots.acquire(signal).then((release) => { thirdStarted = true; return release; });
    const fourth = slots.acquire(signal).then((release) => { fourthStarted = true; return release; });
    await Promise.resolve(); expect(thirdStarted).toBe(false);
    first(); const releaseThird = await third;
    expect(fourthStarted).toBe(false);
    first(); await Promise.resolve(); expect(fourthStarted).toBe(false);
    second(); const releaseFourth = await fourth;
    releaseThird(); releaseFourth();
  });
  it("cancels waiting connection work without blocking the next waiter", async () => {
    const slots = new RequestSlots(1);
    const connection = new AbortController(), next = new AbortController();
    const release = await slots.acquire(next.signal);
    const waiting = slots.acquire(connection.signal);
    const rejected = expect(waiting).rejects.toThrow("connection changed");
    connection.abort(); await rejected;
    const third = slots.acquire(next.signal); release(); (await third)();
    await expect(slots.acquire(connection.signal)).rejects.toThrow("connection changed");
  });
  it("bounds queued work without rejecting a normal fifth request", async () => {
    const slots = new RequestSlots(1, 1), controller = new AbortController();
    const release = await slots.acquire(controller.signal);
    const waiting = slots.acquire(controller.signal);
    await expect(slots.acquire(controller.signal)).rejects.toThrow("Too many pending");
    release(); (await waiting)();
  });
});
