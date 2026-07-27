import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { PackageJson } from "../src/types/index.js";
import { collectWorkspaceFacts } from "../src/project-info/collect-project-facts.js";
import { buildPackageGraph } from "../src/project-info/package-graph.js";
import type { PackageGraph } from "../src/project-info/package-graph.js";
import { readPackageJson } from "../src/project-info/package-json.js";

const FIXTURES_DIRECTORY = path.join(import.meta.dirname, "fixtures");
const temporaryDirectories: string[] = [];

interface TemporaryWorkspacePackage {
  readonly relativeDirectory: string;
  readonly packageJson: PackageJson;
}

interface BuildTemporaryGraphOptions {
  readonly rootPackageJson: PackageJson;
  readonly workspacePackages?: ReadonlyArray<TemporaryWorkspacePackage>;
}

const buildFixtureGraph = (fixtureName: string): PackageGraph => {
  const rootDirectory = path.join(FIXTURES_DIRECTORY, fixtureName);
  const rootPackageJson = readPackageJson(path.join(rootDirectory, "package.json"));
  return buildPackageGraph(rootDirectory, rootPackageJson);
};

const buildTemporaryGraph = ({
  rootPackageJson,
  workspacePackages = [],
}: BuildTemporaryGraphOptions): PackageGraph => {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-package-graph-"));
  temporaryDirectories.push(rootDirectory);
  fs.writeFileSync(path.join(rootDirectory, "package.json"), JSON.stringify(rootPackageJson));

  for (const workspacePackage of workspacePackages) {
    const workspaceDirectory = path.join(rootDirectory, workspacePackage.relativeDirectory);
    fs.mkdirSync(workspaceDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(workspaceDirectory, "package.json"),
      JSON.stringify(workspacePackage.packageJson),
    );
  }

  return buildPackageGraph(rootDirectory, rootPackageJson);
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("package graph", () => {
  it("derives exact dependency and framework capabilities for each owning package", () => {
    const graph = buildFixtureGraph("package-local-capabilities");
    const legacyDirectory = path.join(graph.rootDirectory, "packages", "legacy");
    const mobileDirectory = path.join(graph.rootDirectory, "packages", "mobile");
    const modernDirectory = path.join(graph.rootDirectory, "packages", "modern");

    expect(graph.getCapabilities(legacyDirectory)).toEqual(
      new Set(["vite", "react", "react:17", "react:18", "client-only"]),
    );
    expect(graph.getCapabilities(mobileDirectory)).toEqual(
      new Set([
        "expo",
        "react",
        "react-native",
        "expo:54",
        "react:17",
        "react:18",
        "react:19",
        "client-only",
      ]),
    );
    expect(graph.getCapabilities(modernDirectory)).toEqual(
      new Set([
        "nextjs",
        "react",
        "server-actions",
        "ssr",
        "nextjs:15",
        "nextjs:16",
        "react:17",
        "react:18",
        "react:19",
        "react:19.2",
        "tanstack-query",
      ]),
    );
    expect(graph.getCapabilitiesForFile(path.join(modernDirectory, "src", "app.tsx"))).toBe(
      graph.getCapabilities(modernDirectory),
    );
    expect(graph.getCapabilities(path.join(graph.rootDirectory, "packages", "missing"))).toBeNull();
    expect(graph.getCapabilitiesForFile(path.join(FIXTURES_DIRECTORY, "outside.ts"))).toBeNull();
  });

  it("does not invent version capabilities for unresolved catalog or workspace declarations", () => {
    const graph = buildTemporaryGraph({
      rootPackageJson: {
        name: "unresolved-capabilities",
        dependencies: {
          next: "catalog:missing",
          react: "workspace:*",
        },
      },
    });

    expect(graph.getCapabilities(graph.rootDirectory)).toEqual(
      new Set(["nextjs", "react", "server-actions", "ssr"]),
    );
  });

  it.each([
    ["react dependency", { dependencies: { react: "^19.0.0" } }, true],
    ["React Native dev dependency", { devDependencies: { "react-native": "^0.81.0" } }, true],
    ["Next peer dependency", { peerDependencies: { next: "^15.0.0" } }, true],
    ["Preact dependency", { dependencies: { preact: "^10.0.0" } }, true],
    ["React optional dependency", { optionalDependencies: { react: "^19.0.0" } }, false],
    ["non-React package", { dependencies: { vue: "^3.0.0" } }, false],
  ])("pins the %s project classification", (_caseName, dependencies, expected) => {
    const graph = buildTemporaryGraph({
      rootPackageJson: {
        name: "classification",
        ...dependencies,
      },
    });

    expect(graph.rootPackage.hasReactDependency).toBe(expected);
  });

  it("retains package boundaries and finds the deepest owning package", () => {
    const graph = buildFixtureGraph("nested-workspaces");
    const clientDirectory = path.join(
      FIXTURES_DIRECTORY,
      "nested-workspaces",
      "apps",
      "my-app",
      "ClientApp",
    );
    const packageDirectory = path.join(FIXTURES_DIRECTORY, "nested-workspaces", "packages", "ui");

    expect(graph.rootPackage).toBe(graph.packages[0]);
    expect(graph.workspacePatterns).toEqual(["apps/*/ClientApp", "packages/*"]);
    expect(
      graph.packages.map((packageNode) => ({
        directory: packageNode.directory,
        manifestPath: packageNode.manifestPath,
        name: packageNode.name,
        isRoot: packageNode.isRoot,
      })),
    ).toEqual([
      {
        directory: graph.rootDirectory,
        manifestPath: path.join(graph.rootDirectory, "package.json"),
        name: "nested-workspaces-fixture",
        isRoot: true,
      },
      {
        directory: clientDirectory,
        manifestPath: path.join(clientDirectory, "package.json"),
        name: "my-app-client",
        isRoot: false,
      },
      {
        directory: packageDirectory,
        manifestPath: path.join(packageDirectory, "package.json"),
        name: "ui",
        isRoot: false,
      },
    ]);
    expect(graph.findOwningPackage(path.join(clientDirectory, "src", "App.tsx"))?.name).toBe(
      "my-app-client",
    );
    expect(graph.findOwningPackage(path.join(graph.rootDirectory, "README.md"))?.name).toBe(
      "nested-workspaces-fixture",
    );
    expect(graph.findOwningPackage(path.join(FIXTURES_DIRECTORY, "outside.ts"))).toBeNull();
  });

  it("finds the deepest owning package that satisfies a package predicate", () => {
    const graph = buildTemporaryGraph({
      rootPackageJson: {
        name: "predicate-owner",
        workspaces: ["packages/web", "packages/web/tools/generator"],
      },
      workspacePackages: [
        {
          relativeDirectory: "packages/web",
          packageJson: {
            name: "web",
            dependencies: { react: "^19.0.0" },
          },
        },
        {
          relativeDirectory: "packages/web/tools/generator",
          packageJson: {
            name: "generator",
          },
        },
      ],
    });
    const reactPackageDirectory = path.join(graph.rootDirectory, "packages", "web");
    const nestedToolDirectory = path.join(reactPackageDirectory, "tools", "generator");
    const generatedFilePath = path.join(nestedToolDirectory, "src", "index.ts");

    expect(graph.findOwningPackage(generatedFilePath)?.name).toBe("generator");
    expect(
      graph.findOwningPackage(generatedFilePath, (packageNode) => packageNode.hasReactDependency)
        ?.name,
    ).toBe("web");
  });

  it("retains every dependency section in declaration precedence order", () => {
    const rootDirectory = path.join(FIXTURES_DIRECTORY, "dependency-sections");
    const packageJson: PackageJson = {
      name: "dependency-sections",
      dependencies: { react: "19.1.0" },
      devDependencies: { react: "19.2.0" },
      peerDependencies: { react: "^18.3.0" },
      optionalDependencies: { react: "^17.0.0" },
    };
    const graph = buildPackageGraph(rootDirectory, packageJson);

    expect(graph.getDependency(rootDirectory, "react")).toMatchObject({
      section: "dependencies",
      rawSpecifier: "19.1.0",
      resolvedSpecifier: "19.1.0",
      resolutionSource: "manifest",
      resolutionSourceDirectory: rootDirectory,
    });
    expect(
      graph.getDependency(rootDirectory, "react", ["peerDependencies", "devDependencies"]),
    ).toMatchObject({
      section: "peerDependencies",
      rawSpecifier: "^18.3.0",
    });
    expect(graph.getDependencyDeclarations(rootDirectory, "react")).toEqual([
      {
        declaringPackageDirectory: rootDirectory,
        packageName: "react",
        section: "dependencies",
        rawSpecifier: "19.1.0",
        resolvedSpecifier: "19.1.0",
        catalogReference: null,
        resolutionSource: "manifest",
        resolutionSourceDirectory: rootDirectory,
        workspaceTargetPackageDirectory: null,
      },
      {
        declaringPackageDirectory: rootDirectory,
        packageName: "react",
        section: "devDependencies",
        rawSpecifier: "19.2.0",
        resolvedSpecifier: "19.2.0",
        catalogReference: null,
        resolutionSource: "manifest",
        resolutionSourceDirectory: rootDirectory,
        workspaceTargetPackageDirectory: null,
      },
      {
        declaringPackageDirectory: rootDirectory,
        packageName: "react",
        section: "peerDependencies",
        rawSpecifier: "^18.3.0",
        resolvedSpecifier: "^18.3.0",
        catalogReference: null,
        resolutionSource: "manifest",
        resolutionSourceDirectory: rootDirectory,
        workspaceTargetPackageDirectory: null,
      },
      {
        declaringPackageDirectory: rootDirectory,
        packageName: "react",
        section: "optionalDependencies",
        rawSpecifier: "^17.0.0",
        resolvedSpecifier: "^17.0.0",
        catalogReference: null,
        resolutionSource: "manifest",
        resolutionSourceDirectory: rootDirectory,
        workspaceTargetPackageDirectory: null,
      },
    ]);
  });

  it("resolves workspace protocol declarations into package edges", () => {
    const graph = buildTemporaryGraph({
      rootPackageJson: {
        name: "workspace-root",
        workspaces: ["packages/*"],
      },
      workspacePackages: [
        {
          relativeDirectory: "packages/app",
          packageJson: {
            name: "@fixture/app",
            dependencies: {
              "@fixture/shared": "workspace:*",
              "@fixture/unversioned": "workspace:^",
            },
          },
        },
        {
          relativeDirectory: "packages/shared",
          packageJson: { name: "@fixture/shared", version: "1.4.2" },
        },
        {
          relativeDirectory: "packages/unversioned",
          packageJson: { name: "@fixture/unversioned" },
        },
      ],
    });
    const appDirectory = path.join(graph.rootDirectory, "packages", "app");
    const sharedDirectory = path.join(graph.rootDirectory, "packages", "shared");
    const unversionedDirectory = path.join(graph.rootDirectory, "packages", "unversioned");

    expect(graph.getDependency(appDirectory, "@fixture/shared")).toMatchObject({
      rawSpecifier: "workspace:*",
      resolvedSpecifier: "workspace:*",
      workspaceTargetPackageDirectory: sharedDirectory,
    });
    expect(graph.workspaceEdges).toEqual([
      {
        sourcePackageDirectory: appDirectory,
        targetPackageDirectory: sharedDirectory,
        targetPackageVersion: "1.4.2",
        dependencyName: "@fixture/shared",
        section: "dependencies",
        workspaceSpecifier: "workspace:*",
      },
      {
        sourcePackageDirectory: appDirectory,
        targetPackageDirectory: unversionedDirectory,
        targetPackageVersion: null,
        dependencyName: "@fixture/unversioned",
        section: "dependencies",
        workspaceSpecifier: "workspace:^",
      },
    ]);
    expect(graph.hasDependency(appDirectory, "@fixture/shared")).toBe(true);
    expect(graph.hasDependency(appDirectory, "@fixture/shared", ">=1 <2")).toBe(true);
    expect(graph.hasDependency(appDirectory, "@fixture/shared", ">=2")).toBe(false);
    expect(graph.hasDependency(appDirectory, "@fixture/unversioned")).toBe(true);
    expect(graph.hasDependency(appDirectory, "@fixture/unversioned", ">=1")).toBe(false);
    expect(graph.hasDependency(sharedDirectory, "@fixture/shared")).toBe(false);
  });

  it("uses declaration precedence and rejects invalid range evidence", () => {
    const graph = buildTemporaryGraph({
      rootPackageJson: {
        name: "workspace-root",
        workspaces: ["packages/*"],
      },
      workspacePackages: [
        {
          relativeDirectory: "packages/app",
          packageJson: {
            name: "@fixture/app",
            dependencies: {
              "@fixture/shared": "workspace:*",
              "invalid-tag": "latest",
              "invalid-source": "git+https://example.com/repository.git",
            },
            devDependencies: { "@fixture/shared": "^2.0.0" },
            peerDependencies: { "@fixture/shared": "workspace:^1.0.0" },
          },
        },
        {
          relativeDirectory: "packages/shared",
          packageJson: { name: "@fixture/shared", version: "1.5.0" },
        },
      ],
    });
    const appDirectory = path.join(graph.rootDirectory, "packages", "app");

    expect(
      graph
        .getDependencyDeclarations(appDirectory, "@fixture/shared")
        .map((declaration) => declaration.section),
    ).toEqual(["dependencies", "devDependencies", "peerDependencies"]);
    expect(graph.workspaceEdges).toHaveLength(2);
    expect(graph.hasDependency(appDirectory, "@fixture/shared", ">=1 <2")).toBe(true);
    expect(graph.hasDependency(appDirectory, "@fixture/shared", ">=2")).toBe(false);
    expect(graph.hasDependency(appDirectory, "invalid-tag")).toBe(true);
    expect(graph.hasDependency(appDirectory, "invalid-tag", ">=1")).toBe(false);
    expect(graph.hasDependency(appDirectory, "invalid-source", ">=1")).toBe(false);
    expect(graph.hasDependency(appDirectory, "@fixture/shared", "not-a-range")).toBe(false);
    expect(graph.hasDependency(appDirectory, "@fixture/shared", "")).toBe(false);
    expect(graph.hasDependency(appDirectory, "missing")).toBe(false);
  });

  it("retains default pnpm catalog provenance", () => {
    const graph = buildFixtureGraph("pnpm-catalog-workspace");
    const workspaceDirectory = path.join(graph.rootDirectory, "packages", "ui");

    expect(graph.getDependency(workspaceDirectory, "react")).toEqual({
      declaringPackageDirectory: workspaceDirectory,
      packageName: "react",
      section: "dependencies",
      rawSpecifier: "catalog:",
      resolvedSpecifier: "^19.0.0",
      catalogReference: null,
      resolutionSource: "workspace-root-catalog",
      resolutionSourceDirectory: graph.rootDirectory,
      workspaceTargetPackageDirectory: null,
    });
    expect(graph.hasDependency(workspaceDirectory, "react", ">=19 <20")).toBe(true);
    expect(graph.hasDependency(workspaceDirectory, "react", ">=20")).toBe(false);
  });

  it("preserves unresolved catalog declarations without treating them as semver", () => {
    const graph = buildTemporaryGraph({
      rootPackageJson: {
        name: "unresolved-catalog",
        dependencies: { react: "catalog:missing" },
      },
    });

    expect(graph.getDependency(graph.rootDirectory, "react")).toMatchObject({
      rawSpecifier: "catalog:missing",
      resolvedSpecifier: "catalog:missing",
      catalogReference: "missing",
      resolutionSource: "unresolved-catalog",
      workspaceTargetPackageDirectory: null,
    });
    expect(graph.hasDependency(graph.rootDirectory, "react")).toBe(true);
    expect(graph.hasDependency(graph.rootDirectory, "react", ">=19")).toBe(false);
  });

  it("retains named pnpm and grouped Bun catalog references", () => {
    const pnpmGraph = buildFixtureGraph("pnpm-named-catalog");
    const pnpmWorkspaceDirectory = path.join(pnpmGraph.rootDirectory, "packages", "app");
    const bunGraph = buildFixtureGraph("bun-multiple-grouped-catalogs");
    const bunWorkspaceDirectory = path.join(bunGraph.rootDirectory, "apps", "web");

    expect(pnpmGraph.getDependency(pnpmWorkspaceDirectory, "react")).toMatchObject({
      rawSpecifier: "catalog:react_v19_current",
      resolvedSpecifier: "^19.0.0",
      catalogReference: "react_v19_current",
      resolutionSource: "workspace-root-catalog",
    });
    expect(bunGraph.getDependency(bunWorkspaceDirectory, "react")).toMatchObject({
      rawSpecifier: "catalog:react19",
      resolvedSpecifier: "19.2.0",
      catalogReference: "react19",
      resolutionSource: "workspace-root-catalog",
    });
  });

  it("records enclosing-monorepo provenance for a leaf graph", () => {
    const monorepoDirectory = path.join(FIXTURES_DIRECTORY, "pnpm-catalog-workspace");
    const leafDirectory = path.join(monorepoDirectory, "packages", "ui");
    const leafPackageJson = readPackageJson(path.join(leafDirectory, "package.json"));
    const graph = buildPackageGraph(leafDirectory, leafPackageJson);

    expect(graph.getDependency(leafDirectory, "react")).toMatchObject({
      rawSpecifier: "catalog:",
      resolvedSpecifier: "^19.0.0",
      resolutionSource: "monorepo-root-catalog",
      resolutionSourceDirectory: monorepoDirectory,
    });
  });

  it("feeds legacy workspace aggregation without changing catalog facts", () => {
    const graph = buildFixtureGraph("pnpm-named-catalog");

    expect(
      collectWorkspaceFacts(graph, {
        collectReactGroup: true,
      }),
    ).toMatchObject({
      reactVersion: "^19.0.0",
      framework: "unknown",
      hasReactNativeAwarePackage: false,
      hasReanimatedAwarePackage: false,
    });
  });
});
