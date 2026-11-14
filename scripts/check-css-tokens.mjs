#!/usr/bin/env node
/*
 * Two ways the renderer's colours drift out of the theme:
 *
 * 1. A `var(--name)` that nothing defines and that has no fallback. The
 *    property silently drops: a border falls back to the text colour, a
 *    background disappears. Custom properties may be defined in any CSS file
 *    or set from a component (`"--name": value`), so both count.
 * 2. Raw colour literals (hex, rgb/rgba) in the app's stylesheets. They do not
 *    follow the light and dark themes. Existing ones are a recorded debt; the
 *    count may only go down.
 *
 * Run by `pnpm lint`. `--update` lowers the recorded raw-colour count after a
 * cleanup; it refuses to raise it.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const renderer = path.join(root, "apps/desktop/src/renderer/src");
const tokens = path.join(root, "packages/ui/src/tokens.css");
const baselineFile = path.join(root, "scripts/css-colour-baseline.json");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "testing" || name === "node_modules") continue;
      walk(full, out);
    } else out.push(full);
  }
  return out;
}

const files = walk(renderer);
/* The public website styles itself and is not part of the app's themes. */
const appCss = files.filter((file) => file.endsWith(".css") && !file.includes(`${path.sep}landing${path.sep}`));
const code = files.filter((file) => /\.(tsx?|jsx?)$/.test(file)).map((file) => readFileSync(file, "utf8")).join("\n");
const cssByFile = new Map([...appCss, tokens].map((file) => [file, readFileSync(file, "utf8")]));
const allCss = [...cssByFile.values()].join("\n");

const defined = new Set();
for (const match of allCss.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) defined.add(match[1]);
for (const match of code.matchAll(/["'`](--[a-zA-Z0-9-]+)["'`]/g)) defined.add(match[1]);

const problems = [];
for (const [file, text] of cssByFile) {
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)\s*(,)?/g)) {
      if (!defined.has(match[1]) && !match[2]) problems.push(`${path.relative(root, file)}:${index + 1} uses ${match[1]}, which nothing defines and which has no fallback`);
    }
  });
}

/* These hold bare HSL channels for hsl(var(--x)); used directly as a colour they are invalid. */
const CHANNEL_TOKENS = ["border", "muted", "background", "foreground", "card", "primary", "primary-foreground", "muted-foreground", "sidebar-background", "sidebar-foreground"];
const channel = new RegExp(`(?<!hsla?\\(\\s*)var\\(--(${CHANNEL_TOKENS.join("|")})\\s*[,)]`, "g");
for (const [file, text] of cssByFile) {
  if (file === tokens) continue;
  text.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(channel)) problems.push(`${path.relative(root, file)}:${index + 1} uses --${match[1]} as a colour; it holds HSL channels. Use hsl(var(--${match[1]})) or a colour token such as --border-color or --text-muted`);
  });
}

/* --focus-ring is a whole outline ("2px solid …"). Inside another outline or as a colour it makes the declaration invalid, and the focus ring silently disappears. */
for (const [file, text] of cssByFile) {
  text.split("\n").forEach((line, index) => {
    if (/(?:solid|dashed|dotted|color:|shadow:)[^;]*var\(--focus-ring\)/.test(line)) problems.push(`${path.relative(root, file)}:${index + 1} uses --focus-ring as a colour; it is a whole outline. Write outline: var(--focus-ring), or use --ring for the colour`);
  });
}

/* A declaration whose parentheses do not balance is dropped by the browser without a word. */
for (const [file, text] of cssByFile) {
  const body = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  for (const block of body.matchAll(/\{([^{}]*)\}/g)) {
    const start = body.slice(0, block.index).split("\n").length;
    for (const declaration of block[1].split(";")) {
      if (!declaration.includes(":")) continue;
      const opens = (declaration.match(/\(/g) ?? []).length;
      const closes = (declaration.match(/\)/g) ?? []).length;
      if (opens !== closes) problems.push(`${path.relative(root, file)}:${start} has a declaration with unbalanced parentheses: ${declaration.trim().slice(0, 80)}`);
    }
  }
}

/*
 * Type and corners come from the scales in tokens.css. A small font size or a
 * corner radius written as a raw number is a new step off the scale. Display
 * sizes (0.9375rem and up), em sizes, percentages and hairline radii under
 * 4px are allowed.
 */
for (const [file, text] of cssByFile) {
  if (file === tokens) continue;
  const body = text.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  body.split("\n").forEach((line, index) => {
    for (const match of line.matchAll(/font-size:\s*(\d*\.?\d+)(rem|px)\b/g)) {
      const rem = match[2] === "px" ? Number(match[1]) / 16 : Number(match[1]);
      if (rem < 0.9) problems.push(`${path.relative(root, file)}:${index + 1} sets font-size ${match[1]}${match[2]}; use a --text-* token`);
    }
    const radius = /border(?:-[a-z]+)*-radius:\s*([^;}]+)/.exec(line);
    if (radius) {
      for (const value of radius[1].matchAll(/(?<![\w.-])(\d*\.?\d+)(rem|px)\b/g)) {
        const px = value[2] === "px" ? Number(value[1]) : Number(value[1]) * 16;
        if (px >= 4) problems.push(`${path.relative(root, file)}:${index + 1} sets a radius of ${value[1]}${value[2]}; use a --radius-* token`);
      }
    }
  });
}

const colour = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d/g;
let raw = 0;
const perFile = {};
for (const [file, text] of cssByFile) {
  if (file === tokens) continue;
  /* Comments may quote a colour without using it. */
  const body = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const count = (body.match(colour) ?? []).length;
  perFile[path.relative(root, file)] = count;
  raw += count;
}

let baseline = { rawColours: Infinity };
try { baseline = JSON.parse(readFileSync(baselineFile, "utf8")); } catch { /* First run writes it. */ }

if (process.argv.includes("--update")) {
  if (raw > baseline.rawColours) {
    console.error(`Refusing to raise the raw colour baseline from ${baseline.rawColours} to ${raw}. Use theme tokens instead.`);
    process.exit(1);
  }
  writeFileSync(baselineFile, `${JSON.stringify({ rawColours: raw, perFile }, null, 2)}\n`);
  console.log(`Raw colour baseline is now ${raw}.`);
}

if (raw > baseline.rawColours) {
  problems.push(`Raw colour literals in app CSS rose from ${baseline.rawColours} to ${raw}. Use a theme token (packages/ui/src/tokens.css) instead.`);
}

if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`CSS tokens resolve; ${raw} raw colour literal(s) remain (baseline ${baseline.rawColours}).`);
