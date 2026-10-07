import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { runRule } from "../../test-utils/run-rule.js";
import { wrapNextjsRule } from "./wrap-nextjs-rule.js";
import type { Rule } from "./rule.js";

const probeRule: Rule = {
  id: "nextjs-gate-probe",
  severity: "warn",
  create: (context) => ({
    Program(node) {
      context.report({ node, message: "probe fired" });
    },
  }),
};

const wrappedProbe = wrapNextjsRule(probeRule);

describe("wrap-nextjs-rule", () => {
  let temporaryDirectory = "";

  beforeEach(() => {
    temporaryDirectory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rd-nextjs-gate-")));
  });

  afterEach(() => {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  });

  const createPackageFilename = (manifest: Record<string, unknown>): string => {
    const packageDirectory = fs.mkdtempSync(path.join(temporaryDirectory, "package-"));
    fs.writeFileSync(path.join(packageDirectory, "package.json"), JSON.stringify(manifest));
    return path.join(packageDirectory, "app", "page.tsx");
  };

  const rootDirectorySettings = () => ({
    "react-doctor": { rootDirectory: fs.realpathSync(temporaryDirectory) },
  });

  it("fires in a package that declares next in dependencies", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ dependencies: { next: "15.0.0" } }),
      settings: rootDirectorySettings(),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fires when next is only a devDependency", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ devDependencies: { next: "15.0.0" } }),
      settings: rootDirectorySettings(),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent in a nested workspace package that never depends on next", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ dependencies: { react: "19.0.0", vite: "6.0.0" } }),
      settings: rootDirectorySettings(),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("fires in a non-next package when no project root is provided", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ dependencies: { react: "19.0.0" } }),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fires below the root when the nearest manifest is a marker without dependencies", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ type: "module" }),
      settings: rootDirectorySettings(),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fires when there is no discoverable package manifest", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: path.join(temporaryDirectory, "standalone", "app", "page.tsx"),
      settings: rootDirectorySettings(),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the rule active when the host provides no filename", () => {
    const result = runRule(wrappedProbe, "export {};", { filename: undefined });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("gates the probe rule off in a nested non-next workspace package", () => {
    const result = runRule(wrappedProbe, "export {};", {
      filename: createPackageFilename({ dependencies: { react: "19.0.0" } }),
      settings: rootDirectorySettings(),
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
