import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { getEvaluatorSourceHash } from "../src/utils/get-evaluator-source-hash.js";

const buildHashFixture = (temporaryDirectory: string) => {
  const sourceDirectory = path.join(temporaryDirectory, "src");
  const packageManifestPath = path.join(temporaryDirectory, "package.json");
  const lockfilePath = path.join(temporaryDirectory, "pnpm-lock.yaml");
  fs.mkdirSync(path.join(sourceDirectory, "utils"), { recursive: true });
  fs.writeFileSync(path.join(sourceDirectory, "cli.ts"), "export const cli = true;\n");
  fs.writeFileSync(path.join(sourceDirectory, "utils", "helper.ts"), "export const helper = 1;\n");
  fs.writeFileSync(packageManifestPath, '{"name":"fixture"}\n');
  fs.writeFileSync(lockfilePath, "lockfileVersion: '9.0'\n");
  return { sourceDirectory, packageManifestPath, lockfilePath };
};

describe("getEvaluatorSourceHash", () => {
  it("is stable across roots and changes when an implementation input changes", () => {
    const firstDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-hash-"));
    const secondDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-source-hash-"));
    try {
      const firstInput = buildHashFixture(firstDirectory);
      const secondInput = buildHashFixture(secondDirectory);
      const initialHash = getEvaluatorSourceHash(firstInput);

      expect(getEvaluatorSourceHash(secondInput)).toBe(initialHash);
      fs.writeFileSync(
        path.join(secondInput.sourceDirectory, "utils", "helper.ts"),
        "export const helper = 2;\n",
      );
      expect(getEvaluatorSourceHash(secondInput)).not.toBe(initialHash);
    } finally {
      fs.rmSync(firstDirectory, { force: true, recursive: true });
      fs.rmSync(secondDirectory, { force: true, recursive: true });
    }
  });
});
