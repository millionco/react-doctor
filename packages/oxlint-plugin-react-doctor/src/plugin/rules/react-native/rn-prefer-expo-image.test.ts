import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnPreferExpoImage } from "./rn-prefer-expo-image.js";

const code = `import { Image } from "react-native";
`;

describe("rn-prefer-expo-image", () => {
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rn-expo-image-"));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const createPackageFilename = (dependencies: Record<string, string>): string => {
    const packageDirectory = fs.mkdtempSync(path.join(temporaryDirectory, "package-"));
    fs.writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify({ dependencies }));
    return path.join(packageDirectory, "src", "App.tsx");
  };

  const createStandaloneFilename = (): string =>
    path.join(temporaryDirectory, "standalone", "App.tsx");

  it("flags react-native Image imports in Expo projects", () => {
    const result = runRule(rnPreferExpoImage, code, {
      filename: createStandaloneFilename(),
      settings: { "react-doctor": { framework: "expo" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag react-native Image imports in bare React Native projects", () => {
    const result = runRule(rnPreferExpoImage, code, {
      filename: createStandaloneFilename(),
      settings: { "react-doctor": { framework: "react-native" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the nearest package.json to keep bare React Native workspaces quiet", () => {
    const result = runRule(rnPreferExpoImage, code, {
      filename: createPackageFilename({ "react-native": "0.82.0" }),
      settings: { "react-doctor": { framework: "expo" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the nearest package.json to allow Expo-managed workspaces", () => {
    const result = runRule(rnPreferExpoImage, code, {
      filename: createPackageFilename({ expo: "54.0.0", "react-native": "0.82.0" }),
      settings: { "react-doctor": { framework: "react-native" } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
