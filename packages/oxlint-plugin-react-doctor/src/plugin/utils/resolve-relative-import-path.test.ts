import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { collectCrossFileProbes } from "./cross-file-probe-recorder.js";
import {
  resetModuleResolutionCaches,
  resolveRelativeImportPath,
} from "./resolve-relative-import-path.js";

let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "relative-import-path-"));
  resetModuleResolutionCaches();
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("resolveRelativeImportPath", () => {
  it("resolves an extensionless relative import", () => {
    const sourceFilePath = path.join(temporaryDirectory, "src/page.tsx");
    const importedFilePath = path.join(temporaryDirectory, "src/component.tsx");
    fs.mkdirSync(path.dirname(importedFilePath), { recursive: true });
    fs.writeFileSync(importedFilePath, "export const Component = () => null;", "utf8");

    expect(resolveRelativeImportPath(sourceFilePath, "./component")).toBe(importedFilePath);
  });

  it("resolves a dotted basename without a source extension", () => {
    const sourceFilePath = path.join(temporaryDirectory, "src/page.tsx");
    const importedFilePath = path.join(temporaryDirectory, "src/component.utils.ts");
    fs.mkdirSync(path.dirname(importedFilePath), { recursive: true });
    fs.writeFileSync(importedFilePath, "export const value = true;", "utf8");

    expect(resolveRelativeImportPath(sourceFilePath, "./component.utils")).toBe(importedFilePath);
  });

  it("reuses filesystem classifications until scan caches reset", () => {
    const sourceFilePath = path.join(temporaryDirectory, "src/page.tsx");
    const importedFilePath = path.join(temporaryDirectory, "src/component.tsx");
    const collectResolution = () => {
      let result: string | null = null;
      const trace = collectCrossFileProbes(() => {
        result = resolveRelativeImportPath(sourceFilePath, "./component");
      });
      return { result, trace };
    };

    const missing = collectResolution();
    expect(missing.result).toBeNull();

    fs.mkdirSync(path.dirname(importedFilePath), { recursive: true });
    fs.writeFileSync(importedFilePath, "export const Component = () => null;", "utf8");

    const cached = collectResolution();
    expect(cached.result).toBeNull();
    expect(cached.trace).toEqual(missing.trace);

    resetModuleResolutionCaches();
    const refreshed = collectResolution();
    expect(refreshed.result).toBe(importedFilePath);
    expect(refreshed.trace.existencePaths).toEqual(
      new Set([
        path.join(temporaryDirectory, "src/component"),
        path.join(temporaryDirectory, "src/component.ts"),
        importedFilePath,
      ]),
    );
  });

  it("reuses package entry reads until scan caches reset", () => {
    const sourceFilePath = path.join(temporaryDirectory, "src/page.tsx");
    const packageDirectory = path.join(temporaryDirectory, "src/component");
    fs.mkdirSync(packageDirectory, { recursive: true });

    expect(resolveRelativeImportPath(sourceFilePath, "./component")).toBeNull();

    const importedFilePath = path.join(packageDirectory, "entry.ts");
    fs.writeFileSync(path.join(packageDirectory, "package.json"), '{"main":"entry.ts"}', "utf8");
    fs.writeFileSync(importedFilePath, "export const Component = () => null;", "utf8");

    expect(resolveRelativeImportPath(sourceFilePath, "./component")).toBeNull();

    resetModuleResolutionCaches();
    expect(resolveRelativeImportPath(sourceFilePath, "./component")).toBe(importedFilePath);
  });
});
