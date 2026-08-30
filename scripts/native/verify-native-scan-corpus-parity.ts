import assert from "node:assert/strict";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { checkSecurityScan } from "../../packages/core/src/check-security-scan.js";
import { REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV } from "../../packages/core/src/constants.js";

interface MutableNativeScanBinding {
  scanReactDoctorFile: (inputJson: string) => unknown;
}

const bundledRequire = createRequire(
  new URL("./verify-native-scan-corpus-parity.cjs", import.meta.url),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isMutableNativeScanBinding = (value: unknown): value is MutableNativeScanBinding =>
  isRecord(value) && typeof value.scanReactDoctorFile === "function";

const isScanFinding = (value: unknown): boolean =>
  isRecord(value) &&
  typeof value.message === "string" &&
  typeof value.line === "number" &&
  typeof value.column === "number" &&
  (value.severity === undefined || value.severity === "error" || value.severity === "warn") &&
  (value.title === undefined || typeof value.title === "string") &&
  (value.help === undefined || typeof value.help === "string");

const isNativeFindingMap = (value: unknown, ruleIds: ReadonlyArray<unknown>): boolean =>
  isRecord(value) &&
  ruleIds.every((ruleId) => {
    if (typeof ruleId !== "string") return false;
    const findings = value[ruleId];
    return Array.isArray(findings) && findings.every(isScanFinding);
  });

const readOption = (name: string): string | undefined => {
  const optionIndex = process.argv.indexOf(name);
  if (optionIndex < 0) return undefined;
  const value = process.argv[optionIndex + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
};

const run = (): void => {
  const corpusOption = readOption("--corpus");
  const bindingOption = readOption("--binding");
  if (corpusOption === undefined) throw new Error("--corpus is required");
  if (bindingOption === undefined) throw new Error("--binding is required");

  const corpusDirectory = path.resolve(corpusOption);
  const bindingPath = path.resolve(bindingOption);
  assert.ok(fs.existsSync(corpusDirectory), `Corpus not found: ${corpusDirectory}`);
  assert.ok(fs.existsSync(bindingPath), `Native binding not found: ${bindingPath}`);
  const loadedBinding: unknown = bundledRequire(bindingPath);
  assert.ok(
    isMutableNativeScanBinding(loadedBinding),
    `Native binding does not export scan API at ${bindingPath} resolved as ${bundledRequire.resolve(bindingPath)} (${isRecord(loadedBinding) ? Object.keys(loadedBinding).join(", ") : typeof loadedBinding})`,
  );
  const originalScanReactDoctorFile = loadedBinding.scanReactDoctorFile;
  const nativeExecutionFailures: string[] = [];
  let nativeInvocationCount = 0;
  loadedBinding.scanReactDoctorFile = (inputJson) => {
    nativeInvocationCount += 1;
    try {
      const input: unknown = JSON.parse(inputJson);
      const outputJson = originalScanReactDoctorFile(inputJson);
      if (!isRecord(input) || !Array.isArray(input.ruleIds) || typeof outputJson !== "string") {
        throw new Error("invalid native scan input or output envelope");
      }
      const output: unknown = JSON.parse(outputJson);
      if (!isNativeFindingMap(output, input.ruleIds)) {
        throw new Error("invalid native scan finding map");
      }
      return outputJson;
    } catch (error) {
      nativeExecutionFailures.push(error instanceof Error ? error.message : String(error));
      throw error;
    }
  };

  const excludedRepositories = new Set(
    (readOption("--exclude") ?? "")
      .split(",")
      .map((repository) => repository.trim())
      .filter(Boolean),
  );
  const repositoryDirectories = fs
    .readdirSync(corpusDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !excludedRepositories.has(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  const originalBindingPath = process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
  const parityDifferences: string[] = [];
  let diagnosticCount = 0;

  try {
    for (const repository of repositoryDirectories) {
      const repositoryDirectory = path.join(corpusDirectory, repository.name);
      delete process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
      const canonicalDiagnostics = checkSecurityScan(repositoryDirectory);
      process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = bindingPath;
      const nativeDiagnostics = checkSecurityScan(repositoryDirectory);
      diagnosticCount += canonicalDiagnostics.length;
      try {
        assert.deepEqual(nativeDiagnostics, canonicalDiagnostics, repository.name);
      } catch (error) {
        parityDifferences.push(error instanceof Error ? error.message : String(error));
      }
    }
  } finally {
    loadedBinding.scanReactDoctorFile = originalScanReactDoctorFile;
    if (originalBindingPath === undefined) {
      delete process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV];
    } else {
      process.env[REACT_DOCTOR_NATIVE_OXLINT_BINDING_ENV] = originalBindingPath;
    }
  }

  assert.ok(nativeInvocationCount > 0, "Native scan binding was never invoked");
  assert.deepEqual(nativeExecutionFailures, [], "Native scan execution fell back to TypeScript");
  if (parityDifferences.length > 0) {
    throw new Error(
      `Native scan corpus parity found ${parityDifferences.length} mismatched repositories:\n\n${parityDifferences.join("\n\n")}`,
    );
  }
  process.stdout.write(
    `Native scan corpus parity passed: ${repositoryDirectories.length} repositories, ${diagnosticCount} diagnostics, 0 differences.\n`,
  );
};

run();
