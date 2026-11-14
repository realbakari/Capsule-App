import { createHash, generateKeyPairSync, randomBytes, sign, X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/*
 * The certificate a paired phone pins.
 *
 * A phone on the same network has no certificate authority that could vouch
 * for a laptop at 192.168.1.20, and plain HTTP lets anyone on that network
 * read and replay what crosses it. So Capsule makes its own certificate once,
 * shows its SHA-256 in the pairing code, and the phone trusts that one
 * certificate and nothing else. Whoever can read the code off this screen is
 * who pairs; nobody in between can stand in for this computer.
 *
 * The certificate is written with node:crypto alone — a short DER encoder
 * rather than a dependency — and kept beside the profile so phones stay
 * paired across restarts.
 */

export interface TlsIdentity {
  key: string;
  cert: string;
  /** Lowercase hex SHA-256 of the certificate's DER bytes. */
  fingerprint: string;
}

function length(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let value = n; value > 0; value >>= 8) bytes.unshift(value & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function tlv(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  return Buffer.concat([Buffer.from([tag]), length(body.length), body]);
}

const sequence = (...items: Buffer[]) => tlv(0x30, ...items);

function oid(dotted: string): Buffer {
  const parts = dotted.split(".").map(Number);
  const bytes = [40 * parts[0]! + parts[1]!];
  for (const part of parts.slice(2)) {
    const chunk = [part & 0x7f];
    for (let value = part >> 7; value > 0; value >>= 7) chunk.unshift((value & 0x7f) | 0x80);
    bytes.push(...chunk);
  }
  return tlv(0x06, Buffer.from(bytes));
}

function positiveInteger(bytes: Buffer): Buffer {
  return tlv(0x02, bytes[0]! & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes);
}

function utcTime(date: Date): Buffer {
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = `${pad(date.getUTCFullYear() % 100)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
  return tlv(0x17, Buffer.from(text, "ascii"));
}

function name(commonName: string): Buffer {
  return sequence(tlv(0x31, sequence(oid("2.5.4.3"), tlv(0x0c, Buffer.from(commonName, "utf8")))));
}

/** A self-signed ECDSA P-256 certificate, valid for ten years from `now`. */
export function createTlsIdentity(commonName = "Capsule", now = new Date()): TlsIdentity {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const algorithm = sequence(oid("1.2.840.10045.4.3.2")); // ecdsa-with-SHA256
  const notBefore = new Date(now.getTime() - 60 * 60_000);
  const notAfter = new Date(now.getTime() + 10 * 365 * 24 * 60 * 60_000);
  const extensions = tlv(0xa3, sequence(
    // basicConstraints: not a CA, so the pin can never sign another certificate.
    sequence(oid("2.5.29.19"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, sequence())),
    // keyUsage: digitalSignature, critical.
    sequence(oid("2.5.29.15"), tlv(0x01, Buffer.from([0xff])), tlv(0x04, tlv(0x03, Buffer.from([0x07, 0x80])))),
    // extendedKeyUsage: serverAuth.
    sequence(oid("2.5.29.37"), tlv(0x04, sequence(oid("1.3.6.1.5.5.7.3.1")))),
  ));
  const tbs = sequence(
    tlv(0xa0, tlv(0x02, Buffer.from([2]))), // v3
    positiveInteger(randomBytes(16)),
    algorithm,
    name(commonName),
    sequence(utcTime(notBefore), utcTime(notAfter)),
    name(commonName),
    publicKey.export({ type: "spki", format: "der" }),
    extensions,
  );
  const signature = sign("sha256", tbs, privateKey);
  const der = sequence(tbs, algorithm, tlv(0x03, Buffer.from([0]), signature));
  const cert = `-----BEGIN CERTIFICATE-----\n${der.toString("base64").match(/.{1,64}/gu)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  return {
    key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    cert,
    fingerprint: createHash("sha256").update(der).digest("hex"),
  };
}

/** Phone pairings on disk: hashes and metadata only, never a usable token. */
export function phoneSessionFile(dir: string) {
  const file = path.join(dir, "remote-phone-sessions.json");
  return {
    load(): import("./pairing.js").RemoteSession[] {
      try {
        const value: unknown = JSON.parse(readFileSync(file, "utf8"));
        return Array.isArray(value) ? value.filter((item): item is import("./pairing.js").RemoteSession =>
          !!item && typeof item === "object" && typeof (item as { tokenHash?: unknown }).tokenHash === "string" &&
          typeof (item as { expiresAt?: unknown }).expiresAt === "number") : [];
      } catch {
        return [];
      }
    },
    save(sessions: import("./pairing.js").RemoteSession[]): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, JSON.stringify(sessions), { mode: 0o600 });
    },
    clear(): void {
      try { writeFileSync(file, "[]", { mode: 0o600 }); } catch { /* Nothing to forget. */ }
    },
  };
}

/** The phone listener's port, kept so phones find the same address after a restart. */
export function phonePortFile(dir: string) {
  const file = path.join(dir, "remote-phone-port");
  return {
    load(): number | undefined {
      try {
        const port = Number(readFileSync(file, "utf8").trim());
        return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
      } catch {
        return undefined;
      }
    },
    save(port: number): void {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, String(port), { mode: 0o600 });
    },
  };
}

/** The SHA-256 a phone compares against, from a PEM certificate. */
export function certificateFingerprint(pem: string): string {
  return createHash("sha256").update(new X509Certificate(pem).raw).digest("hex");
}

/**
 * Reads this computer's identity from `dir`, creating it on first use. A
 * certificate that no longer parses or has expired is replaced, which ends
 * existing phone pairings — the same as revoking them.
 */
export function loadOrCreateTlsIdentity(dir: string, commonName?: string): TlsIdentity {
  const keyPath = path.join(dir, "remote-tls-key.pem");
  const certPath = path.join(dir, "remote-tls-cert.pem");
  if (existsSync(keyPath) && existsSync(certPath)) {
    try {
      const key = readFileSync(keyPath, "utf8");
      const cert = readFileSync(certPath, "utf8");
      if (new Date(new X509Certificate(cert).validTo).getTime() > Date.now() + 24 * 60 * 60_000) {
        return { key, cert, fingerprint: certificateFingerprint(cert) };
      }
    } catch {
      // Unreadable or corrupt: make a new one below.
    }
  }
  mkdirSync(dir, { recursive: true });
  const identity = createTlsIdentity(commonName);
  writeFileSync(keyPath, identity.key, { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  writeFileSync(certPath, identity.cert, { mode: 0o644 });
  return identity;
}
