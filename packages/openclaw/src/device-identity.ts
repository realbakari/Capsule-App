import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DeviceIdentity, GatewayClientHostDeps } from "@openclaw/gateway-client";

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const IDENTITY_FILE = "device.json";
const AUTH_FILE = "device-auth.json";

type StoredIdentity = {
  version: 1;
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
  createdAtMs: number;
};

type StoredAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

type StoredAuth = {
  version: 1;
  deviceId: string;
  tokens: Record<string, StoredAuthEntry>;
};

function defaultIdentityDir(): string {
  return path.join(os.homedir(), ".capsule", "identity");
}

function base64UrlEncode(buf: Buffer): string {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    // chmod can fail on some test filesystems; the write still uses 0600 files.
  }
}

function writePrivateJson(filePath: string, value: unknown): void {
  ensurePrivateDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Ignore chmod failures after a successful write.
  }
}

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const spki = crypto.createPublicKey(publicKeyPem).export({ type: "spki", format: "der" });
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function fingerprintPublicKey(publicKeyPem: string): string {
  return crypto.createHash("sha256").update(derivePublicKeyRaw(publicKeyPem)).digest("hex");
}

function keyPairMatches(publicKeyPem: string, privateKeyPem: string): boolean {
  try {
    const payload = Buffer.from("capsule-device-identity-self-check", "utf8");
    const signature = crypto.sign(null, payload, crypto.createPrivateKey(privateKeyPem));
    return crypto.verify(null, payload, crypto.createPublicKey(publicKeyPem), signature);
  } catch {
    return false;
  }
}

function generateIdentity(): DeviceIdentity {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  return {
    deviceId: fingerprintPublicKey(publicKeyPem),
    publicKeyPem,
    privateKeyPem,
  };
}

function parseStoredIdentity(value: unknown): DeviceIdentity | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.deviceId !== "string" ||
    typeof record.publicKeyPem !== "string" ||
    typeof record.privateKeyPem !== "string"
  ) {
    return undefined;
  }
  if (!keyPairMatches(record.publicKeyPem, record.privateKeyPem)) return undefined;
  const deviceId = fingerprintPublicKey(record.publicKeyPem);
  return {
    deviceId,
    publicKeyPem: record.publicKeyPem,
    privateKeyPem: record.privateKeyPem,
  };
}

export function resolveIdentityDir(identityDir?: string): string {
  return identityDir && identityDir.trim().length > 0 ? identityDir : defaultIdentityDir();
}

export function loadOrCreateDeviceIdentity(identityDir?: string): DeviceIdentity {
  const dir = resolveIdentityDir(identityDir);
  const filePath = path.join(dir, IDENTITY_FILE);
  try {
    const raw = readJson(filePath);
    const loaded = parseStoredIdentity(raw);
    if (loaded) {
      const storedId =
        raw && typeof raw === "object" && "deviceId" in raw
          ? String((raw as { deviceId: unknown }).deviceId)
          : "";
      if (storedId && storedId !== loaded.deviceId) {
        writePrivateJson(filePath, {
          version: 1,
          deviceId: loaded.deviceId,
          publicKeyPem: loaded.publicKeyPem,
          privateKeyPem: loaded.privateKeyPem,
          createdAtMs: Date.now(),
        } satisfies StoredIdentity);
      }
      return loaded;
    }
  } catch {
    // Missing or unreadable identity is recreated below.
  }
  const identity = generateIdentity();
  writePrivateJson(filePath, {
    version: 1,
    deviceId: identity.deviceId,
    publicKeyPem: identity.publicKeyPem,
    privateKeyPem: identity.privateKeyPem,
    createdAtMs: Date.now(),
  } satisfies StoredIdentity);
  return identity;
}

export function signDevicePayload(privateKeyPem: string, payload: string): string {
  const key = crypto.createPrivateKey(privateKeyPem);
  return base64UrlEncode(crypto.sign(null, Buffer.from(payload, "utf8"), key));
}

export function publicKeyRawBase64UrlFromPem(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function authPath(identityDir?: string): string {
  return path.join(resolveIdentityDir(identityDir), AUTH_FILE);
}

function parseStoredAuth(value: unknown): StoredAuth | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (record.version !== 1 || typeof record.deviceId !== "string" || !record.tokens || typeof record.tokens !== "object") {
    return undefined;
  }
  const tokens: Record<string, StoredAuthEntry> = {};
  for (const [role, entry] of Object.entries(record.tokens as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.token !== "string" || row.token.length === 0) continue;
    tokens[role] = {
      token: row.token,
      role: typeof row.role === "string" ? row.role : role,
      scopes: Array.isArray(row.scopes) ? row.scopes.map(String) : [],
      updatedAtMs: typeof row.updatedAtMs === "number" ? row.updatedAtMs : 0,
    };
  }
  return { version: 1, deviceId: record.deviceId, tokens };
}

function readAuthStore(identityDir?: string): StoredAuth | undefined {
  try {
    return parseStoredAuth(readJson(authPath(identityDir)));
  } catch {
    return undefined;
  }
}

export function loadDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  identityDir?: string;
}): { token?: string; scopes?: string[] } | null {
  const store = readAuthStore(params.identityDir);
  if (!store || store.deviceId !== params.deviceId) return null;
  const entry = store.tokens[params.role];
  if (!entry) return null;
  return { token: entry.token, scopes: entry.scopes };
}

export function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes: string[];
  identityDir?: string;
}): void {
  const existing = readAuthStore(params.identityDir);
  const tokens =
    existing && existing.deviceId === params.deviceId ? { ...existing.tokens } : {};
  tokens[params.role] = {
    token: params.token,
    role: params.role,
    scopes: params.scopes,
    updatedAtMs: Date.now(),
  };
  writePrivateJson(authPath(params.identityDir), {
    version: 1,
    deviceId: params.deviceId,
    tokens,
  } satisfies StoredAuth);
}

export function clearDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  identityDir?: string;
}): void {
  const existing = readAuthStore(params.identityDir);
  if (!existing || existing.deviceId !== params.deviceId || !existing.tokens[params.role]) return;
  const tokens = { ...existing.tokens };
  delete tokens[params.role];
  writePrivateJson(authPath(params.identityDir), {
    version: 1,
    deviceId: existing.deviceId,
    tokens,
  } satisfies StoredAuth);
}

export function createGatewayHostDeps(identityDir?: string): GatewayClientHostDeps {
  const dir = resolveIdentityDir(identityDir);
  return {
    loadOrCreateDeviceIdentity: () => loadOrCreateDeviceIdentity(dir),
    signDevicePayload,
    publicKeyRawBase64UrlFromPem,
    loadDeviceAuthToken: ({ deviceId, role }) => loadDeviceAuthToken({ deviceId, role, identityDir: dir }),
    storeDeviceAuthToken: ({ deviceId, role, token, scopes }) =>
      storeDeviceAuthToken({ deviceId, role, token, scopes, identityDir: dir }),
    clearDeviceAuthToken: ({ deviceId, role }) => clearDeviceAuthToken({ deviceId, role, identityDir: dir }),
  };
}
