import * as fs from "node:fs";
import * as NodeModule from "node:module";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "../../rules/state-and-effects/no-set-state-after-await-in-effect.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../build-source-project-index.js";
import { captureCrossFileProbes } from "../cross-file-probe-recorder.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { normalizeFilename } from "../normalize-filename.js";
import { parseSourceFile } from "../parse-source-file.js";
import { resetFilesystemCaches } from "../reset-filesystem-caches.js";
import {
  MODERN_ROLE_PACKAGES,
  NATIVE_UI_SDK_MAPPING_CONFIG_NAMES,
  PNPM_LOCK_ROLE_MAX_FILE_BYTES,
  PNPM_ROLE_MAX_BYTES,
} from "./modern-source-scheduling-role/constants.js";
import {
  hasModernSourceSchedulingRole,
  hasSupportedNativeUiSdkRole,
  hasSupportedReadonlySourcePrototypeRole,
} from "./has-modern-source-scheduling-role.js";

interface RoleFixture {
  readonly directory: string;
  readonly filename: string;
  readonly source: string;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-modern-role-"));
let fixtureNumber = 0;

const nativeConfigurationImportCases = [
  {
    importSource: "import type { Token } from './initialization.mjs';",
    emittedImportSource: "",
    expectedRole: true,
    keepsRuntimeImport: false,
  },
  {
    importSource: "import { type Token } from './initialization.mjs';",
    emittedImportSource: "import {} from './initialization.mjs';",
    expectedRole: false,
    keepsRuntimeImport: true,
  },
];

const createFixture = (
  dependencies: Readonly<Record<string, string | undefined>> = {
    react: "^19.0.0",
    "react-dom": "~19.2.0",
    next: "16.x",
  },
  source = 'import { useState } from "react"; export const View = () => useState(0);',
): RoleFixture => {
  fixtureNumber += 1;
  const directory = path.join(temporaryDirectory, String(fixtureNumber));
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "package.json"), JSON.stringify({ dependencies }));
  const filename = path.join(directory, "view.tsx");
  fs.writeFileSync(filename, source);
  return { directory, filename, source };
};

const rendererPackageManifest = {
  name: "marked",
  version: "18.0.14",
  type: "module",
  main: "./lib/marked.esm.js",
  module: "./lib/marked.esm.js",
  browser: "./lib/marked.umd.js",
  exports: {
    ".": { types: "./lib/marked.d.ts", default: "./lib/marked.esm.js" },
    "./bin/marked": "./bin/marked.js",
    "./package.json": "./package.json",
  },
};

const rendererIntegrity =
  "sha512-mBHK6FBHuBAlhgRe88w9F0O1AbwwXJUcQibUbC/QcdTbVGAD7aWza+xt3N6oT/jCZx3/OMeS+8rnuiHZcQ9s7A==";

const getRendererLockSource = (range = "^18.0.14"): string => `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false
${range.startsWith("catalog:") ? `catalogs:\n  ${range.slice("catalog:".length) || "default"}:\n    marked: {specifier: ^18.0.14, version: 18.0.14}\n` : ""}importers:
  .:
    dependencies:
      marked: {specifier: ${JSON.stringify(range)}, version: 18.0.14}
packages:
  marked@18.0.14:
    resolution: {integrity: ${rendererIntegrity}}
    engines: {node: '>=20'}
    hasBin: true
snapshots:
  marked@18.0.14: {}
`;

const createRendererFixture = (
  range = "^18.0.14",
  installedChanges: Readonly<Record<string, unknown>> = {},
): RoleFixture => {
  const fixture = createFixture({ marked: range });
  fs.writeFileSync(
    path.join(fixture.directory, "package.json"),
    JSON.stringify({ packageManager: "pnpm@10.32.1", dependencies: { marked: range } }),
  );
  fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), getRendererLockSource(range));
  const installedDirectory = path.join(fixture.directory, "node_modules", "marked");
  fs.mkdirSync(installedDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(installedDirectory, "package.json"),
    JSON.stringify({ ...rendererPackageManifest, ...installedChanges }),
  );
  return fixture;
};

const getReadonlyPrototypeRole = (
  fixture: RoleFixture,
  source: string,
  exportName: string,
  methodName: string,
): boolean => {
  const program = parseSourceFile(fixture.filename);
  if (!program || !isNodeOfType(program, "Program")) return false;
  const scopes = analyzeScopes(program);
  const projectIndex = buildSourceProjectIndex({
    rootDirectory: fixture.directory,
    currentFilePath: normalizeFilename(fixture.filename),
    currentProgramNode: program,
    currentScopes: scopes,
  });
  if (projectIndex) {
    const currentModule = projectIndex.modulesByFilePath.get(normalizeFilename(fixture.filename));
    expect(currentModule?.programNode).toBe(program);
    expect(currentModule?.scopes).toBe(scopes);
  }
  return Boolean(
    projectIndex &&
    hasSupportedReadonlySourcePrototypeRole(
      fixture.filename,
      source,
      exportName,
      methodName,
      projectIndex,
    ),
  );
};

const getRole = (fixture: RoleFixture): boolean => {
  const result = runRule(
    {
      id: "test-modern-source-role",
      severity: "warn",
      create: (context) => ({
        "Program:exit": (node) => {
          if (!isNodeOfType(node, "Program")) return;
          const projectIndex = buildSourceProjectIndex({
            rootDirectory: fixture.directory,
            currentFilePath: normalizeFilename(fixture.filename),
            currentProgramNode: node,
            currentScopes: context.scopes,
          });
          if (projectIndex) {
            const currentModule = projectIndex.modulesByFilePath.get(
              normalizeFilename(fixture.filename),
            );
            expect(currentModule?.programNode).toBe(node);
            expect(currentModule?.scopes).toBe(context.scopes);
          }
          if (projectIndex && hasModernSourceSchedulingRole(context, projectIndex)) {
            context.report({ node, message: "supported" });
          }
        },
      }),
    },
    fixture.source,
    { filename: fixture.filename },
  );
  expect(result.parseErrors).toHaveLength(0);
  return result.diagnostics.length === 1;
};

const nativeWaitSource = `import { useEffect, useState } from "react";
      const waitForWindow = (duration, signal) => new Promise((complete) => {
        if (signal.aborted) { complete(false); return; }
        const timer = setTimeout(() => {
          signal.removeEventListener("abort", stop);
          complete(true);
        }, duration);
        const stop = () => { clearTimeout(timer); complete(false); };
        signal.addEventListener("abort", stop, { once: true });
      });
      export const Notice = ({ refresh }) => {
        const [message, setMessage] = useState("");
        useEffect(() => {
          const controller = new AbortController();
          const execute = async () => {
            if (!(await waitForWindow(5, controller.signal))) return;
            setMessage("complete");
          };
          execute();
          return () => controller.abort();
        }, [refresh]);
        return <p>{message}</p>;
      };`;

