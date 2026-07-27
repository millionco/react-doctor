import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import {
  resolveModuleFileFromAbsolutePath,
  resolveRelativeImportPath,
} from "../../plugin/utils/resolve-relative-import-path.js";
import { normalizeFilename } from "../../plugin/utils/normalize-filename.js";
import { resolveTsconfigAliasPath } from "../../plugin/utils/resolve-tsconfig-alias.js";
import { createInMemoryResourceHost } from "./in-memory-resource-host.js";
import { createRealFilesystemResourceHost } from "./real-resource-host.js";
import type { ResourceHost } from "./resource-host.js";

interface ResourceHostContractSnapshot {
  readonly normalizedPath: string;
  readonly sourceText: string | null;
  readonly manifestName: unknown;
  readonly invalidManifest: unknown;
  readonly fileKind: string | null;
  readonly directoryKind: string | null;
  readonly missingKind: string | null;
  readonly hasFile: boolean;
  readonly hasDirectory: boolean;
  readonly boundedEntries: ReadonlyArray<string>;
  readonly didReachDirectoryLimit: boolean;
  readonly zeroLimitEntries: ReadonlyArray<string>;
  readonly didReachZeroLimit: boolean;
  readonly missingDirectoryEntries: ReadonlyArray<string>;
  readonly relativeModulePath: string | null;
  readonly absoluteModuleFilePath: string | null;
  readonly directoryModulePath: string | null;
  readonly aliasModulePath: string | null;
  readonly genericRelativeModulePath: string | null;
  readonly genericAliasModulePath: string | null;
  readonly absoluteModulePath: string | null;
  readonly owningPackageDirectory: string | null;
  readonly owningPackageName: unknown;
  readonly runtimeDependency: unknown;
  readonly developmentDependency: unknown;
  readonly missingDependency: unknown;
}

const VIRTUAL_ROOT_DIRECTORY = "/virtual-project";

const FIXTURE_FILES = new Map<string, string>([
  [
    "package.json",
    JSON.stringify({
      name: "workspace",
      private: true,
      dependencies: { react: "^19.0.0" },
    }),
  ],
  ["node_modules/react/package.json", JSON.stringify({ name: "react", version: "19.1.1" })],
  [
    "packages/app/package.json",
    JSON.stringify({
      name: "@fixture/app",
      dependencies: { react: "workspace:^" },
      devDependencies: { vitest: "^3.0.0" },
    }),
  ],
  [
    "packages/app/tsconfig.base.json",
    `{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@/*": ["./src/*"],
        },
      },
    }`,
  ],
  ["packages/app/tsconfig.json", JSON.stringify({ extends: "./tsconfig.base.json" })],
  ["packages/app/src/page.tsx", "export const Page = () => null;\n"],
  ["packages/app/src/components/card.tsx", "export const Card = () => null;\n"],
  ["packages/app/src/widgets/package.json", JSON.stringify({ exports: "./entry.js" })],
  ["packages/app/src/widgets/entry.ts", "export const Widget = () => null;\n"],
  ["packages/app/src/list/a.ts", "export {};\n"],
  ["packages/app/src/list/b.ts", "export {};\n"],
  ["packages/app/src/list/c.ts", "export {};\n"],
  ["packages/app/src/invalid-package.json", "{ invalid json\n"],
]);

const writeFixtureFiles = (rootDirectory: string): void => {
  for (const [relativeFilePath, sourceText] of FIXTURE_FILES) {
    const absoluteFilePath = path.join(rootDirectory, relativeFilePath);
    fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
    fs.writeFileSync(absoluteFilePath, sourceText, "utf8");
  }
  fs.mkdirSync(path.join(rootDirectory, "packages/app/src/empty"), { recursive: true });
};

const toProjectRelativePath = (
  resourceHost: ResourceHost,
  resourcePath: string | null,
): string | null =>
  resourcePath === null
    ? null
    : resourceHost
        .normalizePath(resourcePath)
        .slice(resourceHost.rootDirectory.length)
        .replace(/^\/+/, "");

const toRequiredProjectRelativePath = (resourceHost: ResourceHost, resourcePath: string): string =>
  resourceHost
    .normalizePath(resourcePath)
    .slice(resourceHost.rootDirectory.length)
    .replace(/^\/+/, "");

