import { expect, it } from "vitest";
import { IPC_CHANNELS } from "@capsule/shared";
import { UpdateAdmission } from "./update-admission";

it("accounts for in-flight writes and unlocks after a failed operation", async () => {
  const gate = new UpdateAdmission();
  let fail!: (error: Error) => void;
  const pending = gate.run(IPC_CHANNELS.gitCommit, () => new Promise((_resolve, reject) => { fail = reject; }));
  expect(() => gate.reserve()).toThrow("Finish active workspace operations");
  const rejected = expect(pending).rejects.toThrow("fixture error");
  fail(new Error("fixture error"));
  await rejected;
  expect(() => gate.reserve()()).not.toThrow();
});

it("keeps status readable but rejects every non-update write during restart", async () => {
  const gate = new UpdateAdmission();
  const release = gate.reserve();
  for (const channel of [IPC_CHANNELS.sendMessage, IPC_CHANNELS.terminalStart, IPC_CHANNELS.execInProject,
    IPC_CHANNELS.writeFile, IPC_CHANNELS.spawnHarness, IPC_CHANNELS.gitPush, "capsule:futureWrite"]) {
    await expect(gate.run(channel, () => { throw new Error("Must not run"); })).rejects.toThrow("preparing to restart");
  }
  await expect(gate.run(IPC_CHANNELS.updateStatus, () => "installing")).resolves.toBe("installing");
  await expect(gate.run(IPC_CHANNELS.listMessages, () => [])).resolves.toEqual([]);
  release();
  const secondRelease = gate.reserve();
  release();
  await expect(gate.run(IPC_CHANNELS.sendMessage, () => "wrong")).rejects.toThrow("preparing to restart");
  secondRelease();
  await expect(gate.run(IPC_CHANNELS.sendMessage, () => "allowed")).resolves.toBe("allowed");
});

it("does not count install's own IPC request as active workspace work", async () => {
  const gate = new UpdateAdmission();
  await gate.run(IPC_CHANNELS.installUpdate, () => gate.reserve()());
});
