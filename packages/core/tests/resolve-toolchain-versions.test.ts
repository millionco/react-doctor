import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
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

  it("fingerprints a custom native binding independently from stock Oxlint", () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-binding-"));
    const nativeBindingPath = path.join(temporaryDirectory, "oxlint.node");
    try {
      fs.writeFileSync(nativeBindingPath, "native-binding");
      const stockVersions = resolveOxlintToolchainVersions();
      const nativeVersions = resolveOxlintToolchainVersions(process.execPath, nativeBindingPath);

      expect(stockVersions).toContain("oxlint-native-binding#fingerprint=stock");
      expect(nativeVersions).toContain("oxlint-native-binding#fingerprint=f90b6a879ed766d3");
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });
});
