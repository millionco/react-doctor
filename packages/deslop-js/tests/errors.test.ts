import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { analyze, defineConfig } from "../src/index.js";
import {
  ConfigError,
  DeslopError,
  DetectorError,
  FileReadError,
  ParseError,
  ResolverError,
  TypeScriptError,
  WorkspaceError,
  createDeslopError,
  DeslopErrorCollector,
} from "../src/errors.js";
import { FIXTURES_DIR } from "./helpers/fixtures-dir.js";

describe("errors / DeslopError class hierarchy", () => {
  it("DeslopError is an Error subclass with structured fields", () => {
    const error = createDeslopError({
      code: "file-read-failed",
      module: "parse",
      message: "boom",
      path: "/tmp/x",
      detail: "EACCES",
    });
    assert.ok(error instanceof Error);
    assert.ok(error instanceof DeslopError);
    assert.equal(error.code, "file-read-failed");
    assert.equal(error.module, "parse");
    assert.equal(error.severity, "warning");
    assert.equal(error.message, "boom");
    assert.equal(error.path, "/tmp/x");
    assert.equal(error.detail, "EACCES");
  });

  it("subclasses pre-fill module and narrow code", () => {
    const fileError = new FileReadError({ code: "file-empty", message: "empty", path: "/x" });
    assert.ok(fileError instanceof DeslopError);
    assert.ok(fileError instanceof FileReadError);
    assert.equal(fileError.module, "parse");
    assert.equal(fileError.code, "file-empty");

    const parseError = new ParseError({ code: "parse-failed", message: "bad" });
    assert.equal(parseError.module, "parse");

    const tsError = new TypeScriptError({ code: "tsconfig-not-found", message: "no config" });
    assert.equal(tsError.module, "semantic");

    const wsError = new WorkspaceError({ code: "workspace-discovery-failed", message: "ws" });
    assert.equal(wsError.module, "collect");

    const configError = new ConfigError({ message: "bad config" });
    assert.equal(configError.module, "config");
    assert.equal(configError.severity, "fatal");

    const resolverError = new ResolverError({ message: "resolver kapow" });
    assert.equal(resolverError.module, "resolver");
    assert.equal(resolverError.severity, "fatal");

    const detectorError = new DetectorError({ message: "detector kapow" });
    assert.equal(detectorError.module, "report");
  });

  it("DeslopError.fromCaught serializes the caught value into `detail`", () => {
    const caughtError = new Error("upstream went bad");
    const wrapped = DeslopError.fromCaught({
      code: "parse-failed",
      module: "parse",
      message: "wrap",
      caught: caughtError,
    });
    assert.equal(wrapped.detail, "upstream went bad");
  });

  it("toJSON produces a stable plain object suitable for JSON.stringify", () => {
    const error = new ParseError({ code: "ast-walk-failed", message: "boom", path: "/p" });
    const serialized = JSON.parse(JSON.stringify(error));
    assert.equal(serialized.name, "ParseError");
    assert.equal(serialized.code, "ast-walk-failed");
    assert.equal(serialized.module, "parse");
    assert.equal(serialized.severity, "warning");
    assert.equal(serialized.message, "boom");
    assert.equal(serialized.path, "/p");
  });

  it("DeslopErrorCollector caps entries and exposes a snapshot", () => {
    const collector = new DeslopErrorCollector(3);
    for (let index = 0; index < 5; index++) {
      collector.push(new ParseError({ code: "parse-failed", message: `m${index}` }));
    }
    assert.equal(collector.size(), 3);
    assert.equal(collector.snapshot().length, 3);
  });
});

describe("errors / analyze() returns DeslopErrors instead of throwing", () => {
  it("invalid rootDir yields a single fatal ConfigError and no crash", async () => {
    const result = await analyze(
      defineConfig({ rootDir: "/this/path/should/never/exist/__abc__" }),
    );
    assert.equal(result.totalFiles, 0);
    assert.equal(result.analysisErrors.length, 1);
    const onlyError = result.analysisErrors[0];
    assert.equal(onlyError.code, "config-invalid");
    assert.equal(onlyError.severity, "fatal");
    assert.equal(onlyError.module, "config");
  });

  it("empty .ts file emits an info-level file-empty error and does not crash analysis", async () => {
    const result = await analyze(
      defineConfig({ rootDir: resolve(FIXTURES_DIR, "empty-and-binary-files") }),
    );
    const emptyErrors = result.analysisErrors.filter(
      (entry) => entry.code === "file-empty" && entry.path?.endsWith("empty-file.ts"),
    );
    assert.equal(emptyErrors.length, 1);
    assert.equal(emptyErrors[0].severity, "info");
    assert.ok(result.totalFiles > 0, "analysis still processed the rest of the package");
  });

  it("binary .ts file emits a file-binary error and is skipped", async () => {
    const result = await analyze(
      defineConfig({ rootDir: resolve(FIXTURES_DIR, "empty-and-binary-files") }),
    );
    const binaryErrors = result.analysisErrors.filter(
      (entry) => entry.code === "file-binary" && entry.path?.endsWith("binary-file.ts"),
    );
    assert.equal(binaryErrors.length, 1);
  });

  it("minified bundle emits an info-level file-minified error and skips redundancy findings", async () => {
    const result = await analyze(
      defineConfig({ rootDir: resolve(FIXTURES_DIR, "empty-and-binary-files") }),
    );
    const minifiedErrors = result.analysisErrors.filter(
      (entry) => entry.code === "file-minified" && entry.path?.endsWith("minified-bundle.js"),
    );
    assert.equal(minifiedErrors.length, 1);
    assert.equal(minifiedErrors[0].severity, "info");
    const findingsInsideBundle = [
      ...result.simplifiableExpressions,
      ...result.simplifiableFunctions,
      ...result.duplicateImports,
      ...result.redundantTypePatterns,
    ].filter((entry) => entry.path.endsWith("minified-bundle.js"));
    assert.deepEqual(findingsInsideBundle, []);
  });

  it("broken tsconfig with semantic enabled emits tsconfig-parse-failed instead of throwing", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "broken-tsconfig"),
        semantic: { enabled: true },
      }),
    );
    const tsconfigErrors = result.analysisErrors.filter(
      (entry) => entry.code === "tsconfig-parse-failed",
    );
    assert.equal(tsconfigErrors.length, 1);
    assert.equal(tsconfigErrors[0].module, "semantic");
    assert.deepEqual(result.unusedTypes, []);
  });

  it("missing tsconfig with semantic enabled emits an info-level tsconfig-not-found", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simple-app"),
        semantic: { enabled: true },
      }),
    );
    const notFoundErrors = result.analysisErrors.filter(
      (entry) => entry.code === "tsconfig-not-found",
    );
    assert.equal(notFoundErrors.length, 1);
    assert.equal(notFoundErrors[0].severity, "info");
  });

  it("scans with semantic disabled report no semantic errors", async () => {
    const result = await analyze(
      defineConfig({
        rootDir: resolve(FIXTURES_DIR, "simple-app"),
        semantic: { enabled: false },
      }),
    );
    const semanticErrors = result.analysisErrors.filter((entry) => entry.module === "semantic");
    assert.equal(semanticErrors.length, 0);
  });
});