const captureResourceHostContract = (resourceHost: ResourceHost): ResourceHostContractSnapshot => {
  const sourceFilePath = "packages\\app\\src\\page.tsx";
  const owningPackage = resourceHost.findOwningPackage(sourceFilePath);
  const runtimeDependency = resourceHost.getDependency(sourceFilePath, "react");
  const developmentDependency = resourceHost.getDependency(sourceFilePath, "vitest");
  const boundedListing = resourceHost.listDirectory("packages/app/src/list", 2);
  const zeroLimitListing = resourceHost.listDirectory("packages/app/src/list", 0);
  const normalizedRuntimeDependency = runtimeDependency
    ? {
        ...runtimeDependency,
        packageDirectory: toProjectRelativePath(resourceHost, runtimeDependency.packageDirectory),
      }
    : null;
  const normalizedDevelopmentDependency = developmentDependency
    ? {
        ...developmentDependency,
        packageDirectory: toProjectRelativePath(
          resourceHost,
          developmentDependency.packageDirectory,
        ),
      }
    : null;

  return {
    normalizedPath: toRequiredProjectRelativePath(
      resourceHost,
      resourceHost.normalizePath(sourceFilePath),
    ),
    sourceText: resourceHost.readSource(sourceFilePath),
    manifestName: resourceHost.readManifest("packages/app/package.json")?.name,
    invalidManifest: resourceHost.readManifest("packages/app/src/invalid-package.json"),
    fileKind: resourceHost.getPathKind(sourceFilePath),
    directoryKind: resourceHost.getPathKind("packages/app/src/empty"),
    missingKind: resourceHost.getPathKind("packages/app/src/missing.ts"),
    hasFile: resourceHost.fileExists(sourceFilePath),
    hasDirectory: resourceHost.directoryExists("packages/app/src/empty"),
    boundedEntries: boundedListing.entries.map((directoryEntry) => directoryEntry.name),
    didReachDirectoryLimit: boundedListing.didReachLimit,
    zeroLimitEntries: zeroLimitListing.entries.map((directoryEntry) => directoryEntry.name),
    didReachZeroLimit: zeroLimitListing.didReachLimit,
    missingDirectoryEntries: resourceHost
      .listDirectory("packages/app/src/missing", 2)
      .entries.map((directoryEntry) => directoryEntry.name),
    relativeModulePath: toProjectRelativePath(
      resourceHost,
      resourceHost.resolveRelativeImport(sourceFilePath, "./components/card"),
    ),
    absoluteModuleFilePath: toProjectRelativePath(
      resourceHost,
      resourceHost.resolveModuleFile(
        resourceHost.normalizePath("packages/app/src/components/card"),
      ),
    ),
    directoryModulePath: toProjectRelativePath(
      resourceHost,
      resourceHost.resolveRelativeImport(sourceFilePath, "./widgets"),
    ),
    aliasModulePath: toProjectRelativePath(
      resourceHost,
      resourceHost.resolveTsconfigAlias(sourceFilePath, "@/components/card"),
    ),
    genericRelativeModulePath: toProjectRelativePath(
      resourceHost,
      resourceHost.resolveImport(sourceFilePath, "./components/card"),
    ),
    genericAliasModulePath: toProjectRelativePath(
      resourceHost,
      resourceHost.resolveImport(sourceFilePath, "@/components/card"),
    ),
    absoluteModulePath: resourceHost.resolveImport(sourceFilePath, "/absolute/module"),
    owningPackageDirectory: toProjectRelativePath(
      resourceHost,
      owningPackage?.directoryPath ?? null,
    ),
    owningPackageName: owningPackage?.manifest.name,
    runtimeDependency: normalizedRuntimeDependency,
    developmentDependency: normalizedDevelopmentDependency,
    missingDependency: resourceHost.getDependency(sourceFilePath, "missing"),
  };
};

