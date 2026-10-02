/** A reverse proxy may terminate TLS, but only an explicit origin is trusted. */
export function publicOrigin(value?: string): string | undefined {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("The remote public URL must be an HTTPS origin without a path or credentials.");
  }
  return url.origin;
}

export function loopback(address?: string): boolean {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function trustedOrigin(origin: string | undefined, local: string, external?: string): boolean {
  // Native clients have no Origin. Browser clients must match exactly.
  return !origin || origin === local || origin === external;
}

export function secureControl(origin: string | undefined, local: string, external: string | undefined, address?: string): boolean {
  // Remote control crosses plaintext only inside the host, behind its TLS proxy.
  return loopback(address) && (origin === external && external !== undefined || origin === local);
}
