import { expect, it, vi } from "vitest";

const commands = vi.hoisted(() => []);
vi.mock("node:child_process", () => ({ execSync: vi.fn((command) => commands.push(command)) }));
vi.mock("node:fs", () => ({ default: {
  rmSync: vi.fn(), mkdirSync: vi.fn(), readdirSync: vi.fn(() => []),
} }));
vi.mock("./check-release-version.mjs", () => ({
  readPackageVersion: () => "1.0.0", validateReleaseVersion: vi.fn(),
}));

it("runs the complete application build before packaging and signing", async () => {
  await import("./package-mac.mjs");
  expect(commands[0]).toBe("pnpm build");
  expect(commands[1]).toContain("electron-builder --mac --arm64");
  expect(commands[1]).toContain("--publish never");
});
