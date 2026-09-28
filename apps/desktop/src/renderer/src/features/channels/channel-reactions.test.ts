import { expect, it, vi } from "vitest";
import { ChannelReactions } from "./channel-reactions";

it("notifies every transcript copy and does not retain own-reaction state in another connection", async () => {
  const connection = new ChannelReactions();
  const channel = vi.fn(), thread = vi.fn();
  connection.subscribe(channel); connection.subscribe(thread);
  await connection.perform("message", async () => [{ emoji: "👍", count: 1, mine: true }], async () => {}, String);
  expect(channel).toHaveBeenCalledTimes(3);
  expect(thread).toHaveBeenCalledTimes(3);
  expect(connection.get("message").reactions?.[0]?.mine).toBe(true);
  expect(new ChannelReactions().get("message").reactions).toBeUndefined();
});

it("serializes a mutation across copies and invalidates stale counts after an accepted write", async () => {
  const connection = new ChannelReactions();
  let finish!: () => void;
  const write = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const pending = connection.perform("message", async () => { throw new Error("Read failed"); }, write, String);
  await connection.perform("message", async () => [], write, String);
  expect(write).toHaveBeenCalledOnce();
  finish(); await pending;
  expect(connection.get("message")).toMatchObject({ busy: false, error: "Change accepted, but counts could not be refreshed. Error: Read failed" });
  expect(connection.get("message").reactions).toBeUndefined();
});
