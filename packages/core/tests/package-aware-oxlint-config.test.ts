import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  clearProjectCache,
  discoverProject,
  getDiscoveredPackageGraph,
} from "../src/project-info/discover-project.js";
import { createOxlintConfig } from "../src/runners/oxlint/config.js";

const FIXTURE_DIRECTORY = path.join(import.meta.dirname, "fixtures", "package-local-capabilities");
const PLUGIN_PATH = path.resolve(
  import.meta.dirname,
  "../../oxlint-plugin-react-doctor/dist/index.js",
);
const TEMPORARY_DIRECTORY_PREFIX = "react-doctor-package-context-";
const OXLINT_THREAD_COUNT = "1";
const PACKAGE_SOURCE_PATHS = [
  "packages/legacy/src/app.tsx",
  "packages/mobile/src/app.tsx",
  "packages/modern/src/app.tsx",
];
const temporaryDirectories: string[] = [];
const esmRequire = createRequire(import.meta.url);
const oxlintMainPath = esmRequire.resolve("oxlint");
const oxlintBinaryPath = path.join(
  path.resolve(path.dirname(oxlintMainPath), ".."),
  "bin",
  "oxlint",
);

interface OxlintPackageContextDiagnostic {
  readonly code: string;
  readonly filename: string;
}

interface OxlintPackageContextOutput {
  readonly diagnostics: ReadonlyArray<OxlintPackageContextDiagnostic>;
}

