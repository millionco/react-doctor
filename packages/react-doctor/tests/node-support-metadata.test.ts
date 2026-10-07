import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vite-plus/test";

interface PackageJson {
  readonly engines?: {
    readonly node?: string;
  };
  readonly dependencies?: Record<string, string>;
  readonly devDependencies?: Record<string, string>;
}

interface PackageManifestExpectation {
  readonly packagePath: string;
  readonly shouldDependOnPlatformNodeShared: boolean;
  readonly shouldDependOnEffect: boolean;
}

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const SUPPORTED_NODE_RANGE = "^20.19.0 || >=22.13.0";

const readText = (relativePath: string): string =>
  fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath), "utf8");

const readPackageJson = (relativePath: string): PackageJson => JSON.parse(readText(relativePath));

const packageManifests: PackageManifestExpectation[] = [
  {
    packagePath: "package.json",
    shouldDependOnPlatformNodeShared: false,
    shouldDependOnEffect: true,
  },
  {
    packagePath: "packages/api/package.json",
    shouldDependOnPlatformNodeShared: false,
    shouldDependOnEffect: true,
  },
  {
    packagePath: "packages/core/package.json",
    shouldDependOnPlatformNodeShared: true,
    shouldDependOnEffect: true,
  },
  {
    packagePath: "packages/eslint-plugin-react-doctor/package.json",
    shouldDependOnPlatformNodeShared: false,
    shouldDependOnEffect: false,
  },
  {
    packagePath: "packages/oxlint-plugin-react-doctor/package.json",
    shouldDependOnPlatformNodeShared: false,
    shouldDependOnEffect: false,
  },
  {
    packagePath: "packages/react-doctor/package.json",
    shouldDependOnPlatformNodeShared: false,
    shouldDependOnEffect: false,
  },
];

const packageBuildConfigs = [
  "packages/api/vite.config.ts",
  "packages/core/vite.config.ts",
  "packages/eslint-plugin-react-doctor/vite.config.ts",
  "packages/oxlint-plugin-react-doctor/vite.config.ts",
  "packages/react-doctor/vite.config.ts",
];

describe("Node support metadata", () => {
  const effectVersion = readPackageJson("package.json").dependencies?.effect;

  it("declares the same Node range across package manifests", () => {
    for (const { packagePath } of packageManifests) {
      const packageJson = readPackageJson(packagePath);
      expect(packageJson.engines?.node, packagePath).toBe(SUPPORTED_NODE_RANGE);
    }
  });

  it("keeps the Effect package family aligned without the Undici-backed platform", () => {
    expect(effectVersion).toBeDefined();

    for (const {
      packagePath,
      shouldDependOnPlatformNodeShared,
      shouldDependOnEffect,
    } of packageManifests) {
      const packageJson = readPackageJson(packagePath);
      const dependencies = packageJson.dependencies ?? {};
      const devDependencies = packageJson.devDependencies ?? {};
      expect(dependencies["@effect/platform-node"], packagePath).toBeUndefined();
      expect(devDependencies["@effect/platform-node"], packagePath).toBeUndefined();

      const expectedSharedDependency = shouldDependOnPlatformNodeShared ? effectVersion : undefined;
      expect(dependencies["@effect/platform-node-shared"], packagePath).toBe(
        expectedSharedDependency,
      );

      const expectedEffectDependency = shouldDependOnEffect ? effectVersion : undefined;
      expect(dependencies.effect, packagePath).toBe(expectedEffectDependency);
    }
  });

  it("keeps published package builds targeting Node 20", () => {
    for (const configPath of packageBuildConfigs) {
      const config = readText(configPath);
      expect(config, configPath).toContain('target: "node20"');
      expect(config, configPath).not.toContain('target: "node22"');
    }
  });

  it("keeps Node 22-only Undici out of the lockfile", () => {
    const lockfile = readText("pnpm-lock.yaml");
    expect(lockfile).not.toMatch(/\n\s+'?@effect\/platform-node@/);
    expect(lockfile).not.toMatch(/\n\s+undici@8\./);
  });
});
