import { describe, expect, it } from "vitest";
import { readPackageVersion, validateAppVersions, validateReleaseVersion } from "./check-release-version.mjs";

describe("app release identity", () => {
  it("keeps repository and packaged desktop versions aligned", () => {
    expect(validateReleaseVersion(undefined)).toBe(readPackageVersion());
  });

  it("refuses a release whose packaged version is older than its tag", () => {
    expect(() => validateAppVersions("1.2.0", "1.1.0")).toThrow("does not match desktop");
    expect(() => validateAppVersions("1.2.0", undefined)).toThrow("string version");
    expect(validateAppVersions("1.2.0", "1.2.0")).toBe("1.2.0");
  });

  it("validates tags without rewriting the running app version", () => {
    expect(validateReleaseVersion("v1.2.0", "1.2.0")).toBe("1.2.0");
    expect(() => validateReleaseVersion("v1.3.0", "1.2.0")).toThrow("does not match");
    expect(() => validateReleaseVersion(" 1.2.0", "1.2.0")).toThrow("whitespace");
  });
});
