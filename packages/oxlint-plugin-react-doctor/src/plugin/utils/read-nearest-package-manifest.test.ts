import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { classifyPackagePlatform } from "./classify-package-platform.js";
import { collectCrossFileProbes } from "./cross-file-probe-recorder.js";
import { isInsideNodeCliPackage } from "./is-inside-node-cli-package.js";
import { isPublishedLibraryPackage } from "./is-published-library-package.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
  resetManifestCaches,
} from "./read-nearest-package-manifest.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-manifest-reader-"));
  resetManifestCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const writeFixtureFile = (relativePath: string, contents: string): string => {
  const absolutePath = path.join(temporaryDirectory, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents, "utf8");
  return absolutePath;
};

describe("readNearestPackageManifest", () => {
  it("parses the nearest manifest and shares one cached object per package", () => {
    writeFixtureFile("package.json", `{ "bin": "cli.js" }\n`);
    const firstFile = writeFixtureFile("src/a.ts", "export {};\n");
    const secondFile = writeFixtureFile("src/deep/b.ts", "export {};\n");

    const firstManifest = readNearestPackageManifest(firstFile);
    const secondManifest = readNearestPackageManifest(secondFile);
    expect(firstManifest?.bin).toBe("cli.js");
    expect(secondManifest).toBe(firstManifest);
  });

  it("returns null for a missing or unparseable manifest", () => {
    writeFixtureFile("package.json", "{ not json\n");
    const filePath = writeFixtureFile("src/a.ts", "export {};\n");
    expect(readNearestPackageManifest(filePath)).toBeNull();
  });

  it("records the content probe on cache hits too (sidecar soundness)", () => {
    writeFixtureFile("package.json", `{ "dependencies": { "expo": "^50.0.0" } }\n`);
    const filePath = writeFixtureFile("src/a.ts", "export {};\n");
    readNearestPackageManifest(filePath);

    const warmTrace = collectCrossFileProbes(() => {
      readNearestPackageManifest(filePath);
    });
    expect(warmTrace.contentPaths.has(path.join(temporaryDirectory, "package.json"))).toBe(true);
    expect(warmTrace.existencePaths.has(path.join(temporaryDirectory, "src/package.json"))).toBe(
      true,
    );
  });
});

describe("resetManifestCaches (per-scan staleness)", () => {
  it("picks up an edited manifest after a reset — and only after", () => {
    const manifestPath = writeFixtureFile("package.json", `{ "name": "app" }\n`);
    const filePath = writeFixtureFile("src/a.ts", "export {};\n");
    expect(isInsideNodeCliPackage(filePath)).toBe(false);

    fs.writeFileSync(manifestPath, `{ "name": "app", "bin": "cli.js" }\n`, "utf8");
    // Within one scan the memo is authoritative: the filesystem is frozen.
    expect(isInsideNodeCliPackage(filePath)).toBe(false);

    resetManifestCaches();
    expect(isInsideNodeCliPackage(filePath)).toBe(true);
  });

  it("re-anchors the directory walk when a closer package.json appears", () => {
    writeFixtureFile("package.json", `{ "dependencies": { "next": "14.0.0" } }\n`);
    const filePath = writeFixtureFile("packages/mobile/src/a.ts", "export {};\n");
    expect(findNearestPackageDirectory(filePath)).toBe(temporaryDirectory);
    expect(classifyPackagePlatform(filePath)).toBe("web");

    writeFixtureFile(
      "packages/mobile/package.json",
      `{ "dependencies": { "react-native": "0.74.0" } }\n`,
    );
    resetManifestCaches();
    expect(findNearestPackageDirectory(filePath)).toBe(
      path.join(temporaryDirectory, "packages/mobile"),
    );
    expect(classifyPackagePlatform(filePath)).toBe("react-native");
  });

  it("refreshes every consolidated consumer from the one manifest cache", () => {
    const manifestPath = writeFixtureFile(
      "package.json",
      `{ "peerDependencies": { "react": "^18.0.0" } }\n`,
    );
    const filePath = writeFixtureFile("src/a.ts", "export {};\n");
    expect(isPublishedLibraryPackage(filePath)).toBe(true);
    expect(classifyPackagePlatform(filePath)).toBe("neutral");

    fs.writeFileSync(manifestPath, `{ "private": true, "dependencies": { "next": "14.0.0" } }\n`);
    resetManifestCaches();
    expect(isPublishedLibraryPackage(filePath)).toBe(false);
    expect(classifyPackagePlatform(filePath)).toBe("web");
  });
});
