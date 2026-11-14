#!/usr/bin/env node
/*
 * Test a plugin without the app.
 *
 *   node scripts/capsule-plugin.mjs validate <dir>
 *     Runs the checks the install screen runs and prints what the plugin adds.
 *     Exits 1 when the plugin has an error.
 *
 *   node scripts/capsule-plugin.mjs run-command <dir> <name> [args…] [--fixture <dir>] [--set KEY=VALUE…]
 *     Prints the prompt the command expands to, with ${PLUGIN_ROOT} and options
 *     filled in, as if typed in a conversation whose folder is the fixture.
 *     Shell spans are shown as [output of: …], not run, and no agent is involved.
 *
 * The plugin reader is TypeScript whose imports name `.js` files, which Node's
 * type stripping cannot resolve, so it is bundled with esbuild in memory.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bundle = await build({
  stdin: {
    contents: [
      'export { readPluginFolder } from "./packages/config/src/plugins.ts";',
      'export { listResourceFolder } from "./packages/config/src/resources.ts";',
      'export { commandNameFromPath, expandCommandTemplate, parseCommandFile, spliceShellOutputs, substitutePluginVariables } from "./packages/shared/src/index.ts";',
    ].join("\n"),
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  write: false,
  format: "esm",
  platform: "node",
  alias: {
    "@capsule/shared": path.join(root, "packages/shared/src/index.ts"),
    "@capsule/filesystem": path.join(root, "packages/filesystem/src/index.ts"),
  },
  // jsonc-parser's default entry is a UMD build that requires its own files at run time.
  mainFields: ["module", "main"],
  logLevel: "silent",
});
const lib = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);

const [command, dir, ...rest] = process.argv.slice(2);
const usage = () => {
  console.error("usage: capsule-plugin.mjs validate <dir>\n       capsule-plugin.mjs run-command <dir> <name> [args…] [--fixture <dir>] [--set KEY=VALUE…]");
  process.exit(2);
};
if (!dir || !["validate", "run-command"].includes(command)) usage();
const pluginDir = path.resolve(dir);

function printProblems(reading) {
  for (const problem of reading.problems) {
    const where = [path.relative(pluginDir, problem.path) || "capsule-plugin.json", problem.key].filter(Boolean).join(" · ");
    console.log(`  ${problem.severity === "error" ? "error  " : "warning"} ${where}: ${problem.message}`);
  }
}

if (command === "validate") {
  const reading = lib.readPluginFolder(pluginDir);
  const { manifest, contents } = reading;
  if (manifest) console.log(`${manifest.name} ${manifest.version} by ${manifest.author.name}\n${manifest.description}\n`);
  const section = (title, lines) => {
    if (lines.length === 0) return;
    console.log(`${title} (${lines.length})`);
    for (const line of lines) console.log(`  ${line}`);
  };
  section("Hooks", contents.hooks.map((hook) => `${hook.event}${hook.matcher ? ` (${hook.matcher})` : ""}: ${hook.run}`));
  section("Commands", contents.commands.map((item) => `/${item.name}${item.shell.length ? `  runs: ${item.shell.join("; ")}` : ""}`));
  section("MCP servers", contents.mcpServers.map((server) => `${server.name} [${server.transport}]: ${server.detail}`));
  if (contents.statusLine) section("Status line", [`${contents.statusLine.items.join(", ") || "no items"}${contents.statusLine.command ? `  runs: ${contents.statusLine.command}` : ""}`]);
  section("Themes", contents.themes.map((theme) => `${theme.name} (${theme.appearance})${theme.backdrop ? `, backdrop ${theme.backdrop}` : ""}`));
  section("Profiles", contents.profiles.map((item) => `${item.name} (${item.id})`));
  section("Styles", contents.styles.map((item) => `${item.name} (${item.id})`));
  section("Skills", contents.skills.map((item) => item.name));
  section("Options", (manifest?.userConfig ?? []).map((option) => `${option.key}: ${option.type}${option.required ? ", required" : ""}${option.default !== undefined ? `, default ${JSON.stringify(option.default)}` : ""}`));
  if (reading.problems.length) {
    console.log("\nProblems");
    printProblems(reading);
  }
  const failed = !manifest || reading.problems.some((problem) => problem.severity === "error");
  console.log(failed ? "\nNot installable." : "\nValid.");
  process.exit(failed ? 1 : 0);
}

const [name, ...tail] = rest;
if (!name) usage();
const args = [];
const values = {};
let fixture = process.cwd();
for (let index = 0; index < tail.length; index++) {
  if (tail[index] === "--fixture") fixture = path.resolve(tail[++index] ?? ".");
  else if (tail[index] === "--set") {
    const [key, ...value] = (tail[++index] ?? "").split("=");
    values[key] = value.join("=");
  } else args.push(tail[index]);
}
const reading = lib.readPluginFolder(pluginDir);
if (!reading.manifest) {
  printProblems(reading);
  process.exit(1);
}
const options = reading.manifest.userConfig;
for (const option of options) if (!(option.key in values) && option.default !== undefined) values[option.key] = String(option.default);
const variables = {
  root: pluginDir,
  data: path.join(pluginDir, ".plugin-data"),
  values: Object.fromEntries(Object.entries(values).filter(([key]) => options.find((option) => option.key === key)?.type !== "secret")),
  secrets: new Set(options.filter((option) => option.type === "secret").map((option) => option.key)),
};
const file = reading.folders.commands && lib.listResourceFolder("commands", "user", reading.folders.commands).find((entry) => lib.commandNameFromPath(entry.name) === name);
if (!file) {
  console.error(`${reading.manifest.name} has no command named /${name}.`);
  process.exit(1);
}
const filled = lib.substitutePluginVariables(file.text, reading.manifest.name, variables, "text");
for (const message of filled.problems) console.error(`warning: ${message}`);
const parsed = lib.parseCommandFile(name, filled.text);
if (!parsed.command) {
  for (const message of parsed.problems) console.error(`error: ${message}`);
  process.exit(1);
}
const expanded = lib.expandCommandTemplate(parsed.command, args.join(" "), { projectDir: fixture });
console.log(lib.spliceShellOutputs(expanded.text, new Map(expanded.shell.map((span) => [span.token, `[output of: ${span.command}]`]))));