afterEach(() => {
  clearProjectCache();
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

const runOxlint = (
  config: ReturnType<typeof createOxlintConfig>,
): ReadonlyArray<OxlintPackageContextDiagnostic> => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), TEMPORARY_DIRECTORY_PREFIX));
  temporaryDirectories.push(temporaryDirectory);
  const configPath = path.join(temporaryDirectory, "oxlintrc.json");
  fs.writeFileSync(configPath, JSON.stringify(config), "utf8");
  const result = spawnSync(
    process.execPath,
    [
      oxlintBinaryPath,
      "--config",
      configPath,
      "--format",
      "json",
      "--threads",
      OXLINT_THREAD_COUNT,
      ...PACKAGE_SOURCE_PATHS,
    ],
    {
      cwd: FIXTURE_DIRECTORY,
      encoding: "utf8",
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toBe("");
  const output: OxlintPackageContextOutput = JSON.parse(result.stdout);
  return output.diagnostics;
};

const diagnosticIdentity = (diagnostic: OxlintPackageContextDiagnostic): string =>
  `${
    path.isAbsolute(diagnostic.filename)
      ? path.relative(FIXTURE_DIRECTORY, diagnostic.filename)
      : diagnostic.filename
  }:${diagnostic.code}`.replaceAll("\\", "/");

describe("package-aware oxlint config", () => {
  it("threads stable package ownership without changing legacy activation by default", () => {
    const project = discoverProject(FIXTURE_DIRECTORY);
    const packageGraph = getDiscoveredPackageGraph(FIXTURE_DIRECTORY);
    expect(packageGraph).not.toBeNull();

    const legacyConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
    });
    const packageAwareConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
      packageGraph: packageGraph ?? undefined,
    });
    const optedInConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
      packageGraph: packageGraph ?? undefined,
      enablePackageContext: true,
    });

    expect(packageAwareConfig).toEqual(legacyConfig);
    expect(packageAwareConfig.settings["react-doctor"]).not.toHaveProperty(
      "packageCapabilityGates",
    );
    expect(packageAwareConfig.settings["react-doctor"]).not.toHaveProperty("packageContexts");
    expect(optedInConfig.rules).toEqual(legacyConfig.rules);
    expect(optedInConfig.settings["react-doctor"].packageContextEnabled).toBe(true);
    expect(optedInConfig.settings["react-doctor"].packageContexts).toEqual([
      {
        relativeDirectory: "",
        capabilities: ["unknown"],
        dependencies: [],
      },
      {
        relativeDirectory: "packages/legacy",
        capabilities: [
          "client-only",
          "pre-es2023",
          "react",
          "react:17",
          "react:18",
          "target-blank-needs-explicit-protection",
          "typescript",
          "vite",
        ],
        dependencies: [
          {
            name: "react",
            section: "dependencies",
            rawSpecifier: "^18.2.0",
            resolvedSpecifier: "^18.2.0",
          },
          {
            name: "vite",
            section: "dependencies",
            rawSpecifier: "^5.4.0",
            resolvedSpecifier: "^5.4.0",
          },
        ],
      },
      {
        relativeDirectory: "packages/mobile",
        capabilities: [
          "client-only",
          "expo",
          "expo:54",
          "react",
          "react-native",
          "react:17",
          "react:18",
          "react:19",
        ],
        dependencies: [
          {
            name: "expo",
            section: "dependencies",
            rawSpecifier: "^54.0.0",
            resolvedSpecifier: "^54.0.0",
          },
          {
            name: "react",
            section: "dependencies",
            rawSpecifier: "^19.1.0",
            resolvedSpecifier: "^19.1.0",
          },
          {
            name: "react-native",
            section: "dependencies",
            rawSpecifier: "^0.81.0",
            resolvedSpecifier: "^0.81.0",
          },
        ],
      },
      {
        relativeDirectory: "packages/modern",
        capabilities: [
          "nextjs",
          "nextjs:15",
          "nextjs:16",
          "nextjs:static-export",
          "react",
          "react-compiler",
          "react:17",
          "react:18",
          "react:19",
          "react:19.2",
          "ssr",
          "tanstack-query",
          "typescript",
        ],
        dependencies: [
          {
            name: "@tanstack/react-query",
            section: "dependencies",
            rawSpecifier: "^5.66.0",
            resolvedSpecifier: "^5.66.0",
          },
          {
            name: "next",
            section: "dependencies",
            rawSpecifier: "catalog:modern",
            resolvedSpecifier: "^16.0.0",
          },
          {
            name: "react",
            section: "dependencies",
            rawSpecifier: "catalog:modern",
            resolvedSpecifier: "^19.2.0",
          },
        ],
      },
    ]);
  });

  it("registers the package capability union only for the private opt-in", () => {
    const project = discoverProject(FIXTURE_DIRECTORY);
    const packageGraph = getDiscoveredPackageGraph(FIXTURE_DIRECTORY);
    const legacyConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
      packageGraph: packageGraph ?? undefined,
    });
    const gatedConfig = createOxlintConfig({
      pluginPath: "/tmp/plugin.js",
      project,
      packageGraph: packageGraph ?? undefined,
      enablePackageCapabilityGates: true,
    });

    expect(legacyConfig.rules).not.toHaveProperty("react-doctor/no-default-props");
    expect(gatedConfig.rules).toHaveProperty("react-doctor/no-default-props");
    expect(gatedConfig.settings["react-doctor"].packageCapabilityGates).toBe(true);
  });

  it("gates actual diagnostics by the package owning each file", () => {
    const project = discoverProject(FIXTURE_DIRECTORY);
    const packageGraph = getDiscoveredPackageGraph(FIXTURE_DIRECTORY);
    expect(packageGraph).not.toBeNull();
    const legacyConfig = createOxlintConfig({
      pluginPath: PLUGIN_PATH,
      project,
      packageGraph: packageGraph ?? undefined,
    });
    const gatedConfig = createOxlintConfig({
      pluginPath: PLUGIN_PATH,
      project,
      packageGraph: packageGraph ?? undefined,
      enablePackageCapabilityGates: true,
    });

    expect(runOxlint(legacyConfig).map(diagnosticIdentity).sort()).toEqual([
      "packages/legacy/src/app.tsx:react-doctor(no-ref-callback-cleanup-before-react-19)",
    ]);
    expect(runOxlint(gatedConfig).map(diagnosticIdentity).sort()).toEqual([
      "packages/legacy/src/app.tsx:react-doctor(no-ref-callback-cleanup-before-react-19)",
      "packages/mobile/src/app.tsx:react-doctor(no-default-props)",
      "packages/modern/src/app.tsx:react-doctor(no-default-props)",
    ]);
  });
});
