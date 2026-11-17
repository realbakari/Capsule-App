/*
 * A paired browser names itself by its user agent. Shown raw, every row in
 * the device list reads "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7…",
 * which says nothing about which device to revoke. Older pairings stored that
 * raw string, so the list reads it through here too.
 */
const BROWSERS: Array<[RegExp, string]> = [
  [/Edg(?:e|A|iOS)?\//, "Edge"],
  [/OPR\/|Opera/, "Opera"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/CriOS\/|Chrome\//, "Chrome"],
  [/Safari\//, "Safari"],
];

const SYSTEMS: Array<[RegExp, string]> = [
  [/iPhone/, "iPhone"],
  [/iPad/, "iPad"],
  [/Android/, "Android"],
  [/Macintosh|Mac OS X/, "Mac"],
  [/Windows/, "Windows"],
  [/CrOS/, "ChromeOS"],
  [/Linux/, "Linux"],
];

export function deviceLabel(raw: string): string {
  const label = raw.trim();
  if (!/^Mozilla\/|AppleWebKit|Gecko\//.test(label)) return label || "Paired device";
  const browser = BROWSERS.find(([pattern]) => pattern.test(label))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(label))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? (system ? `Browser on ${system}` : "Browser");
}