describe("ResourceHost", () => {
  let temporaryRootDirectory: string;
  let realFilesystemHost: ResourceHost;
  let inMemoryHost: ResourceHost;

  beforeAll(() => {
    temporaryRootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "resource-host-"));
    writeFixtureFiles(temporaryRootDirectory);
    realFilesystemHost = createRealFilesystemResourceHost({
      rootDirectory: temporaryRootDirectory,
    });
    inMemoryHost = createInMemoryResourceHost({
      rootDirectory: VIRTUAL_ROOT_DIRECTORY,
      files: FIXTURE_FILES,
      directories: ["packages/app/src/empty"],
    });
  });

  afterAll(() => {
    fs.rmSync(temporaryRootDirectory, { recursive: true, force: true });
    fs.rmSync(`${temporaryRootDirectory}-outside.ts`, { force: true });
  });

  it("keeps real and in-memory resource semantics exactly aligned", () => {
    expect(captureResourceHostContract(realFilesystemHost)).toEqual(
      captureResourceHostContract(inMemoryHost),
    );
  });

  it("pins the complete normalized resource contract", () => {
    expect(captureResourceHostContract(inMemoryHost)).toEqual({
      normalizedPath: "packages/app/src/page.tsx",
      sourceText: "export const Page = () => null;\n",
      manifestName: "@fixture/app",
      invalidManifest: null,
      fileKind: "file",
      directoryKind: "directory",
      missingKind: null,
      hasFile: true,
      hasDirectory: true,
      boundedEntries: ["a.ts", "b.ts"],
      didReachDirectoryLimit: true,
      zeroLimitEntries: [],
      didReachZeroLimit: true,
      missingDirectoryEntries: [],
      relativeModulePath: "packages/app/src/components/card.tsx",
      absoluteModuleFilePath: "packages/app/src/components/card.tsx",
      directoryModulePath: "packages/app/src/widgets/entry.ts",
      aliasModulePath: "packages/app/src/components/card.tsx",
      genericRelativeModulePath: "packages/app/src/components/card.tsx",
      genericAliasModulePath: "packages/app/src/components/card.tsx",
      absoluteModulePath: null,
      owningPackageDirectory: "packages/app",
      owningPackageName: "@fixture/app",
      runtimeDependency: {
        name: "react",
        packageDirectory: "packages/app",
        section: "dependencies",
        rawSpecifier: "workspace:^",
        installedVersion: "19.1.1",
      },
      developmentDependency: {
        name: "vitest",
        packageDirectory: "packages/app",
        section: "devDependencies",
        rawSpecifier: "^3.0.0",
        installedVersion: null,
      },
      missingDependency: null,
    });
  });

  it("preserves the production relative-import wrapper exactly", () => {
    const sourceFilePath = path.join(temporaryRootDirectory, "packages/app/src/page.tsx");
    const unresolvedTargetPath = path.join(
      temporaryRootDirectory,
      "packages/app/src/components/card",
    );
    expect(
      normalizeFilename(resolveRelativeImportPath(sourceFilePath, "./components/card") ?? ""),
    ).toBe(realFilesystemHost.resolveRelativeImport(sourceFilePath, "./components/card"));
    expect(normalizeFilename(resolveModuleFileFromAbsolutePath(unresolvedTargetPath) ?? "")).toBe(
      realFilesystemHost.resolveRelativeImport(sourceFilePath, "./components/card"),
    );
    expect(resolveTsconfigAliasPath(sourceFilePath, "@/components/card")).toBe(
      realFilesystemHost.resolveTsconfigAlias(sourceFilePath, "@/components/card"),
    );
  });

  it("does not read resources outside the configured root", () => {
    const outsideFilePath = `${temporaryRootDirectory}-outside.ts`;
    fs.writeFileSync(outsideFilePath, "export const secret = true;\n", "utf8");
    expect(realFilesystemHost.readSource(outsideFilePath)).toBeNull();
    expect(realFilesystemHost.fileExists(outsideFilePath)).toBe(false);
  });

  it("accepts explicit package data without manifest resources", () => {
    const resourceHost = createInMemoryResourceHost({
      rootDirectory: "/described-project",
      files: new Map([["packages/app/src/index.ts", "export {};\n"]]),
      packages: [
        {
          directoryPath: "packages/app",
          manifest: {
            name: "@fixture/described-app",
            dependencies: { react: "workspace:^" },
          },
          installedDependencyVersions: { react: "19.1.1" },
        },
      ],
    });

    expect(resourceHost.fileExists("packages/app/package.json")).toBe(false);
    expect(resourceHost.findOwningPackage("packages/app/src/index.ts")).toMatchObject({
      directoryPath: "/described-project/packages/app",
      manifestPath: "/described-project/packages/app/package.json",
      manifest: { name: "@fixture/described-app" },
    });
    expect(resourceHost.getDependency("packages/app/src/index.ts", "react")).toEqual({
      name: "react",
      packageDirectory: "/described-project/packages/app",
      section: "dependencies",
      rawSpecifier: "workspace:^",
      installedVersion: "19.1.1",
    });
  });
});
