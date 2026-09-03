/**
 * GitHub avatars, fetched here and inlined.
 *
 * The renderer's CSP allows images from itself and `data:` only, so a pull
 * request showed every author as a blank. Widening it to reach github.com
 * would work, and would also put the renderer on the network on every pull
 * request view — one request per person, to a host the renderer otherwise
 * never talks to. Fetching in the main process and handing over a data URI
 * keeps the CSP as tight as it was.
 *
 * Everything here fails quietly. An avatar is decoration: offline, rate
 * limited, or behind a proxy that refuses, the caller gets nothing and the
 * interface falls back to initials.
 */

const AVATAR_SIZE = 48;
/** Well under any sane avatar; a bigger response is not one. */
const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 4000;
/*
 * A day. An avatar changes rarely, and the cost of being a day stale is that
 * someone's new photograph arrives tomorrow.
 */
const TTL_MS = 86_400_000;

interface CachedAvatar {
  /** A data URI, or undefined when the fetch failed. */
  value?: string;
  at: number;
}

const cache = new Map<string, CachedAvatar>();
const inFlight = new Map<string, Promise<string | undefined>>();

/** Forgets what was fetched, for a Doctor run or a test. */
export function clearAvatarCache(): void {
  cache.clear();
  inFlight.clear();
}

/*
 * A GitHub login: alphanumerics and hyphens. Checked before it goes into a
 * URL, so a name read out of a JSON response cannot steer the request
 * somewhere else.
 */
function isLogin(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value);
}

function contentType(response: { headers: { get(name: string): string | null } }): string {
  const raw = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
  // Only real image types, so a redirect to an HTML error page cannot become
  // an <img src> that the renderer tries to parse.
  return raw === "image/png" || raw === "image/jpeg" || raw === "image/gif" || raw === "image/webp"
    ? raw
    : "";
}

async function fetchAvatar(login: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://github.com/${login}.png?size=${AVATAR_SIZE}`, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const type = contentType(response);
    if (!type) return undefined;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_BYTES) return undefined;
    return `data:${type};base64,${Buffer.from(buffer).toString("base64")}`;
  } catch {
    // Offline, refused, timed out: all the same answer, which is initials.
    return undefined;
  }
}

async function avatarFor(login: string): Promise<string | undefined> {
  const cached = cache.get(login);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const existing = inFlight.get(login);
  if (existing) return existing;
  const started = fetchAvatar(login).then((value) => {
    inFlight.delete(login);
    cache.set(login, { value, at: Date.now() });
    return value;
  });
  inFlight.set(login, started);
  return started;
}

/**
 * Avatars for `logins`, as data URIs, keyed by login.
 *
 * Logins with no avatar are simply absent. All of them are fetched at once —
 * a pull request has a handful of people on it, and doing them in sequence
 * would add a round trip each to a view that is already waiting on GitHub.
 */
export async function avatarsFor(logins: Iterable<string>): Promise<Record<string, string>> {
  const wanted = [...new Set(logins)].filter(isLogin);
  if (wanted.length === 0) return {};
  const results = await Promise.all(
    wanted.map(async (login) => [login, await avatarFor(login)] as const),
  );
  const out: Record<string, string> = {};
  for (const [login, value] of results) {
    if (value) out[login] = value;
  }
  return out;
}
