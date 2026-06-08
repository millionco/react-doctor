import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { checkReactServerComponentsAdvisory, clearPackageJsonCache } from "@react-doctor/core";
import type { Diagnostic, PackageJson, ProjectInfo } from "@react-doctor/core";

const FIXTURES_DIRECTORY = path.resolve(
  import.meta.dirname,
  "fixtures",
  "check-react-server-components-advisory",
);

const RULE_KEY = "no-vulnerable-react-server-components";

const buildProject = (
  rootDirectory: string,
  framework: ProjectInfo["framework"],
  nextjsVersion: string | null,
): ProjectInfo => ({
  rootDirectory,
  projectName: "fixture-app",
  reactVersion: "19.2.0",
  reactMajorVersion: 19,
  tailwindVersion: null,
  zodVersion: null,
  zodMajorVersion: null,
  framework,
  hasTypeScript: true,
  hasReactCompiler: false,
  hasTanStackQuery: false,
  nextjsVersion,
  nextjsMajorVersion: null,
  hasReactNativeWorkspace: false,
  expoVersion: null,
  shopifyFlashListVersion: null,
  shopifyFlashListMajorVersion: null,
  hasReanimated: false,
  preactVersion: null,
  preactMajorVersion: null,
  sourceFileCount: 10,
});

const expectAdvisoryShape = (diagnostic: Diagnostic): void => {
  expect(diagnostic.rule).toBe(RULE_KEY);
  expect(diagnostic.plugin).toBe("react-doctor");
  expect(diagnostic.category).toBe("Security");
  expect(diagnostic.filePath).toBe("package.json");
  expect(diagnostic.message.length).toBeGreaterThan(0);
  expect(diagnostic.help.length).toBeGreaterThan(0);
};

interface FixtureExpectation {
  readonly name: string;
  readonly description: string;
  readonly framework: ProjectInfo["framework"];
  readonly expectedSeverities: ReadonlyArray<Diagnostic["severity"]>;
  readonly expectedSubstrings: ReadonlyArray<string>;
}

const FIXTURE_EXPECTATIONS: ReadonlyArray<FixtureExpectation> = [
  {
    name: "rsc-webpack-rce",
    description: "react-server-dom-webpack 19.2.0 → critical RCE error",
    framework: "vite",
    expectedSeverities: ["error"],
    expectedSubstrings: ["CVE-2025-55182", "remote code execution", "19.2.6"],
  },
  {
    name: "rsc-webpack-dos",
    description: "react-server-dom-webpack 19.2.3 (RCE-patched, DoS-vulnerable) → warning",
    framework: "vite",
    expectedSeverities: ["warning"],
    expectedSubstrings: ["CVE-2026-23870", "denial-of-service", "19.2.6"],
  },
  {
    name: "rsc-webpack-patched",
    description: "react-server-dom-webpack 19.2.6 → no diagnostic",
    framework: "vite",
    expectedSeverities: [],
    expectedSubstrings: [],
  },
  {
    name: "rsc-parcel-rce",
    description: "react-server-dom-parcel 19.1.0 → critical RCE error",
    framework: "vite",
    expectedSeverities: ["error"],
    expectedSubstrings: ["CVE-2025-55182", "19.1.7"],
  },
  {
    name: "rsc-turbopack-rce",
    description: "react-server-dom-turbopack 19.0.0 → critical RCE error",
    framework: "vite",
    expectedSeverities: ["error"],
    expectedSubstrings: ["CVE-2025-55182", "19.0.6"],
  },
  {
    name: "rsc-unaffected-line",
    description: "react-server-dom-webpack 18.3.1 (pre-RSC-RCE line) → no diagnostic",
    framework: "vite",
    expectedSeverities: [],
    expectedSubstrings: [],
  },
  {
    name: "rsc-declared-range",
    description: "an ambiguous `^19.2.0` range with no install must not be flagged",
    framework: "vite",
    expectedSeverities: [],
    expectedSubstrings: [],
  },
  {
    name: "client-react-only",
    description: "a pure client-side React app with no RSC packages → no diagnostic",
    framework: "vite",
    expectedSeverities: [],
    expectedSubstrings: [],
  },
  {
    name: "nextjs-rce",
    description: "Next.js 15.0.0 → critical RCE error pointing at a Next.js upgrade",
    framework: "nextjs",
    expectedSeverities: ["error"],
    expectedSubstrings: ["CVE-2025-55182", "next@15.5.18", "bundles its own"],
  },
  {
    name: "nextjs-dos",
    description: "Next.js 15.5.7 (RCE-patched, DoS-vulnerable) → warning",
    framework: "nextjs",
    expectedSeverities: ["warning"],
    expectedSubstrings: ["CVE-2026-23870", "next@15.5.18"],
  },
  {
    name: "nextjs-patched",
    description: "Next.js 15.5.18 → no diagnostic",
    framework: "nextjs",
    expectedSeverities: [],
    expectedSubstrings: [],
  },
  {
    name: "nextjs-16-dos",
    description: "Next.js 16.2.0 (post-RCE minor, below latest safe) → warning",
    framework: "nextjs",
    expectedSeverities: ["warning"],
    expectedSubstrings: ["CVE-2026-23870", "next@16.2.6"],
  },
  {
    name: "nextjs-unsupported-line",
    description: "Next.js 14.2.0 → warning to move to a supported major",
    framework: "nextjs",
    expectedSeverities: ["warning"],
    expectedSubstrings: ["15.5.18 or 16.2.6"],
  },
  {
    name: "nextjs-pre-rsc",
    description: "Next.js 12.3.4 (pre-RSC) → no diagnostic",
    framework: "nextjs",
    expectedSeverities: [],
    expectedSubstrings: [],
  },
];

