#!/usr/bin/env node
/*
 * Writes schemas/settings.schema.json from the key registry in
 * packages/shared/src/settings-schema.ts, so editors complete and check a
 * settings file against exactly the keys Capsule reads.
 *
 * The registry is TypeScript whose imports name `.js` files, which Node's
 * type stripping cannot resolve, so it is bundled with esbuild in memory.
 *
 * Usage: node scripts/gen-settings-schema.mjs [--check]
 * `--check` writes nothing and exits 1 when the committed schema is stale.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = path.join(root, "packages/shared/src");
const schemaFile = path.join(root, "schemas/settings.schema.json");

const bundle = await build({
  stdin: {
    contents: 'export { settingsJsonSchema } from "./settings-schema.js"; export { SETTINGS_SCHEMA_URL } from "./config.js";',
    resolveDir: shared,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  logLevel: "silent",
});
const { settingsJsonSchema, SETTINGS_SCHEMA_URL } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const expected = `${JSON.stringify({ $id: SETTINGS_SCHEMA_URL, ...settingsJsonSchema() }, null, 2)}\n`;

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(schemaFile, "utf8");
  } catch {
    // Missing counts as stale.
  }
  if (current !== expected) {
    console.error("schemas/settings.schema.json is out of date with the settings registry. Run node scripts/gen-settings-schema.mjs.");
    process.exit(1);
  }
} else {
  mkdirSync(path.dirname(schemaFile), { recursive: true });
  writeFileSync(schemaFile, expected);
  console.log(`Wrote ${path.relative(root, schemaFile)}`);
}
