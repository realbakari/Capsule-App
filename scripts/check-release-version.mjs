import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packagePath = resolve(scriptDirectory, "..", "package.json");

export function readPackageVersion() {
  const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
  if (typeof parsed.version !== "string") {
    throw new Error("package.json does not contain a string version");
  }
  return parsed.version;
}

export function validateReleaseVersion(requested, packageVersion = readPackageVersion()) {
  const value = requested ?? packageVersion;
  if (value !== value.trim()) {
    throw new Error("Release version must not contain leading or trailing whitespace");
  }
  const normalised = value.startsWith("v") ? value.slice(1) : value;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(normalised)) {
    throw new Error(`Invalid release version "${value}"`);
  }
  if (normalised !== packageVersion) {
    throw new Error(
      `Release version ${normalised} does not match package.json version ${packageVersion}`
    );
  }
  return normalised;
}

function requestedVersionFromEnvironment() {
  const argument = process.argv[2];
  if (argument !== undefined) return argument;
  if (process.env.GITHUB_EVENT_NAME === "push") return process.env.GITHUB_REF_NAME;
  if (process.env.RELEASE_VERSION) return process.env.RELEASE_VERSION;
  return undefined;
}

function main() {
  try {
    const version = validateReleaseVersion(requestedVersionFromEnvironment());
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `version=${version}\n`);
    }
    process.stdout.write(`${version}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