describe("hasModernSourceSchedulingRole", () => {
  beforeEach(() => resetFilesystemCaches());
  afterAll(() => fs.rmSync(temporaryDirectory, { force: true, recursive: true }));

  it.each([
    "19.2.0",
    "^19.0.0",
    "~19.2.0",
    "19.x",
    ">=19.0.0 <20",
    ">=19.0.0 <=19.9.0",
    "^19.0.0 || ~19.2.0",
  ])("supports a fully contained React range %s", (reactRange) => {
    expect(
      getRole(createFixture({ react: reactRange, "react-dom": reactRange, next: "^16.0.0" })),
    ).toBe(true);
  });

  it.each([
    ">=19",
    "^18 || ^19",
    ">=19 <21",
    "19.0.0-beta.1",
    "workspace:^19",
    "npm:replacement@19.0.0",
    "file:../react",
    "latest",
    "*",
    ">=20 <19",
    ">19.0.0 <=19.0.0",
    ">19.0.0 <19.0.1",
    "19.x.3",
    "019.2.0",
    "19.99999999999999999999999.0",
  ])("refuses uncertain or incompatible range %s", (reactRange) => {
    expect(getRole(createFixture({ react: reactRange, "react-dom": "^19", next: "^16" }))).toBe(
      false,
    );
  });

  it.each([
    { react: "^19", "react-dom": "^18", next: "^16" },
    { react: "^19", "react-dom": "^19", next: "^15" },
    { react: "^19", "react-dom": "^19" },
  ])("requires compatible ReactDOM and Next roles", (dependencies) => {
    expect(getRole(createFixture(dependencies))).toBe(false);
  });

  it("admits ordinary explicit modern roots", () => {
    expect(
      getRole(
        createFixture(
          undefined,
          'import {useState} from "react"; import {createRoot} from "react-dom/client"; createRoot(document.body).render(null);',
        ),
      ),
    ).toBe(true);
  });

  it.each([
    'import React from "react"; React.useState = replacement;',
    'import React from "react"; React.__defineGetter__("useState", replacement);',
    'import {useState, __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as internals} from "react"; inject(internals);',
    'import {useState, __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as internals} from "react"; Object.defineProperty(internals, "H", {get() {return foreignDispatcher}});',
    'import React from "react"; inject(React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE);',
    'import {useState} from "react"; import {__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as internals} from "react-dom"; inject(internals);',
    'import React from "react"; const alias = React; alias.useState = replacement;',
    'import React from "react"; let alias = React; alias.useState = replacement;',
    'import React from "react"; var alias = React; alias.useState = replacement;',
    'import React from "react"; Object.assign(React, replacement);',
    'import React from "react"; export { React };',
    'import {useState} from "react"; import {render} from "react-dom"; render(null, document.body);',
    'import {useState} from "react"; import {render} from "react-dom"; register(render);',
    'import {useState} from "react"; import {createRoot} from "react-dom/client"; register(createRoot);',
    'import {useState} from "react"; import * as DOM from "react-dom/client"; register(DOM.createRoot);',
    'import {useState} from "react"; import {createRoot} from "react-dom/client"; createRoot(document.body, options);',
    'import {useState} from "react"; import reconciler from "react-reconciler";',
    'import {useState} from "react"; import {useEffect} from "preact/hooks";',
    'import {useState} from "react"; import {useEffect} from "@wordpress/element";',
    'import {useState} from "react"; import {useEffect} from "react-dom";',
    'import {useState} from "react"; import * as DOM from "react-dom"; DOM.useEffect(() => {});',
    'import {useState} from "react"; export {useEffect} from "preact/hooks";',
    'import {useState} from "react"; const compat = require("preact/compat");',
    'import React from "react"; React[method]();',
    'import {useState} from "react"; vi.mock("react", () => replacement);',
    'import {useState} from "react"; const renderer = require("react-dom");',
    'import {useState} from "react"; import("react-dom/client").then(run);',
  ])("refuses contradictory source surfaces", (source) => {
    expect(getRole(createFixture(undefined, source))).toBe(false);
  });

  it("refuses a local package import alias", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "mock-react.ts"),
      "export const useState = () => [];",
    );
    fs.writeFileSync(
      path.join(fixture.directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { react: ["./mock-react.ts"] } } }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  it("refuses an alias even when its source target is absent", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { paths: { react: ["./missing-react.ts"] } } }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  it.each(MODERN_ROLE_PACKAGES)("refuses source browser remapping of %s", (packageName) => {
    const fixture = createFixture(undefined, nativeWaitSource);
    expect(getRole(fixture)).toBe(true);
    fs.writeFileSync(
      path.join(fixture.directory, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19", "react-dom": "^19", next: "^16" },
        browser: { [packageName]: "./replacement.js" },
      }),
    );
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
    const result = runRule(noSetStateAfterAwaitInEffect, fixture.source, {
      filename: fixture.filename,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("refuses source browser remapping in an ancestor package", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "package.json"),
      JSON.stringify({ browser: { react: "./replacement.js" } }),
    );
    const childDirectory = path.join(fixture.directory, "feature");
    fs.mkdirSync(childDirectory);
    fs.writeFileSync(
      path.join(childDirectory, "package.json"),
      JSON.stringify({ dependencies: { react: "^19", "react-dom": "^19", next: "^16" } }),
    );
    const filename = path.join(childDirectory, "view.tsx");
    fs.writeFileSync(filename, fixture.source);
    expect(getRole({ ...fixture, directory: childDirectory, filename })).toBe(false);
  });

  it.each(NATIVE_UI_SDK_MAPPING_CONFIG_NAMES)(
    "refuses source runtime mapping configuration %s",
    (configName) => {
      const fixture = createFixture();
      fs.writeFileSync(path.join(fixture.directory, configName), "{}");
      expect(getRole(fixture)).toBe(false);
    },
  );

  it("preserves installed ReactDOM server and static browser mappings", () => {
    const fixture = createFixture();
    for (const [name, version] of [
      ["react", "19.2.0"],
      ["react-dom", "19.2.0"],
      ["next", "16.0.0"],
    ]) {
      const directory = path.join(fixture.directory, "node_modules", name);
      fs.mkdirSync(directory, { recursive: true });
      fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({
          name,
          version,
          ...(name === "react-dom"
            ? {
                browser: {
                  "./server.js": "./server.browser.js",
                  "./static.js": "./static.browser.js",
                },
              }
            : {}),
        }),
      );
    }
    expect(getRole(fixture)).toBe(true);
  });

  it("records and refreshes source runtime mapping configuration changes", () => {
    const fixture = createFixture();
    const configPath = path.join(fixture.directory, "import-map.json");
    const { value, trace } = captureCrossFileProbes(() => getRole(fixture));
    expect(value).toBe(true);
    expect(trace.existencePaths.has(configPath)).toBe(true);
    fs.writeFileSync(configPath, JSON.stringify({ imports: { react: "./replacement.js" } }));
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
    fs.unlinkSync(configPath);
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(true);
  });

  it("records package and absent installed metadata probes on warm lookups", () => {
    const fixture = createFixture();
    expect(getRole(fixture)).toBe(true);
    const { value, trace } = captureCrossFileProbes(() => getRole(fixture));
    expect(value).toBe(true);
    expect(trace.contentPaths.has(path.join(fixture.directory, "package.json"))).toBe(true);
    expect(
      trace.contentPaths.has(path.join(fixture.directory, "node_modules/react/package.json")),
    ).toBe(true);
  });

  it("rechecks changed installed metadata after the scan cache resets", () => {
    const fixture = createFixture();
    const installedDirectory = path.join(fixture.directory, "node_modules", "react");
    fs.mkdirSync(installedDirectory, { recursive: true });
    const installedManifest = path.join(installedDirectory, "package.json");
    fs.writeFileSync(installedManifest, JSON.stringify({ name: "react", version: "19.2.0" }));
    expect(getRole(fixture)).toBe(true);
    fs.writeFileSync(installedManifest, JSON.stringify({ name: "react", version: "18.3.1" }));
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
  });

  it("rechecks changed declared metadata after the scan cache resets", () => {
    const fixture = createFixture();
    expect(getRole(fixture)).toBe(true);
    fs.writeFileSync(
      path.join(fixture.directory, "package.json"),
      JSON.stringify({ dependencies: { react: "^19", "react-dom": "^18", next: "^16" } }),
    );
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
  });

  it("refuses legacy roots introduced by a new source module", () => {
    const fixture = createFixture();
    expect(getRole(fixture)).toBe(true);
    fs.writeFileSync(
      path.join(fixture.directory, "bootstrap.tsx"),
      'import {render} from "react-dom"; render(null, document.body);',
    );
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
  });

  it("refuses installed packages with a substituted package identity", () => {
    const fixture = createFixture();
    const installedDirectory = path.join(fixture.directory, "node_modules", "react");
    fs.mkdirSync(installedDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(installedDirectory, "package.json"),
      JSON.stringify({ name: "replacement", version: "19.2.0" }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  it.each(["19.0.0-beta.1", "20.0.0", "unknown"])(
    "refuses incompatible installed metadata %s",
    (version) => {
      const fixture = createFixture();
      const installedDirectory = path.join(fixture.directory, "node_modules", "react-dom");
      fs.mkdirSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(installedDirectory, "package.json"),
        JSON.stringify({ name: "react-dom", version }),
      );
      expect(getRole(fixture)).toBe(false);
    },
  );

  it("refuses source-visible custom Next bootstrap configuration", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "next.config.ts"),
      'export default {webpack: config => {config.resolve.alias.react = "replacement";return config;}};',
    );
    expect(getRole(fixture)).toBe(false);
  });

  it("admits an empty standard Next configuration", () => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.directory, "next.config.ts"), "export default {};");
    expect(getRole(fixture)).toBe(true);
  });

  it.each([
    "export default { output: 'export' };",
    "export default { output: 'standalone' };",
    "export default { reactStrictMode: true };",
    "export default { reactStrictMode: false };",
    "export default { images: { unoptimized: true } };",
    "export default { images: { unoptimized: false } };",
    "const settings = {}; export default settings;",
    "const settings = { output: 'standalone', reactStrictMode: false, images: { unoptimized: true } }; export default settings;",
    "import type { NextConfig } from 'next'; const settings: NextConfig = { output: 'export', reactStrictMode: true, images: { unoptimized: false } }; export default settings;",
    "import type { NextConfig } from 'next'; const settings = { output: 'standalone' } satisfies NextConfig; export default settings;",
    "const settings = { output: 'export', images: { unoptimized: true } } as const; export default settings;",
  ])("admits a closed standard Next configuration: %s", (configurationSource) => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.directory, "next.config.ts"), configurationSource);
    expect(getRole(fixture)).toBe(true);
  });

  it.each([
    "export default { webpack: null };",
    "export default { compiler: {} };",
    "export default { experimental: {} };",
    "export default { reactCompiler: false };",
    "export default { runtime: 'nodejs' };",
    "export default { output: 'custom' };",
    "export default { output: `export` };",
    "export default { reactStrictMode: 'true' };",
    "export default { images: { unoptimized: 'false' } };",
    "export default { images: {} };",
    "export default { images: { loader: 'custom', unoptimized: true } };",
    "export default { ...{}, output: 'export' };",
    "export default { get output() { return 'export'; } };",
    "export default { ['output']: 'export' };",
    "export default { output: 'export', output: 'standalone' };",
    "export default { images: { ...{}, unoptimized: true } };",
    "export default { images: { get unoptimized() { return true; } } };",
    "export default { images: { ['unoptimized']: true } };",
    "export default { images: { unoptimized: true, unoptimized: false } };",
    "const mode = 'export'; export default { output: mode };",
    "const images = { unoptimized: true }; export default { images };",
    "let settings = { output: 'export' }; export default settings;",
    "var settings = { output: 'export' }; export default settings;",
    "const settings = { output: 'export' }; settings.output = 'standalone'; export default settings;",
    "const settings = { images: { unoptimized: true } }; settings.images.unoptimized = false; export default settings;",
    "const settings = { output: 'export' }; publish(settings); export default settings;",
    "const settings = { output: 'export' }; const alias = settings; export default alias;",
    "const settings = { output: 'export' }; export { settings }; export default settings;",
    "export default {}; export { external as default };",
    "export default wrap({ output: 'export' });",
    "export default () => ({ output: 'export' });",
    "import runtime from 'next'; export default { output: 'export' };",
    "import { type NextConfig } from 'next'; export default { output: 'export' };",
    "const settings = { output: 'export' }, additional = {}; export default settings;",
    "const settings = { output: 'export' }; export default settings; publish(settings);",
  ])("refuses an unclosed or unsupported Next configuration: %s", (configurationSource) => {
    const fixture = createFixture();
    fs.writeFileSync(path.join(fixture.directory, "next.config.ts"), configurationSource);
    expect(getRole(fixture)).toBe(false);
  });

  it("rechecks standard configuration content and mutations after a warm scan", () => {
    const fixture = createFixture();
    const configPath = path.join(fixture.directory, "next.config.ts");
    fs.writeFileSync(configPath, "const settings = { output: 'export' }; export default settings;");
    expect(getRole(fixture)).toBe(true);
    const { value, trace } = captureCrossFileProbes(() => getRole(fixture));
    expect(value).toBe(true);
    expect(trace.contentPaths.has(configPath)).toBe(true);
    fs.writeFileSync(
      configPath,
      "const settings = { output: 'export' }; settings.compiler = foreign; export default settings;",
    );
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
  });

  it.each([
    { declaration: "const", expectedRole: true },
    { declaration: "declare const", expectedRole: false },
  ])("requires an emitted config initializer for $declaration", ({ declaration, expectedRole }) => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "next.config.ts"),
      `${declaration} settings = { output: 'export' }; export default settings;`,
    );
    expect(getRole(fixture)).toBe(expectedRole);
  });

  it.each(nativeConfigurationImportCases)(
    "preserves source and emitted configuration roles for $importSource",
    ({ importSource, emittedImportSource, expectedRole }) => {
      const fixture = createFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "next.config.ts"),
        `${importSource} export default { output: 'export' };`,
      );
      expect(getRole(fixture)).toBe(expectedRole);
      const emittedFixture = createFixture();
      fs.writeFileSync(
        path.join(emittedFixture.directory, "next.config.mjs"),
        `${emittedImportSource} export default { output: 'export' };`,
      );
      expect(getRole(emittedFixture)).toBe(expectedRole);
    },
  );

  it
    .skipIf(typeof NodeModule.stripTypeScriptTypes !== "function")
    .each(nativeConfigurationImportCases)(
    "accounts for Node native type stripping of $importSource",
    ({ importSource, expectedRole, keepsRuntimeImport }) => {
      const configurationSource = `${importSource} export default { output: 'export' };`;
      const transformedSource = NodeModule.stripTypeScriptTypes(configurationSource);
      expect(/\bimport\s*\{\s*\}\s*from/.test(transformedSource)).toBe(keepsRuntimeImport);
      const fixture = createFixture();
      fs.writeFileSync(path.join(fixture.directory, "next.config.mjs"), transformedSource);
      expect(getRole(fixture)).toBe(expectedRole);
    },
  );

  it.each([
    {
      configurationSource: "export default { output: 'export', images: { unoptimized: true } };",
      expectedDiagnostics: 0,
    },
    {
      configurationSource:
        "const settings = { output: 'standalone', reactStrictMode: false }; export default settings;",
      expectedDiagnostics: 0,
    },
    { configurationSource: "export default { compiler: {} };", expectedDiagnostics: 1 },
    {
      configurationSource:
        "const settings = { output: 'export' }; publish(settings); export default settings;",
      expectedDiagnostics: 1,
    },
  ])(
    "preserves the target-rule verdict for standard and refused configuration",
    ({ configurationSource, expectedDiagnostics }) => {
      const source = nativeWaitSource;
      const fixture = createFixture(undefined, source);
      fs.writeFileSync(path.join(fixture.directory, "next.config.ts"), configurationSource);
      const result = runRule(noSetStateAfterAwaitInEffect, source, { filename: fixture.filename });
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    },
  );

  it.each([
    { prefix: "", aliases: {}, expectedDiagnostics: 0 },
    {
      prefix: "import { Check as Same } from 'icons'; Same.render = foreign;",
      aliases: { icons: "npm:lucide-react@^1.0.0" },
      expectedDiagnostics: 1,
    },
    {
      prefix:
        "import { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as context } from 'framework'; context.H = foreignDispatcher;",
      aliases: { framework: "npm:react@^19.0.0" },
      expectedDiagnostics: 1,
    },
    {
      prefix:
        "const runtime = 'react'; import(runtime).then(runtime => { runtime.default.useEffect = foreign; });",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix: "import('react' + '').then(runtime => { runtime.default.useEffect = foreign; });",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix: "import(`react`).then(runtime => { runtime.default.useEffect = foreign; });",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix: "const load = require; load(runtime).useEffect = foreign;",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix:
        "import { foreign } from 'opaque-app'; import ReactRuntime = require('react'); ReactRuntime.useEffect = foreign;",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix:
        "import { foreign } from 'opaque-app'; import Icons = require('lucide-react'); Icons.Check.render = foreign;",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix: "import Runtime = window.React;",
      aliases: {},
      expectedDiagnostics: 1,
    },
    {
      prefix: "import type Runtime = require('react');",
      aliases: {},
      expectedDiagnostics: 1,
    },
  ])(
    "retains the target warning for unclosed runtime aliases and loaders",
    ({ prefix, aliases, expectedDiagnostics }) => {
      const source = `${prefix}\n${nativeWaitSource}`;
      const fixture = createFixture(
        { react: "^19", "react-dom": "^19", next: "^16", "lucide-react": "^1", ...aliases },
        source,
      );
      const result = runRule(noSetStateAfterAwaitInEffect, source, { filename: fixture.filename });
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(expectedDiagnostics);
    },
  );

  it.each([
    { jsxImportSource: "foreign-runtime" },
    { jsxFactory: "foreignCreateElement" },
    { jsxFragmentFactory: "foreignFragment" },
    { jsx: "react" },
  ])("refuses a custom JSX transformation", (compilerOptions) => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "tsconfig.json"),
      JSON.stringify({ compilerOptions }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  it.each(["preserve", "react-jsx", "react-jsxdev"])(
    "supports standard React JSX configuration %s",
    (jsx) => {
      const fixture = createFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { jsx, jsxImportSource: "react" } }),
      );
      expect(getRole(fixture)).toBe(true);
    },
  );

  it.each([
    "@jsxImportSource foreign-runtime",
    "@jsx foreignCreateElement",
    "@jsxFrag foreignFragment",
    "@jsxRuntime classic",
  ])("refuses a source JSX pragma %s", (pragma) => {
    expect(
      getRole(
        createFixture(
          undefined,
          `/** ${pragma} */ import {useState} from "react"; const View=()=>useState(0);`,
        ),
      ),
    ).toBe(false);
  });

  it("refuses inherited JSX transformation options", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "tsconfig.json"),
      JSON.stringify({
        extends: "./base.json",
        compilerOptions: { paths: { "@/*": ["./src/*"] } },
      }),
    );
    fs.writeFileSync(
      path.join(fixture.directory, "base.json"),
      JSON.stringify({ compilerOptions: { jsxImportSource: "foreign-runtime" } }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  it("refuses missing or malformed inherited JSX configuration", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "tsconfig.json"),
      JSON.stringify({ extends: "./missing.json" }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  it("records source-transform dependency changes across warm scans", () => {
    const fixture = createFixture();
    const configPath = path.join(fixture.directory, "tsconfig.json");
    fs.writeFileSync(configPath, JSON.stringify({ compilerOptions: { jsx: "preserve" } }));
    const { value, trace } = captureCrossFileProbes(() => getRole(fixture));
    expect(value).toBe(true);
    expect(trace.contentPaths.has(configPath)).toBe(true);
    expect(trace.existencePaths.has(path.join(fixture.directory, ".babelrc"))).toBe(true);
    fs.writeFileSync(
      configPath,
      JSON.stringify({ compilerOptions: { jsxImportSource: "foreign-runtime" } }),
    );
    resetFilesystemCaches();
    expect(getRole(fixture)).toBe(false);
  });

  it.each([".babelrc", "babel.config.js"])(
    "refuses custom Babel configuration %s",
    (configName) => {
      const fixture = createFixture();
      fs.writeFileSync(path.join(fixture.directory, configName), "{}");
      expect(getRole(fixture)).toBe(false);
    },
  );

  it("refuses package-level Babel configuration", () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.directory, "package.json"),
      JSON.stringify({
        dependencies: { react: "^19", "react-dom": "^19", next: "^16" },
        babel: {},
      }),
    );
    expect(getRole(fixture)).toBe(false);
  });

  describe("hasSupportedReadonlySourcePrototypeRole", () => {
    it.each(["native", "canonical"])("accepts the %s filename spelling", (filenameStyle) => {
      const fixture = createRendererFixture();
      expect(
        getReadonlyPrototypeRole(
          {
            ...fixture,
            filename:
              filenameStyle === "canonical"
                ? normalizeFilename(fixture.filename)
                : fixture.filename,
          },
          "marked",
          "Renderer",
          "link",
        ),
      ).toBe(true);
    });

    it.each(["18.0.14", "^18.0.14", "~18.0.14"])(
      "admits a verified ordinary Renderer own method with %s",
      (range) => {
        const fixture = createRendererFixture(range);
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "link")).toBe(true);
      },
    );

    it.each([
      ["marked", "Renderer", "constructor"],
      ["marked", "Renderer", "toString"],
      ["marked", "Renderer", "prototype"],
      ["marked", "Renderer", "unknown"],
      ["marked", "Marked", "link"],
      ["marked", "default", "link"],
      ["marked/lib/marked.esm.js", "Renderer", "link"],
      ["alternative", "Renderer", "link"],
    ])(
      "refuses unsupported constructor or own-method identity %s/%s/%s",
      (source, name, method) => {
        const fixture = createRendererFixture();
        expect(getReadonlyPrototypeRole(fixture, source, name, method)).toBe(false);
      },
    );

    it.each(["18.0.13", "18.0.15", "18.1.0", "19.0.0", "18.0.14-beta.1", "18.0.14+custom"])(
      "refuses unverified installed Renderer version %s",
      (version) => {
        const fixture = createRendererFixture("^18.0.14", { version });
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "text")).toBe(false);
      },
    );

    it.each(["^18.1.0", "^18.0.13", ">=18.0.14", "18.x", "npm:marked@^18.0.14", "workspace:*"])(
      "does not rescue unsupported declaration %s with installed identity",
      (range) => {
        const fixture = createRendererFixture(range);
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
      },
    );

    it("admits an exact intended declaration without installed metadata or a lock", () => {
      const fixture = createFixture({ marked: "18.0.14" });
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
    });

    it.each(["^18.0.14", "~18.0.14"])(
      "requires a source lock for %s even when installed metadata agrees",
      (range) => {
        const fixture = createRendererFixture(range);
        fs.unlinkSync(path.join(fixture.directory, "pnpm-lock.yaml"));
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
        fs.writeFileSync(
          path.join(fixture.directory, "pnpm-lock.yaml"),
          getRendererLockSource(range),
        );
        resetFilesystemCaches();
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
        fs.rmSync(path.join(fixture.directory, "node_modules"), { recursive: true });
        resetFilesystemCaches();
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      },
    );

    it.each([
      {
        name: "unsupported version",
        transform: (source: string) => source.replace("'9.0'", "'8.0'"),
      },
      {
        name: "wrong importer",
        transform: (source: string) => source.replace("  .:", "  packages/other:"),
      },
      {
        name: "stale specifier",
        transform: (source: string) =>
          source.replace('specifier: "^18.0.14"', 'specifier: "^18.1.0"'),
      },
      {
        name: "different resolved version",
        transform: (source: string) => source.replace("version: 18.0.14}", "version: 18.0.15}"),
      },
      {
        name: "peer suffix",
        transform: (source: string) =>
          source.replace("version: 18.0.14}", "version: 18.0.14(react@19.2.0)}"),
      },
      {
        name: "patch suffix",
        transform: (source: string) =>
          source.replace("version: 18.0.14}", "version: 18.0.14(patch_hash=changed)}"),
      },
      {
        name: "wrong integrity",
        transform: (source: string) => source.replace(rendererIntegrity, "sha512-foreign"),
      },
      {
        name: "tarball replacement",
        transform: (source: string) =>
          source.replace(
            `integrity: ${rendererIntegrity}`,
            `integrity: ${rendererIntegrity}, tarball: https://registry.npmjs.org/marked/-/marked-18.0.14.tgz`,
          ),
      },
      {
        name: "nonempty selected snapshot",
        transform: (source: string) =>
          source.replace("marked@18.0.14: {}", "marked@18.0.14: {dependencies: {foreign: 1.0.0}}"),
      },
      {
        name: "duplicate root key",
        transform: (source: string) => `${source}\nlockfileVersion: '9.0'\n`,
      },
      {
        name: "duplicate flow key",
        transform: (source: string) =>
          source.replace("version: 18.0.14}", "version: 18.0.14, version: 18.0.14}"),
      },
      {
        name: "explicit tag",
        transform: (source: string) => source.replace("hasBin: true", "hasBin: !!bool true"),
      },
      {
        name: "anchor",
        transform: (source: string) => source.replace("hasBin: true", "hasBin: &flag true"),
      },
      {
        name: "alias",
        transform: (source: string) => source.replace("hasBin: true", "hasBin: *flag"),
      },
      {
        name: "merge",
        transform: (source: string) => `${source}\nignored: {<<: {field: value}}\n`,
      },
      {
        name: "multiple documents",
        transform: (source: string) => `${source}\n---\nlockfileVersion: '9.0'\n`,
      },
      { name: "directive", transform: (source: string) => `%YAML 1.1\n---\n${source}` },
      {
        name: "BOM tag directive",
        transform: (source: string) => `\uFEFF%TAG !local! tag:example.test,2026:\n---\n${source}`,
      },
      {
        name: "interpolation in selected version",
        transform: (source: string) =>
          source.replace("version: 18.0.14}", "version: '${version}'}"),
      },
      {
        name: "hook checksum",
        transform: (source: string) => `${source}\npnpmfileChecksum: changed\n`,
      },
      {
        name: "extension checksum",
        transform: (source: string) => `${source}\npackageExtensionsChecksum: changed\n`,
      },
      {
        name: "unknown selected locator",
        transform: (source: string) =>
          source.replace("version: 18.0.14}", "version: 'git+https://example.test/renderer.git'}"),
      },
      {
        name: "missing selected snapshot",
        transform: (source: string) => source.replace("marked@18.0.14: {}", "other@18.0.14: {}"),
      },
      {
        name: "protected override",
        transform: (source: string) => `${source}\noverrides: {marked: 18.0.14}\n`,
      },
      {
        name: "protected patch",
        transform: (source: string) =>
          `${source}\npatchedDependencies:\n  marked@18.0.14: {path: update.patch, hash: changed}\n`,
      },
      {
        name: "locked npm alias",
        transform: (source: string) =>
          source.replace(
            "packages:\n",
            "  packages/other:\n    dependencies:\n      icons: {specifier: ^18.0.14, version: marked@18.0.14}\npackages:\n",
          ),
      },
      {
        name: "missing package record",
        transform: (source: string) => source.replace("  marked@18.0.14:\n", "  other@18.0.14:\n"),
      },
      {
        name: "injected direct package",
        transform: (source: string) =>
          source.replace("  .:\n", "  .:\n    dependenciesMeta: {marked: {injected: true}}\n"),
      },
    ])("refuses changed source lock metadata: $name", ({ transform }) => {
      const fixture = createRendererFixture();
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(lockPath, transform(getRendererLockSource()));
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("accepts unrelated source catalogs and catalog overrides without rescuing the selected package", () => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "catalog:\n  bundler: npm:other-bundler@^3.0.0\n",
      );
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      fs.writeFileSync(
        lockPath,
        `${getRendererLockSource()}\ncatalogs:\n  default:\n    bundler: {specifier: 'npm:other-bundler@^3.0.0', version: 3.2.1}\noverrides: {'bundler@*': 'catalog:'}\n`,
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(
        lockPath,
        `${getRendererLockSource()}\ncatalogs:\n  default:\n    marked: {specifier: ^18.0.14, version: 18.0.14}\noverrides: {'marked@*': 'catalog:'}\n`,
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it.each([
      { selector: "bundler@>=2 <4", expected: true },
      { selector: "@tools/bundler@>=2 <4", expected: true },
      { selector: "bundler@3>marked", expected: false },
      { selector: "bundler@>=2>marked", expected: false },
    ])("proves disjoint version-only override selector $selector", ({ selector, expected }) => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-lock.yaml"),
        `${getRendererLockSource()}\noverrides: {${JSON.stringify(selector)}: 3.2.1}\n`,
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(expected);
    });

    it("records absent and changed source locks for exact and ranged declarations", () => {
      const fixture = createFixture({ marked: "18.0.14" });
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      const { value, trace } = captureCrossFileProbes(() =>
        getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code"),
      );
      expect(value).toBe(true);
      expect(trace.existencePaths.has(lockPath)).toBe(true);
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.32.1", dependencies: { marked: "18.0.14" } }),
      );
      fs.writeFileSync(lockPath, getRendererLockSource("18.0.14"));
      resetFilesystemCaches();
      const locked = captureCrossFileProbes(() =>
        getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code"),
      );
      expect(locked.value).toBe(true);
      expect(locked.trace.contentPaths.has(lockPath)).toBe(true);
      fs.writeFileSync(
        lockPath,
        getRendererLockSource("18.0.14").replace(rendererIntegrity, "sha512-other"),
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("supports a full standard YAML lock larger than the old workspace parser bound", () => {
      const fixture = createRendererFixture();
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      fs.writeFileSync(
        lockPath,
        `${getRendererLockSource()}#${" ".repeat(PNPM_LOCK_ROLE_MAX_FILE_BYTES - PNPM_ROLE_MAX_BYTES)}\n`,
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(
        lockPath,
        `${getRendererLockSource()}#${" ".repeat(PNPM_LOCK_ROLE_MAX_FILE_BYTES)}\n`,
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("bounds aggregate source locks across indexed packages", () => {
      const fixture = createRendererFixture();
      const lockSource = `${getRendererLockSource()}#${" ".repeat(PNPM_LOCK_ROLE_MAX_FILE_BYTES - PNPM_ROLE_MAX_BYTES)}\n`;
      fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), lockSource);
      for (const name of ["first", "second"]) {
        const directory = path.join(fixture.directory, name);
        fs.mkdirSync(directory);
        fs.writeFileSync(path.join(directory, "bridge.ts"), "export const label = 'ready';");
        fs.writeFileSync(
          path.join(directory, "package.json"),
          JSON.stringify({ packageManager: "pnpm@10.32.1", dependencies: {} }),
        );
        fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), lockSource);
        resetFilesystemCaches();
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(
          name === "first",
        );
      }
    });

    it.each(["ordinary", "dangling"])("rejects %s source lock symlinks", (kind) => {
      const fixture = createRendererFixture("18.0.14");
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      const targetPath = path.join(fixture.directory, "alternative.yaml");
      if (kind === "ordinary") fs.renameSync(lockPath, targetPath);
      else fs.unlinkSync(lockPath);
      fs.symlinkSync(targetPath, lockPath);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("selects the actual nested source importer rather than the first dependency match", () => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "packages: ['packages/**']\n",
      );
      const packageDirectory = path.join(fixture.directory, "packages", "panel");
      fs.mkdirSync(packageDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        JSON.stringify({ dependencies: { marked: "^18.0.14" } }),
      );
      const filename = path.join(packageDirectory, "panel.ts");
      fs.writeFileSync(
        filename,
        "import { Renderer } from 'marked'; export const current = Renderer;",
      );
      const nestedFixture = { ...fixture, filename };
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      fs.writeFileSync(lockPath, getRendererLockSource().replace("  .:", "  packages/panel:"));
      expect(getReadonlyPrototypeRole(nestedFixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(lockPath, getRendererLockSource());
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(nestedFixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("keeps quoted lock metadata interpolation inert", () => {
      const fixture = createRendererFixture();
      const source = getRendererLockSource()
        .replace(
          "snapshots:\n",
          `  neighbor@1.0.0:\n    resolution: {integrity: placeholder}\n    deprecated: 'Use the literal \${neighbor} label'\nsnapshots:\n`,
        )
        .concat("  neighbor@1.0.0: {}\n# ${registry} is also inert\n");
      fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), source);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
    });

    it("keeps unrelated git, workspace and ordinary metadata outside the selected package proof", () => {
      const fixture = createRendererFixture();
      const source = getRendererLockSource()
        .replace(
          "packages:\n",
          "  packages/neighbor:\n    dependencies:\n      neighbor: {specifier: 'workspace:*', version: 'link:../absent'}\npackages:\n",
        )
        .replace(
          "snapshots:\n",
          "  'neighbor@git+https://example.test/neighbor.git':\n    name: neighbor\n    resolution: {type: git, repo: 'https://example.test/${owner}/neighbor.git', commit: fixed}\n    deprecated: 'literal ${message}'\nsnapshots:\n",
        )
        .concat(
          "  'neighbor@git+https://example.test/neighbor.git': {}\nmetadata: {constructor: inert, prototype: data, __proto__: plain}\n",
        );
      fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), source);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
    });

    it("keeps unrelated workspace data inert while refusing known protected aliases", () => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "packages: ['packages/**']\n",
      );
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.32.1",
          dependencies: { marked: "^18.0.14", neighbor: "workspace:*" },
        }),
      );
      const neighborDirectory = path.join(fixture.directory, "packages", "neighbor");
      fs.mkdirSync(neighborDirectory, { recursive: true });
      const neighborManifest = path.join(neighborDirectory, "package.json");
      fs.writeFileSync(neighborManifest, JSON.stringify({ name: "neighbor", version: "1.0.0" }));
      const source = getRendererLockSource().replace(
        "packages:\n",
        "      neighbor: {specifier: 'workspace:*', version: 'link:./packages/neighbor'}\npackages:\n",
      );
      fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), source);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.unlinkSync(neighborManifest);
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(neighborManifest, JSON.stringify({ name: "marked", version: "18.0.14" }));
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("keeps unrelated tarball data inert while refusing known SDK redirects", () => {
      const fixture = createRendererFixture();
      const source = getRendererLockSource()
        .replace(
          "snapshots:\n",
          "  neighbor@1.0.0:\n    resolution: {tarball: 'https://registry.npmjs.org/neighbor/-/neighbor-1.0.0.tgz'}\nsnapshots:\n",
        )
        .concat("  neighbor@1.0.0: {}\n");
      const lockPath = path.join(fixture.directory, "pnpm-lock.yaml");
      fs.writeFileSync(lockPath, source);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(
        lockPath,
        source.replace("neighbor/-/neighbor-1.0.0.tgz", "marked/-/marked-18.0.14.tgz"),
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("keeps unrelated directory data inert while refusing known protected identities", () => {
      const fixture = createRendererFixture();
      const neighborDirectory = path.join(fixture.directory, "neighbor");
      fs.mkdirSync(neighborDirectory);
      const neighborManifest = path.join(neighborDirectory, "package.json");
      fs.writeFileSync(neighborManifest, JSON.stringify({ name: "neighbor", version: "1.0.0" }));
      const source = getRendererLockSource()
        .replace(
          "snapshots:\n",
          "  'neighbor@file:neighbor':\n    name: neighbor\n    version: 1.0.0\n    resolution: {type: directory, directory: neighbor}\nsnapshots:\n",
        )
        .concat("  'neighbor@file:neighbor': {}\n");
      fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), source);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-lock.yaml"),
        source.replaceAll("'neighbor@file:neighbor'", "'marked@file:neighbor'"),
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
      fs.writeFileSync(path.join(fixture.directory, "pnpm-lock.yaml"), source);
      fs.writeFileSync(neighborManifest, JSON.stringify({ name: "marked", version: "18.0.14" }));
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it.each([
      { name: "other-renderer" },
      { type: "commonjs" },
      { main: "./replacement.js" },
      { module: "./replacement.js" },
      { browser: "./replacement.js" },
      { browser: { marked: "./replacement.js" } },
      { exports: { ".": { default: "./replacement.js" } } },
      {
        exports: {
          ...rendererPackageManifest.exports,
          ".": { ...rendererPackageManifest.exports["."], browser: "./replacement.js" },
        },
      },
      { dependencies: { alternate: "npm:marked@^18.0.14" } },
    ])("refuses contradictory pinned package metadata %#", (changes) => {
      const fixture = createRendererFixture("^18.0.14", changes);
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
      "closes protected Renderer aliases in %s",
      (field) => {
        const fixture = createRendererFixture();
        fs.writeFileSync(
          path.join(fixture.directory, "package.json"),
          JSON.stringify({
            dependencies: { marked: "^18.0.14" },
            [field]: {
              ...(field === "dependencies" ? { marked: "^18.0.14" } : {}),
              alias: "npm:marked@^18.0.14",
            },
          }),
        );
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
      },
    );

    it("preserves disjoint aliases and records installed metadata freshness", () => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.32.1",
          dependencies: { marked: "^18.0.14", alternate: "npm:other-renderer@^3" },
        }),
      );
      const installedPath = path.join(fixture.directory, "node_modules", "marked", "package.json");
      const { value, trace } = captureCrossFileProbes(() =>
        getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code"),
      );
      expect(value).toBe(true);
      expect(trace.contentPaths.has(installedPath)).toBe(true);
      fs.writeFileSync(
        installedPath,
        JSON.stringify({ ...rendererPackageManifest, version: "18.0.15" }),
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("closes sibling-package aliases throughout the actual indexed source universe", () => {
      const fixture = createRendererFixture();
      const siblingDirectory = path.join(fixture.directory, "support");
      fs.mkdirSync(siblingDirectory);
      fs.writeFileSync(
        path.join(siblingDirectory, "bridge.ts"),
        "import { Renderer as Alternate } from 'icons'; export const current = Alternate;",
      );
      const siblingManifestPath = path.join(siblingDirectory, "package.json");
      fs.writeFileSync(
        siblingManifestPath,
        JSON.stringify({ dependencies: { icons: "npm:other-renderer@^3" } }),
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(
        siblingManifestPath,
        JSON.stringify({ dependencies: { icons: "npm:marked@^18.0.14" } }),
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it.each(["file:./node_modules/marked", "link:./node_modules/marked", "workspace:marked@*"])(
      "closes local and workspace aliases to the constructor package %s",
      (alias) => {
        const fixture = createRendererFixture();
        fs.writeFileSync(
          path.join(fixture.directory, "package.json"),
          JSON.stringify({
            packageManager: "pnpm@10.32.1",
            dependencies: { marked: "^18.0.14", alternate: alias },
          }),
        );
        expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
      },
    );

    it("requires a direct dependency rather than peer-only metadata", () => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ peerDependencies: { marked: "^18.0.14" } }),
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it.each([
      { overrides: { marked: "18.0.15" } },
      { resolutions: { marked: "18.0.14" } },
      { pnpm: { overrides: { marked: "npm:other-renderer@^18" } } },
      { imports: { marked: "./replacement.js" } },
    ])("rejects Renderer resolution overrides %#", (settings) => {
      const fixture = createRendererFixture();
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.32.1",
          dependencies: { marked: "^18.0.14" },
          ...settings,
        }),
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("checks canonical selected catalog identity without rescuing literals", () => {
      const fixture = createRendererFixture("catalog:rendering");
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.29.1",
          dependencies: { marked: "catalog:rendering" },
        }),
      );
      const workspacePath = path.join(fixture.directory, "pnpm-workspace.yaml");
      fs.writeFileSync(workspacePath, "catalogs:\n  rendering:\n    marked: ^18.0.14\n");
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(true);
      fs.writeFileSync(workspacePath, "catalogs:\n  rendering:\n    marked: ~18.0.14\n");
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
      fs.writeFileSync(workspacePath, "catalogs:\n  rendering:\n    marked: npm:marked@^18.0.14\n");
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });

    it("rejects local source and configured package aliases", () => {
      const fixture = createRendererFixture();
      fs.writeFileSync(path.join(fixture.directory, "marked.ts"), "export class Renderer {};");
      fs.writeFileSync(
        path.join(fixture.directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      );
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
      fs.unlinkSync(path.join(fixture.directory, "marked.ts"));
      fs.writeFileSync(
        path.join(fixture.directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { marked: ["./replacement.ts"] } } }),
      );
      resetFilesystemCaches();
      expect(getReadonlyPrototypeRole(fixture, "marked", "Renderer", "code")).toBe(false);
    });
  });

  describe("hasSupportedNativeUiSdkRole", () => {
    it.each(["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"])(
      "refuses protected npm aliases in %s",
      (field) => {
        const fixture = createFixture({ "lucide-react": "^1" });
        const dependencies = {
          "lucide-react": "^1",
          ...(field === "dependencies" ? { icons: "npm:lucide-react@^1" } : {}),
        };
        fs.writeFileSync(
          path.join(fixture.directory, "package.json"),
          JSON.stringify({
            dependencies,
            ...(field === "dependencies" ? {} : { [field]: { icons: "npm:lucide-react@^1" } }),
          }),
        );
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
      },
    );

    it.each([
      { alias: "npm:lucide-react@^1", expected: false },
      { alias: "npm:@base-ui/react@^1", expected: false },
      { alias: "npm:react@^19", expected: false },
      { alias: "npm:react-dom@^19", expected: false },
      { alias: "npm:next@^16", expected: false },
      { alias: "npm:other-visual@^3", expected: true },
      { alias: "npm:@other/visual@^3", expected: true },
      { alias: "npm:unknown@npm:lucide-react@1", expected: false },
      { alias: "npm:", expected: false },
      { alias: "workspace:lucide-react@*", expected: false },
      { alias: "file:./node_modules/lucide-react", expected: false },
      { alias: "link:./node_modules/@base-ui/react", expected: false },
      { alias: "./node_modules/lucide-react", expected: false },
    ])("closes direct dependency alias identity $alias", ({ alias, expected }) => {
      const fixture = createFixture({ "lucide-react": "^1", icons: alias });
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(expected);
    });

    it("checks protected aliases in ancestor and installed manifests", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      const nestedDirectory = path.join(fixture.directory, "visual");
      fs.mkdirSync(nestedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nestedDirectory, "package.json"),
        JSON.stringify({ dependencies: { "lucide-react": "^1" } }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ dependencies: { iconAlias: "npm:lucide-react@^1" } }),
      );
      expect(
        hasSupportedNativeUiSdkRole(path.join(nestedDirectory, "icon.tsx"), "lucide-react"),
      ).toBe(false);
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ dependencies: { "lucide-react": "^1" } }),
      );
      const installedDirectory = path.join(fixture.directory, "node_modules", "lucide-react");
      fs.mkdirSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(installedDirectory, "package.json"),
        JSON.stringify({
          name: "lucide-react",
          version: "1.0.0",
          dependencies: { frameworkAlias: "npm:react@^19" },
        }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("closes aliases referenced through the selected catalog and rechecks warm edits", () => {
      const fixture = createFixture({ "lucide-react": "^1", icons: "catalog:visual" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.29.1",
          dependencies: { "lucide-react": "^1", icons: "catalog:visual" },
        }),
      );
      const workspacePath = path.join(fixture.directory, "pnpm-workspace.yaml");
      fs.writeFileSync(workspacePath, "catalogs:\n  visual:\n    icons: npm:other-visual@^3\n");
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(workspacePath, "catalogs:\n  visual:\n    icons: npm:lucide-react@^1\n");
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("checks bounded local alias metadata without trusting protected identities", () => {
      const fixture = createFixture({ "lucide-react": "^1", icons: "file:./visual" });
      const localDirectory = path.join(fixture.directory, "visual");
      fs.mkdirSync(localDirectory);
      const manifestPath = path.join(localDirectory, "package.json");
      fs.writeFileSync(manifestPath, JSON.stringify({ name: "other-visual", version: "1.0.0" }));
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(manifestPath, JSON.stringify({ name: "lucide-react", version: "1.0.0" }));
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("checks installed dependency identities and rechecks warm manifest edits", () => {
      const fixture = createFixture({ "lucide-react": "^1", icons: "^1" });
      const installedDirectory = path.join(fixture.directory, "node_modules", "icons");
      fs.mkdirSync(installedDirectory, { recursive: true });
      const manifestPath = path.join(installedDirectory, "package.json");
      fs.writeFileSync(manifestPath, JSON.stringify({ name: "icons", version: "1.0.0" }));
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(manifestPath, JSON.stringify({ name: "lucide-react", version: "1.0.0" }));
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("revokes modern framework and SDK roles when a protected alias appears", () => {
      const fixture = createFixture({
        react: "^19",
        "react-dom": "^19",
        next: "^16",
        "lucide-react": "^1",
      });
      expect(getRole(fixture)).toBe(true);
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          dependencies: {
            react: "^19",
            "react-dom": "^19",
            next: "^16",
            "lucide-react": "^1",
            frameworkAlias: "npm:react@^19",
          },
        }),
      );
      resetFilesystemCaches();
      expect(getRole(fixture)).toBe(false);
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it.each([
      "@base-ui/react/avatar",
      "@base-ui/react/use-render",
      "@base-ui/react/merge-props",
      "lucide-react",
    ])("admits a canonical stable-major-one declaration for %s", (source) => {
      const fixture = createFixture({ "@base-ui/react": "^1.0.0", "lucide-react": "~1.3.0" });
      expect(hasSupportedNativeUiSdkRole(fixture.filename, source)).toBe(true);
    });

    it.each(["1.2.0", "^1.0.0", "~1.2.0", "1.x", ">=1.0.0 <2", "^1.0.0 || ~1.2.0"])(
      "admits contained SDK range %s",
      (range) => {
        const fixture = createFixture({ "@base-ui/react": range });
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(true);
      },
    );

    it.each([
      ">=1",
      "^0.9 || ^1",
      ">=1 <3",
      "^2",
      "1.0.0-beta.1",
      "workspace:^1",
      "npm:replacement@1.0.0",
      "file:../mock",
      "latest",
      "*",
    ])("refuses uncertain SDK range %s", (range) => {
      const fixture = createFixture({ "@base-ui/react": range });
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
    });

    it.each([
      "@base-ui/react",
      "@base-ui/react/button",
      "@base-ui/react/avatar/extra",
      "lucide-react/dynamic",
      "other-icons",
    ])("refuses unsupported source %s", (source) => {
      const fixture = createFixture({ "@base-ui/react": "^1", "lucide-react": "^1" });
      expect(hasSupportedNativeUiSdkRole(fixture.filename, source)).toBe(false);
    });

    it.each([
      { name: "@base-ui/react", version: "1.2.0", expectedRole: true },
      { name: "replacement", version: "1.2.0", expectedRole: false },
      { name: "@base-ui/react", version: "2.0.0", expectedRole: false },
      { name: "@base-ui/react", version: "1.2.0-beta.1", expectedRole: false },
      { name: "@base-ui/react", version: "unknown", expectedRole: false },
    ])(
      "checks installed SDK identity and stable version $name/$version",
      ({ name, version, expectedRole }) => {
        const fixture = createFixture({ "@base-ui/react": "^1" });
        const installedDirectory = path.join(fixture.directory, "node_modules", "@base-ui/react");
        fs.mkdirSync(installedDirectory, { recursive: true });
        fs.writeFileSync(
          path.join(installedDirectory, "package.json"),
          JSON.stringify({ name, version }),
        );
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(
          expectedRole,
        );
      },
    );

    it("requires contained declarations even when installed metadata is stable-major-one", () => {
      const fixture = createFixture({ "@base-ui/react": ">=1" });
      const installedDirectory = path.join(fixture.directory, "node_modules", "@base-ui/react");
      fs.mkdirSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(installedDirectory, "package.json"),
        JSON.stringify({ name: "@base-ui/react", version: "1.2.0" }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
    });

    it("checks the actual importing package and every duplicate dependency declaration", () => {
      const fixture = createFixture({ "@base-ui/react": "^1" });
      const nestedDirectory = path.join(fixture.directory, "widgets");
      fs.mkdirSync(nestedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nestedDirectory, "package.json"),
        JSON.stringify({ dependencies: { "@base-ui/react": "^2" } }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(true);
      expect(
        hasSupportedNativeUiSdkRole(
          path.join(nestedDirectory, "badge.tsx"),
          "@base-ui/react/avatar",
        ),
      ).toBe(false);
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          dependencies: { "@base-ui/react": "^1" },
          peerDependencies: { "@base-ui/react": "^0.9 || ^1" },
        }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
    });

    it.each([
      { overrides: { "@base-ui/react": "file:./replacement" } },
      { resolutions: { "@base-ui/react": "npm:replacement@1.0.0" } },
      { browser: { "@base-ui/react/avatar": "./replacement.js" } },
      { imports: { "@base-ui/react/avatar": "./replacement.js" } },
      { pnpm: { overrides: { "@base-ui/react": "file:./replacement" } } },
    ])("refuses consuming-package import mapping contradictions", (mapping) => {
      const fixture = createFixture({ "@base-ui/react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ dependencies: { "@base-ui/react": "^1" }, ...mapping }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
    });

    it("probes ancestor package overrides for a nested importer", () => {
      const fixture = createFixture({ "@base-ui/react": "^1" });
      const nestedDirectory = path.join(fixture.directory, "widgets");
      fs.mkdirSync(nestedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nestedDirectory, "package.json"),
        JSON.stringify({ dependencies: { "@base-ui/react": "^1" } }),
      );
      const filename = path.join(nestedDirectory, "badge.tsx");
      expect(hasSupportedNativeUiSdkRole(filename, "@base-ui/react/avatar")).toBe(true);
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ overrides: { "@base-ui/react": "file:./replacement" } }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(filename, "@base-ui/react/avatar")).toBe(false);
    });

    it("refuses installed SDK browser replacements and local self references", () => {
      const fixture = createFixture({ "@base-ui/react": "^1" });
      const installedDirectory = path.join(fixture.directory, "node_modules", "@base-ui/react");
      fs.mkdirSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(installedDirectory, "package.json"),
        JSON.stringify({
          name: "@base-ui/react",
          version: "1.2.0",
          browser: { "./avatar": "./replacement.js" },
        }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
      fs.rmSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ name: "@base-ui/react", dependencies: { "@base-ui/react": "^1" } }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
    });

    it.each(["@base-ui/react/avatar", "@base-ui/react/*", "@base-ui/react"])(
      "refuses configured SDK aliases %s",
      (source) => {
        const fixture = createFixture({ "@base-ui/react": "^1" });
        fs.writeFileSync(
          path.join(fixture.directory, "tsconfig.json"),
          JSON.stringify({ compilerOptions: { paths: { [source]: ["./absent-mock.ts"] } } }),
        );
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(false);
      },
    );

    it("refuses SDK sources resolved to local files through baseUrl", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "lucide-react.ts"),
        "export const Icon = foreign;",
      );
      fs.writeFileSync(
        path.join(fixture.directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { baseUrl: "." } }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("records SDK facts on warm lookups and rechecks newly installed incompatible metadata", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      const { value, trace } = captureCrossFileProbes(() =>
        hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react"),
      );
      expect(value).toBe(true);
      expect(trace.contentPaths.has(path.join(fixture.directory, "package.json"))).toBe(true);
      expect(
        trace.contentPaths.has(
          path.join(fixture.directory, "node_modules/lucide-react/package.json"),
        ),
      ).toBe(true);
      expect(trace.contentPaths.has(path.join(fixture.directory, "tsconfig.json"))).toBe(true);
      const installedDirectory = path.join(fixture.directory, "node_modules", "lucide-react");
      fs.mkdirSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(installedDirectory, "package.json"),
        JSON.stringify({ name: "lucide-react", version: "2.0.0" }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("refuses SDK aliases introduced in a warm source configuration", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(
        path.join(fixture.directory, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { paths: { "lucide-react": ["./replacement.ts"] } } }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it.each([
      "pnpm-workspace.yaml",
      ".pnpmfile.cjs",
      ".yarnrc.yml",
      ".pnp.cjs",
      ".npmrc",
      "import-map.json",
    ])("refuses unproved package mapping configuration %s", (configName) => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(path.join(fixture.directory, configName), "unproved mapping configuration");
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("records absent package mapping configuration and detects its introduction", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      const configPath = path.join(fixture.directory, "pnpm-workspace.yaml");
      const { value, trace } = captureCrossFileProbes(() =>
        hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react"),
      );
      expect(value).toBe(true);
      expect(trace.existencePaths.has(configPath)).toBe(true);
      fs.writeFileSync(configPath, "overrides:\n  lucide-react: file:./replacement\n");
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("admits a fully structured ordinary pnpm workspace with unrelated settings", () => {
      const fixture = createFixture({ "@base-ui/react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.29.1",
          dependencies: { "@base-ui/react": "^1" },
        }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        `packages:
  - packages/*
  - packages/**
catalog:
  '@base-ui/react': ^2.0.0
  alternative: npm:other-alternative@^3.0.0
catalogs:
  tools:
    alternative: npm:other-alternative@^4.0.0
overrides:
  compiler@^2.0.0: ^2.4.0
  other-package: npm:other-fork@^4.0.0
onlyBuiltDependencies: ['esbuild', 'tooling']
peerDependencyRules:
  ignoreMissing:
    - tooling
  allowAny: ['other-types']
  allowedVersions:
    typescript: ^5.0.0
`,
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "@base-ui/react/avatar")).toBe(true);
    });

    it.each([
      {
        selector: "bundler@*",
        reference: "catalog:",
        catalogs: "catalog:\n  bundler: npm:bundler-alternate@^3.0.0\n",
        expected: true,
      },
      {
        selector: "bundler@*",
        reference: "catalog:default",
        catalogs: "catalog:\n  bundler: ^3.0.0\n",
        expected: true,
      },
      {
        selector: "bundler@*",
        reference: "catalog:tools",
        catalogs: "catalogs:\n  tools:\n    bundler: npm:bundler-alternate@^3.0.0\n",
        expected: true,
      },
      {
        selector: "bundler@*",
        reference: "catalog:tools",
        catalogs: "catalog:\n  bundler: ^3.0.0\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:missing",
        catalogs: "catalogs:\n  tools:\n    bundler: ^3.0.0\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:",
        catalogs: "catalog:\n  other-bundler: ^3.0.0\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:",
        catalogs:
          "catalog:\n  bundler: 'catalog:tools'\ncatalogs:\n  tools:\n    bundler: ^3.0.0\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:",
        catalogs: "catalog:\n  bundler: npm:react@^19\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:tools",
        catalogs: "catalogs:\n  tools:\n    bundler: npm:@base-ui/react@^1\n",
        expected: false,
      },
      {
        selector: "lucide-react",
        reference: "catalog:",
        catalogs: "catalog:\n  lucide-react: ^1.0.0\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:",
        catalogs: "catalog:\n  bundler: ^3.0.0\ncatalogs:\n  default:\n    bundler: ^3.0.0\n",
        expected: false,
      },
      {
        selector: "bundler@*",
        reference: "catalog:",
        catalogs: "catalog:\n  bundler: npm:bundler-alternate@catalog:tools\n",
        expected: false,
      },
    ])(
      "closes a disjoint override catalog lookup $selector/$reference",
      ({ selector, reference, catalogs, expected }) => {
        const fixture = createFixture({ "lucide-react": "^1" });
        fs.writeFileSync(
          path.join(fixture.directory, "package.json"),
          JSON.stringify({
            packageManager: "pnpm@10.29.1",
            dependencies: { "lucide-react": "^1" },
          }),
        );
        fs.writeFileSync(
          path.join(fixture.directory, "pnpm-workspace.yaml"),
          `${catalogs}overrides:\n  '${selector}': '${reference}'\n`,
        );
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(expected);
      },
    );

    it("uses workspace catalogs for a disjoint manifest override and rechecks target changes", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.29.1",
          dependencies: { "lucide-react": "^1" },
          pnpm: { overrides: { "bundler@*": "catalog:tools" } },
        }),
      );
      const workspacePath = path.join(fixture.directory, "pnpm-workspace.yaml");
      fs.writeFileSync(
        workspacePath,
        "catalogs:\n  tools:\n    bundler: npm:bundler-alternate@^3.0.0\n",
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(workspacePath, "catalogs:\n  tools:\n    bundler: npm:react-dom@^19\n");
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("does not rescue an incompatible literal SDK through an unrelated override catalog", () => {
      const fixture = createFixture({ "lucide-react": "^2" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.29.1", dependencies: { "lucide-react": "^2" } }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "catalog:\n  lucide-react: ^1.0.0\n  bundler: npm:bundler-alternate@^3.0.0\noverrides:\n  'bundler@*': 'catalog:'\n",
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("refuses competing unsupported catalog definitions in a manifest pnpm block", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.29.1",
          dependencies: { "lucide-react": "^1" },
          pnpm: { catalog: { bundler: "npm:react@^19" }, overrides: { "bundler@*": "catalog:" } },
        }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "catalog:\n  bundler: npm:bundler-alternate@^3.0.0\n",
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it.each([
      { declared: "catalog:", catalogs: "catalog:\n  lucide-react: ^1.0.0\n", expected: true },
      {
        declared: "catalog:default",
        catalogs: "catalog:\n  lucide-react: ^1.0.0\n",
        expected: true,
      },
      {
        declared: "catalog:visual",
        catalogs: "catalogs:\n  visual:\n    lucide-react: ^1.0.0\n",
        expected: true,
      },
      {
        declared: "catalog:missing",
        catalogs: "catalogs:\n  visual:\n    lucide-react: ^1.0.0\n",
        expected: false,
      },
      {
        declared: "catalog:visual",
        catalogs: "catalog:\n  lucide-react: ^1.0.0\n",
        expected: false,
      },
      {
        declared: "catalog:",
        catalogs:
          "catalog:\n  lucide-react: 'catalog:visual'\ncatalogs:\n  visual:\n    lucide-react: ^1.0.0\n",
        expected: false,
      },
      {
        declared: "catalog:",
        catalogs: "catalog:\n  lucide-react: npm:replacement@1.0.0\n",
        expected: false,
      },
      { declared: "catalog:", catalogs: "catalog:\n  lucide-react: '>=1'\n", expected: false },
      { declared: "^2", catalogs: "catalog:\n  lucide-react: ^1.0.0\n", expected: false },
      { declared: "^1", catalogs: "catalog:\n  lucide-react: ^2.0.0\n", expected: true },
    ])(
      "resolves only the actual explicit catalog declaration $declared",
      ({ declared, catalogs, expected }) => {
        const fixture = createFixture({ "lucide-react": declared });
        fs.writeFileSync(
          path.join(fixture.directory, "package.json"),
          JSON.stringify({
            packageManager: "pnpm@10.29.1",
            dependencies: { "lucide-react": declared },
          }),
        );
        fs.writeFileSync(path.join(fixture.directory, "pnpm-workspace.yaml"), catalogs);
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(expected);
      },
    );

    it.each([
      "overrides:\n  lucide-react: ^1.0.0\n",
      "overrides:\n  'react@^19': ^19.0.0\n",
      "overrides:\n  alternative: npm:lucide-react@1.0.0\n",
      "overrides:\n  '*': ^1.0.0\n",
      "overrides:\n  'parent>lucide-react': ^1.0.0\n",
      "overrides:\n  'other@1unknown|range': ^1.0.0\n",
      "peerDependencyRules:\n  allowedVersions:\n    react: ^19\n",
      "linkWorkspacePackages: true\n",
      "linkWorkspacePackages: deep\n",
      "preferWorkspacePackages: true\n",
      "injectWorkspacePackages: true\n",
      "registry: https://example.invalid\n",
      "pnpmfile: ./hooks.cjs\n",
      "catalog:\n  lucide-react: ^1\n  lucide-react: ^2\n",
      "catalog: &shared\n  lucide-react: ^1\n",
      "catalog:\n  '<<': *shared\n",
      "catalog: !custom {}\n",
      "---\ncatalog:\n  lucide-react: ^1\n",
      "catalog:\n  lucide-react: '${SDK_RANGE}'\n",
      "catalog:\n   lucide-react: ^1\n",
      "catalog: { lucide-react: ^1 }\n",
      "catalog:\n  other-package: TRUE\n",
      "catalog:\n  other-package: 1e2\n",
      "overrides: {}\noverrides: {}\n",
      "catalog:\n  lucide-react: ^1\ncatalogs:\n  default:\n    lucide-react: ^1\n",
      "packages:\n  - ../outside/**\n",
    ])("refuses unknown or overlapping pnpm workspace settings: %s", (settings) => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.29.1", dependencies: { "lucide-react": "^1" } }),
      );
      fs.writeFileSync(path.join(fixture.directory, "pnpm-workspace.yaml"), settings);
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("uses pnpm10 disabled-link defaults without trusting workspace SDK candidates", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.29.1", dependencies: { "lucide-react": "^1" } }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "packages:\n  - packages/**\nautoInstallPeers: true\n",
      );
      const localDirectory = path.join(fixture.directory, "packages", "visual", "nested");
      fs.mkdirSync(localDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(localDirectory, "package.json"),
        JSON.stringify({ name: "lucide-react", version: "1.0.0" }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "packages:\n  - packages/**\nlinkWorkspacePackages: true\n",
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("rejects peer-only SDK declarations and explicit local injections", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ peerDependencies: { "lucide-react": "^1" } }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          dependencies: { "lucide-react": "^1" },
          dependenciesMeta: { "lucide-react": { injected: true } },
        }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("admits disjoint manifest pnpm settings and revokes an introduced protected override", () => {
      const fixture = createFixture({ "lucide-react": "^1" });
      const manifestPath = path.join(fixture.directory, "package.json");
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          dependencies: { "lucide-react": "^1" },
          pnpm: {
            overrides: { "compiler@^2": "^2.1" },
            peerDependencyRules: { allowedVersions: { typescript: "^5" } },
            onlyBuiltDependencies: ["tooling"],
          },
        }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(true);
      fs.writeFileSync(
        manifestPath,
        JSON.stringify({
          dependencies: { "lucide-react": "^1" },
          pnpm: { overrides: { "lucide-react": "npm:replacement@^1" } },
        }),
      );
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("records workspace contents and revokes a warm catalog certificate on edits", () => {
      const fixture = createFixture({ "lucide-react": "catalog:visual" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({
          packageManager: "pnpm@10.29.1",
          dependencies: { "lucide-react": "catalog:visual" },
        }),
      );
      const workspacePath = path.join(fixture.directory, "pnpm-workspace.yaml");
      fs.writeFileSync(workspacePath, "catalogs:\n  visual:\n    lucide-react: ^1.0.0\n");
      const { value, trace } = captureCrossFileProbes(() =>
        hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react"),
      );
      expect(value).toBe(true);
      expect(trace.contentPaths.has(workspacePath)).toBe(true);
      fs.writeFileSync(workspacePath, "catalogs:\n  visual:\n    lucide-react: ^2.0.0\n");
      resetFilesystemCaches();
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("keeps direct literal declarations authoritative over installed and catalog versions", () => {
      const fixture = createFixture({ "lucide-react": "^2" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.29.1", dependencies: { "lucide-react": "^2" } }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "catalog:\n  lucide-react: ^1.0.0\n",
      );
      const installedDirectory = path.join(fixture.directory, "node_modules", "lucide-react");
      fs.mkdirSync(installedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(installedDirectory, "package.json"),
        JSON.stringify({ name: "lucide-react", version: "1.0.0" }),
      );
      expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
    });

    it("uses the actual nested importer's declaration under a recursive workspace pattern", () => {
      const fixture = createFixture({ "lucide-react": "^2" });
      fs.writeFileSync(
        path.join(fixture.directory, "package.json"),
        JSON.stringify({ packageManager: "pnpm@10.29.1", dependencies: { "lucide-react": "^2" } }),
      );
      fs.writeFileSync(
        path.join(fixture.directory, "pnpm-workspace.yaml"),
        "packages:\n  - packages/**\nlinkWorkspacePackages: false\npreferWorkspacePackages: false\n",
      );
      const nestedDirectory = path.join(fixture.directory, "packages", "nested", "visual");
      fs.mkdirSync(nestedDirectory, { recursive: true });
      fs.writeFileSync(
        path.join(nestedDirectory, "package.json"),
        JSON.stringify({ dependencies: { "lucide-react": "^1" } }),
      );
      expect(
        hasSupportedNativeUiSdkRole(path.join(nestedDirectory, "icon.tsx"), "lucide-react"),
      ).toBe(true);
    });

    it.each(["pnpm@9.15.0", "pnpm@11.0.0", "pnpm@10.01.0", "pnpm@10.1.0-beta.1"])(
      "refuses unknown workspace defaults for %s",
      (packageManager) => {
        const fixture = createFixture({ "lucide-react": "^1" });
        fs.writeFileSync(
          path.join(fixture.directory, "package.json"),
          JSON.stringify({ packageManager, dependencies: { "lucide-react": "^1" } }),
        );
        fs.writeFileSync(
          path.join(fixture.directory, "pnpm-workspace.yaml"),
          "packages:\n  - packages/*\n",
        );
        expect(hasSupportedNativeUiSdkRole(fixture.filename, "lucide-react")).toBe(false);
      },
    );
  });
});