describe("checkReactServerComponentsAdvisory (fixtures)", () => {
  // The committed fixtures live inside this monorepo, so running the check
  // directly against them would walk up to the real repo root. Copy each into
  // an isolated temp directory (outside any monorepo) so resolution sees only
  // the fixture's own manifest.
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rsc-fixtures-"));

  afterAll(() => {
    fs.rmSync(isolatedRoot, { recursive: true, force: true });
  });

  const isolateFixture = (name: string): string => {
    const isolatedDirectory = path.join(isolatedRoot, name);
    fs.mkdirSync(isolatedDirectory, { recursive: true });
    fs.copyFileSync(
      path.join(FIXTURES_DIRECTORY, name, "package.json"),
      path.join(isolatedDirectory, "package.json"),
    );
    clearPackageJsonCache();
    return isolatedDirectory;
  };

  for (const expectation of FIXTURE_EXPECTATIONS) {
    it(`${expectation.name}: ${expectation.description}`, () => {
      const fixtureDirectory = isolateFixture(expectation.name);
      const diagnostics = checkReactServerComponentsAdvisory(
        fixtureDirectory,
        buildProject(fixtureDirectory, expectation.framework, null),
      );

      expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual([
        ...expectation.expectedSeverities,
      ]);

      const concatenatedHelpAndMessages = diagnostics
        .map((diagnostic) => `${diagnostic.message}\n${diagnostic.help}`)
        .join("\n");
      for (const expectedSubstring of expectation.expectedSubstrings) {
        expect(concatenatedHelpAndMessages).toContain(expectedSubstring);
      }

      for (const diagnostic of diagnostics) expectAdvisoryShape(diagnostic);
    });
  }
});

