import { PROVIDER_MARKS, type ProviderMark } from "./provider-marks";

/*
 * Marks for the agents in the composer's picker.
 *
 * Capsule reaches eighteen ACP harnesses plus whatever agents OpenClaw
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

/**
 * The drawn mark for an agent id, or undefined when that product has none.
 *
 * A harness id may name a variant of a product — `gemini-flash` is the Gemini
 * CLI on one model — and the variant wears the product's mark. Falling back to
 * the part before the first dash keeps that from drawing a "GF" monogram
 * beside the Gemini one.
 */
export function providerMark(id: string | undefined): ProviderMark | undefined {
  if (!id) return undefined;
  const key = id.toLowerCase();
  const exact = PROVIDER_MARKS[key];
  if (exact) return exact;
  const dash = key.indexOf("-");
  return dash > 0 ? PROVIDER_MARKS[key.slice(0, dash)] : undefined;
}

/*
 * A brand colour is only worth using while it still reads on this surface, so
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
  const hex = providerMark(id)?.hex;
  if (!hex) return undefined;
  return relativeLuminance(hex) >= MIN_RELATIVE_LUMINANCE ? hex : undefined;
}
