import { describe, expect, it } from "vite-plus/test";
import { resolveOxlintToolchainVersions } from "../src/runners/oxlint/resolve-toolchain-versions.js";

describe("resolveOxlintToolchainVersions", () => {
  it("includes a content fingerprint entry for the rule plugin", () => {
    const versions = resolveOxlintToolchainVersions();
    const fingerprintEntries = versions.filter((entry) =>
      entry.startsWith("oxlint-plugin-react-doctor#fingerprint="),
    );
    expect(fingerprintEntries).toHaveLength(1);
    expect(fingerprintEntries[0]).toMatch(/^oxlint-plugin-react-doctor#fingerprint=[0-9a-f]{16}$/);
  });

  it("returns a deterministic fingerprint across calls", () => {
    expect(resolveOxlintToolchainVersions()).toEqual(resolveOxlintToolchainVersions());
  });

  it("keeps the version entries the ruleset hash already depended on", () => {
    const versions = resolveOxlintToolchainVersions();
    expect(versions.some((entry) => entry.startsWith("node="))).toBe(true);
    expect(versions.some((entry) => entry.startsWith("oxlint/package.json="))).toBe(true);
    expect(
      versions.some((entry) => entry.startsWith("oxlint-plugin-react-doctor/package.json=")),
    ).toBe(true);
  });
});
