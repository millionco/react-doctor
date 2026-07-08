import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { resetManifestCaches } from "../../utils/read-nearest-package-manifest.js";
import { rnNoLegacyShadowStyles } from "./rn-no-legacy-shadow-styles.js";

const shadowStyleCode = `import { StyleSheet } from "react-native";
const styles = StyleSheet.create({
  card: { shadowOpacity: 0.2, shadowRadius: 8 },
});`;

interface PackageFixture {
  readonly reactNativeVersion?: string;
  readonly gradleProperties?: string;
  readonly appJson?: object;
  readonly dynamicAppConfig?: boolean;
}

describe("react-native/rn-no-legacy-shadow-styles — regressions", () => {
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rn-legacy-shadow-"));
    resetManifestCaches();
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const createPackageFilename = (fixture: PackageFixture): string => {
    const packageDirectory = fs.mkdtempSync(path.join(temporaryDirectory, "package-"));
    fs.writeFileSync(
      path.join(packageDirectory, "package.json"),
      JSON.stringify({
        dependencies: { "react-native": fixture.reactNativeVersion ?? "0.79.5" },
      }),
    );
    if (fixture.gradleProperties !== undefined) {
      fs.mkdirSync(path.join(packageDirectory, "android"), { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, "android", "gradle.properties"),
        fixture.gradleProperties,
      );
    }
    if (fixture.appJson !== undefined) {
      fs.writeFileSync(path.join(packageDirectory, "app.json"), JSON.stringify(fixture.appJson));
    }
    if (fixture.dynamicAppConfig) {
      fs.writeFileSync(path.join(packageDirectory, "app.config.js"), "module.exports = {};");
    }
    return path.join(packageDirectory, "src", "App.tsx");
  };

  it("stays silent when android/gradle.properties disables the new architecture", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode, {
      filename: createPackageFilename({
        gradleProperties: "hermesEnabled=true\nnewArchEnabled=false\n",
      }),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the declared react-native version predates boxShadow", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode, {
      filename: createPackageFilename({ reactNativeVersion: "0.72.4" }),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a static Expo config disables the new architecture", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode, {
      filename: createPackageFilename({ appJson: { expo: { newArchEnabled: false } } }),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still fires when gradle.properties enables the new architecture", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode, {
      filename: createPackageFilename({
        gradleProperties: "hermesEnabled=true\nnewArchEnabled=true\n",
      }),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still fires when a dynamic app config could override a legacy opt-out", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode, {
      filename: createPackageFilename({
        appJson: { expo: { newArchEnabled: false } },
        dynamicAppConfig: true,
      }),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still fires on a modern react-native package with no opt-out", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode, {
      filename: createPackageFilename({ reactNativeVersion: "0.79.5" }),
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still fires on inline style attributes", () => {
    const result = runRule(
      rnNoLegacyShadowStyles,
      `export const Card = () => <View style={{ shadowColor: "#000", shadowRadius: 4 }} />;`,
      { filename: createPackageFilename({ reactNativeVersion: "0.79.5" }) },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still fires without a filename", () => {
    const result = runRule(rnNoLegacyShadowStyles, shadowStyleCode);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