describe("checkReactServerComponentsAdvisory (installed-version resolution)", () => {
  let temporaryRoot: string;

  beforeEach(() => {
    temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-rsc-advisory-"));
    clearPackageJsonCache();
  });

  afterAll(() => {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  });

  const writePackageJson = (directory: string, packageJson: PackageJson): void => {
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify(packageJson, null, 2));
  };

  const writeInstalledManifest = (
    directory: string,
    packageName: string,
    version: string,
  ): void => {
    const manifestDirectory = path.join(directory, "node_modules", packageName);
    fs.mkdirSync(manifestDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(manifestDirectory, "package.json"),
      JSON.stringify({ name: packageName, version }),
    );
  };

  it("prefers the concrete installed version over an ambiguous declared range", () => {
    writePackageJson(temporaryRoot, {
      name: "app",
      dependencies: { "react-server-dom-webpack": "^19.2.0" },
    });
    writeInstalledManifest(temporaryRoot, "react-server-dom-webpack", "19.2.0");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "vite", null),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("treats a canary of a vulnerable line as still vulnerable", () => {
    writePackageJson(temporaryRoot, { name: "app", dependencies: {} });
    writeInstalledManifest(temporaryRoot, "react-server-dom-webpack", "19.2.0-canary.77");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "vite", null),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("resolves a vulnerable Next.js installed only under a workspace whose root is not Next", () => {
    // Regression for the Bugbot findings: the monorepo root is classified as
    // Vite with no `nextjsVersion`, yet a workspace installs a vulnerable Next.
    // Dispatch must key on `next` actually resolving (in the workspace's
    // node_modules), not the root framework, and the standalone
    // react-server-dom check must not run instead.
    writePackageJson(temporaryRoot, {
      name: "monorepo-root",
      workspaces: ["packages/*"],
      dependencies: { react: "19.2.0", vite: "^5.0.0" },
    });
    const webDirectory = path.join(temporaryRoot, "packages", "web");
    writePackageJson(webDirectory, {
      name: "web",
      dependencies: { next: "^15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    });
    writeInstalledManifest(webDirectory, "next", "15.0.0");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "vite", null),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("CVE-2025-55182");
  });

  it("still flags a standalone vulnerable RSC runtime when only a pre-13 Next is installed", () => {
    // Regression for "Pre-13 next skips RSC check": a Next below major 13 is not
    // an affected line and must not suppress the standalone react-server-dom check.
    writePackageJson(temporaryRoot, { name: "app", dependencies: {} });
    writeInstalledManifest(temporaryRoot, "next", "12.3.4");
    writeInstalledManifest(temporaryRoot, "react-server-dom-webpack", "19.2.0");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "nextjs", null),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("react-server-dom-webpack");
  });

  it("checks every workspace's Next.js, not just the first resolved one", () => {
    // Regression for "First next wins over workspace": an inert/safe Next at the
    // root must not hide a vulnerable Next installed in a workspace.
    writePackageJson(temporaryRoot, {
      name: "monorepo-root",
      workspaces: ["packages/*"],
      dependencies: { next: "15.5.18", react: "19.2.0" },
    });
    writeInstalledManifest(temporaryRoot, "next", "15.5.18");
    const webDirectory = path.join(temporaryRoot, "packages", "web");
    writePackageJson(webDirectory, {
      name: "web",
      dependencies: { next: "15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    });
    writeInstalledManifest(webDirectory, "next", "15.0.0");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "nextjs", null),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("next@15.0.0");
  });

  it("finds a hoisted vulnerable Next when scanning a nested workspace package", () => {
    // Regression for "Workspace scan misses monorepo root": scanning a nested
    // package whose `next` is hoisted to the monorepo root must walk up to that
    // root (and its node_modules) rather than only the scanned package.
    writePackageJson(temporaryRoot, {
      name: "monorepo-root",
      workspaces: ["packages/*"],
      dependencies: { react: "19.2.0" },
    });
    writeInstalledManifest(temporaryRoot, "next", "15.0.0");
    const webDirectory = path.join(temporaryRoot, "packages", "web");
    writePackageJson(webDirectory, {
      name: "web",
      dependencies: { next: "^15.0.0", react: "19.0.0", "react-dom": "19.0.0" },
    });
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      webDirectory,
      buildProject(webDirectory, "nextjs", "^15.0.0"),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("next@15.0.0");
  });

  it("uses the discovery-resolved next version when the manifest spec is an unparseable catalog ref", () => {
    // Regression for "Catalog spec blocks version override": a `catalog:` spec
    // must not shadow `project.nextjsVersion`, which discovery already resolved
    // to a concrete pin.
    writePackageJson(temporaryRoot, { name: "app", dependencies: { next: "catalog:" } });
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "nextjs", "15.0.0"),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("next@15.0.0");
  });

  it("probes a workspace that declares only react-server-dom (no react dependency)", () => {
    // Regression for "Skips non-React workspace packages": candidate
    // enumeration must not be limited to React-bearing workspaces.
    writePackageJson(temporaryRoot, { name: "monorepo-root", workspaces: ["packages/*"] });
    const libDirectory = path.join(temporaryRoot, "packages", "lib");
    writePackageJson(libDirectory, {
      name: "lib",
      dependencies: { "react-server-dom-webpack": "19.2.0" },
    });
    writeInstalledManifest(libDirectory, "react-server-dom-webpack", "19.2.0");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "unknown", null),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].severity).toBe("error");
    expect(diagnostics[0].message).toContain("react-server-dom-webpack");
  });

  it("checks Next.js by its own version even when a standalone react-server-dom is present", () => {
    writePackageJson(temporaryRoot, { name: "app", dependencies: { next: "15.5.18" } });
    writeInstalledManifest(temporaryRoot, "next", "15.5.18");
    writeInstalledManifest(temporaryRoot, "react-server-dom-webpack", "19.2.0");
    clearPackageJsonCache();

    const diagnostics = checkReactServerComponentsAdvisory(
      temporaryRoot,
      buildProject(temporaryRoot, "nextjs", null),
    );
    expect(diagnostics).toEqual([]);
  });
});
