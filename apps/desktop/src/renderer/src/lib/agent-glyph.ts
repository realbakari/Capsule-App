import { PROVIDER_MARKS, type ProviderMark } from "./provider-marks";

/*
 * Marks for the agents in the composer's picker.
 *
 * Capsule reaches seventeen ACP harnesses plus whatever agents OpenClaw
 * exposes. The ones with a real mark draw it; the rest draw a monogram tile,
 * because inventing a logo for a product that has its own would misidentify
 * it. See scripts/generate-provider-icons.mjs for where the marks come from.
 */

/**
 * Up to two letters for an agent name: initials for a multi-word name, the
 * first two letters for a single word. "Claude Code" is CC, "Kimi" is KI.
 */
export function agentInitials(name: string): string {
  const words = name.replace(/[_-]+/gu, " ").split(/\s+/u).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join("");
}

/** The drawn mark for an agent id, or undefined when that product has none. */
export function providerMark(id: string | undefined): ProviderMark | undefined {
  if (!id) return undefined;
  return PROVIDER_MARKS[id.toLowerCase()];
}

/*
 * Several marks are registered black, which is invisible on Capsule's
 * surface. A brand colour is only worth using while it still reads, so
 * anything darker than this takes the surrounding text colour instead.
 */
const MIN_RELATIVE_LUMINANCE = 0.12;

/** Perceived lightness of a #rrggbb colour, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const value = hex.replace("#", "");
  const channel = (offset: number) => parseInt(value.slice(offset, offset + 2), 16) / 255;
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

/**
 * The colour to draw an agent's mark in, or undefined to inherit — either
 * because the product has no mark or because its brand colour would vanish.
 */
export function agentAccent(id: string | undefined): string | undefined {
  const mark = providerMark(id);
  if (!mark) return undefined;
  return relativeLuminance(mark.hex) >= MIN_RELATIVE_LUMINANCE ? mark.hex : undefined;
}
