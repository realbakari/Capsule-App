import crypto from "node:crypto";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGatewayHostDeps,
  loadOrCreateDeviceIdentity,
  publicKeyRawBase64UrlFromPem,
  signDevicePayload,
} from "./device-identity.js";

function tempIdentityDir(): string {
  return mkdtempSync(path.join(tmpdir(), "capsule-identity-"));
}

describe("device identity", () => {
  it("persists an Ed25519 identity and reloads the same device id", () => {
    const dir = tempIdentityDir();
    const first = loadOrCreateDeviceIdentity(dir);
    const second = loadOrCreateDeviceIdentity(dir);
    expect(second.deviceId).toBe(first.deviceId);
    expect(second.publicKeyPem).toBe(first.publicKeyPem);
    const mode = statSync(path.join(dir, "device.json")).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(first.deviceId).toMatch(/^[a-f0-9]{64}$/);
  });

  it("signs a challenge payload that verifies against the public key", () => {
    const identity = loadOrCreateDeviceIdentity(tempIdentityDir());
    const payload = "openclaw-device-auth-v3:test-nonce";
    const signature = signDevicePayload(identity.privateKeyPem, payload);
    const normalized = signature.replaceAll("-", "+").replaceAll("_", "/");
    const padded = `${normalized}${"=".repeat((4 - (normalized.length % 4)) % 4)}`;
    const ok = crypto.verify(
      null,
      Buffer.from(payload, "utf8"),
      crypto.createPublicKey(identity.publicKeyPem),
      Buffer.from(padded, "base64"),
    );
    expect(ok).toBe(true);
    expect(publicKeyRawBase64UrlFromPem(identity.publicKeyPem).length).toBeGreaterThan(40);
  });

  it("stores and clears a device auth token through host deps", () => {
    const dir = tempIdentityDir();
    const deps = createGatewayHostDeps(dir);
    const identity = deps.loadOrCreateDeviceIdentity?.();
    expect(identity?.deviceId).toBeTruthy();
    deps.storeDeviceAuthToken?.({
      deviceId: identity!.deviceId,
      role: "operator",
      token: "device-token",
      scopes: ["operator.read"],
    });
    expect(deps.loadDeviceAuthToken?.({ deviceId: identity!.deviceId, role: "operator" })).toEqual({
      token: "device-token",
      scopes: ["operator.read"],
    });
    deps.clearDeviceAuthToken?.({ deviceId: identity!.deviceId, role: "operator" });
    expect(deps.loadDeviceAuthToken?.({ deviceId: identity!.deviceId, role: "operator" })).toBeNull();
    const raw = readFileSync(path.join(dir, "device-auth.json"), "utf8");
    expect(raw).not.toContain("device-token");
  });
});
