import { expect, it } from "vitest";
import { RunNotifications } from "./run-notifications";

it("alerts once per settled run, including when metadata arrives later", () => {
  const notifications = new RunNotifications();
  expect(notifications.firstSettlement({ id: "one", status: "running" })).toBe(false);
  expect(notifications.firstSettlement({ id: "one", status: "completed" })).toBe(true);
  expect(notifications.firstSettlement({ id: "one", status: "completed" })).toBe(false);
  expect(notifications.firstSettlement({ id: "two", status: "failed" })).toBe(true);
  expect(notifications.firstSettlement({ id: "three", status: "cancelled" })).toBe(true);
});
