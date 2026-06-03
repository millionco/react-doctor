import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import type { Diagnostic } from "../src/index.js";
import { createNodeReadFileLinesSync, mergeAndFilterDiagnostics } from "../src/index.js";
import { classifyPackageRole } from "../src/utils/classify-package-role.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-classify-role-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const writeManifest = (dir: string, manifest: Record<string, unknown>): void => {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
};

const writeSource = (filePath: string): void => {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, "export const x = 1;\n");
};

describe("classifyPackageRole", () => {
  it("classifies a package with name + exports as a library", () => {
    const caseRoot = path.join(tempRoot, "publish-contract");
    const packageDir = path.join(caseRoot, "ui");
    writeManifest(packageDir, { name: "@scope/ui", exports: { ".": "./index.js" } });
    const file = path.join(packageDir, "src", "Button.tsx");
    writeSource(file);
    expect(classifyPackageRole(file)).toBe("library");
  });

  it("classifies a published package under packages/* (name + exports) as a library", () => {
    const caseRoot = path.join(tempRoot, "monorepo-packages-published");
    const packageDir = path.join(caseRoot, "packages", "design-system");
    writeManifest(packageDir, { name: "design-system", exports: { ".": "./index.js" } });
    const file = path.join(packageDir, "src", "Card.tsx");
    writeSource(file);
    expect(classifyPackageRole(file)).toBe("library");
  });

  // RDE regression: usebruno/bruno's `packages/bruno-app` is a private Electron
  // app with no `exports`. The old `packages/` → library directory heuristic
  // wrongly silenced its app-only diagnostics. A package under `packages/`
  // without a publish contract must NOT classify as a library.
  it("does not classify a private app under packages/* (no exports) as a library", () => {
    const caseRoot = path.join(tempRoot, "monorepo-packages-app");
    const packageDir = path.join(caseRoot, "packages", "bruno-app");
    writeManifest(packageDir, { name: "@usebruno/app", private: true });
    const file = path.join(packageDir, "src", "components", "Sidebar.tsx");
    writeSource(file);
    expect(classifyPackageRole(file)).not.toBe("library");
  });

  // RDE regression: appsmith's `app/client` is a private application that
  // declares a niche `exports: { "./lib/*": … }` for internal path aliases.
  // `private: true` must disqualify it from the library publish contract.
  it("does not classify a private app with a niche exports map as a library", () => {
    const caseRoot = path.join(tempRoot, "private-app-with-exports");
    const packageDir = path.join(caseRoot, "client");
    writeManifest(packageDir, {
      name: "appsmith",
      private: true,
      exports: { "./lib/*": "./lib/*.js" },
    });
    const file = path.join(packageDir, "src", "pages", "Editor.tsx");
    writeSource(file);
    expect(classifyPackageRole(file)).not.toBe("library");
  });

  it("classifies a file under apps/* as an app", () => {
    const caseRoot = path.join(tempRoot, "monorepo-apps");
    const packageDir = path.join(caseRoot, "apps", "web");
    writeManifest(packageDir, { name: "web", private: true });
    const file = path.join(packageDir, "src", "App.tsx");
    writeSource(file);
    expect(classifyPackageRole(file)).toBe("app");
  });

  it("returns unknown when there is no nearby package.json", () => {
    const file = path.join(tempRoot, "loose", "App.tsx");
    writeSource(file);
    expect(classifyPackageRole(file)).toBe("unknown");
  });
});

const buildDiagnostic = (overrides: Partial<Diagnostic> = {}): Diagnostic => ({
  filePath: "src/App.tsx",
  plugin: "react-hooks-js",
  rule: "static-components",
  severity: "error",
  message: "Component defined in render",
  help: "",
  line: 2,
  column: 1,
  category: "Maintainability",
  ...overrides,
});

describe("app-only rule gating in the diagnostic pipeline", () => {
  it("drops static-components on a library file", () => {
    const packageDir = path.join(tempRoot, "gate-library", "packages", "ui");
    writeManifest(packageDir, { name: "@scope/ui", exports: { ".": "./index.js" } });
    writeSource(path.join(packageDir, "src", "Button.tsx"));
    const result = mergeAndFilterDiagnostics(
      [buildDiagnostic({ filePath: "src/Button.tsx" })],
      packageDir,
      null,
      createNodeReadFileLinesSync(packageDir),
    );
    expect(result).toHaveLength(0);
  });

  it("keeps static-components on an app file", () => {
    const packageDir = path.join(tempRoot, "gate-app", "apps", "web");
    writeManifest(packageDir, { name: "web", private: true });
    writeSource(path.join(packageDir, "src", "App.tsx"));
    const result = mergeAndFilterDiagnostics(
      [buildDiagnostic({ filePath: "src/App.tsx" })],
      packageDir,
      null,
      createNodeReadFileLinesSync(packageDir),
    );
    expect(result).toHaveLength(1);
  });

  it("keeps static-components in a private app under packages/* (no exports)", () => {
    const packageDir = path.join(tempRoot, "gate-monorepo-app", "packages", "bruno-app");
    writeManifest(packageDir, { name: "@usebruno/app", private: true });
    writeSource(path.join(packageDir, "src", "components", "Sidebar.tsx"));
    const result = mergeAndFilterDiagnostics(
      [buildDiagnostic({ filePath: "src/components/Sidebar.tsx" })],
      packageDir,
      null,
      createNodeReadFileLinesSync(packageDir),
    );
    expect(result).toHaveLength(1);
  });

  it("keeps static-components on a library file when explicitly opted in", () => {
    const packageDir = path.join(tempRoot, "gate-library-optin", "packages", "ui");
    writeManifest(packageDir, { name: "@scope/ui2", exports: { ".": "./index.js" } });
    writeSource(path.join(packageDir, "src", "Button.tsx"));
    const result = mergeAndFilterDiagnostics(
      [buildDiagnostic({ filePath: "src/Button.tsx" })],
      packageDir,
      { rules: { "react-hooks-js/static-components": "error" } },
      createNodeReadFileLinesSync(packageDir),
    );
    expect(result).toHaveLength(1);
  });

  // Bugbot #614: a broad `categories` bump is NOT a deliberate per-rule opt-in,
  // so it must not leak app-only rules back into a published library.
  it("still drops static-components on a library when only a category override is set", () => {
    const packageDir = path.join(tempRoot, "gate-library-category", "packages", "ui");
    writeManifest(packageDir, { name: "@scope/ui3", exports: { ".": "./index.js" } });
    writeSource(path.join(packageDir, "src", "Button.tsx"));
    const result = mergeAndFilterDiagnostics(
      [buildDiagnostic({ filePath: "src/Button.tsx", category: "Maintainability" })],
      packageDir,
      { categories: { Maintainability: "error" } },
      createNodeReadFileLinesSync(packageDir),
    );
    expect(result).toHaveLength(0);
  });
});
