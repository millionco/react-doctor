import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

import {
  EVALUATION_CONFIG_CONTRACT,
  MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS,
  MATRIX_IMPACT_MANIFEST_TEST_TIMEOUT_MS,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
} from "../src/constants.js";
import type { LoadedMatrixTreatment } from "../src/matrix-treatment-descriptor.js";
import { verifyMatrixImpactManifests } from "../src/verify-matrix-impact-manifests.js";

const temporaryDirectories: string[] = [];

const runGit = (repositoryDirectory: string, argumentsToPass: ReadonlyArray<string>): string =>
  execFileSync("git", ["-C", repositoryDirectory, ...argumentsToPass], { encoding: "utf8" });

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("verifyMatrixImpactManifests", { timeout: MATRIX_IMPACT_MANIFEST_TEST_TIMEOUT_MS }, () => {
  it("regenerates exact manifest bytes from the pinned commits", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-impact-verify-"));
    temporaryDirectories.push(temporaryDirectory);
    const repositoryDirectory = path.join(temporaryDirectory, "source");
    const ruleDirectory = path.join(
      repositoryDirectory,
      "packages/oxlint-plugin-react-doctor/src/plugin/rules",
    );
    fs.mkdirSync(ruleDirectory, { recursive: true });
    runGit(repositoryDirectory, ["init", "--quiet"]);
    runGit(repositoryDirectory, ["config", "user.email", "matrix@example.com"]);
    runGit(repositoryDirectory, ["config", "user.name", "Matrix Test"]);
    const rulePath = path.join(ruleDirectory, "example.ts");
    fs.writeFileSync(rulePath, 'defineRule({ id: "example", value: 1 });\n');
    runGit(repositoryDirectory, ["add", "."]);
    runGit(repositoryDirectory, ["commit", "--quiet", "-m", "base"]);
    const baseCommit = runGit(repositoryDirectory, ["rev-parse", "HEAD"]).trim();
    fs.writeFileSync(rulePath, 'defineRule({ id: "example", value: 2 });\n');
    runGit(repositoryDirectory, ["commit", "--quiet", "-am", "head"]);
    const headCommit = runGit(repositoryDirectory, ["rev-parse", "HEAD"]).trim();
    const impactManifestPath = path.join(temporaryDirectory, "impact.json");
    const generatorPath = fileURLToPath(
      new URL(
        "../../../.agents/skills/run-parity/scripts/find-impacted-rules.mjs",
        import.meta.url,
      ),
    );
    execFileSync(process.execPath, [
      generatorPath,
      repositoryDirectory,
      baseCommit,
      headCommit,
      impactManifestPath,
    ]);
    const impactManifestContents = fs.readFileSync(impactManifestPath, "utf8");
    const treatment: LoadedMatrixTreatment = {
      descriptorPath: path.join(temporaryDirectory, "descriptor.json"),
      descriptorSha256: "1".repeat(64),
      descriptorContents: "{}\n",
      descriptor: {
        schemaVersion: 1,
        id: "pr-1",
        artifactDirectory: path.join(temporaryDirectory, "artifact"),
        reactDoctorRepository: repositoryDirectory,
        reactDoctorCommit: headCommit,
        impactManifestPath,
        impactManifestSha256: "2".repeat(64),
        group: {
          baseReactDoctorRepository: repositoryDirectory,
          baseReactDoctorCommit: baseCommit,
          baseFullRuleSetHash: "3".repeat(64),
          baseArtifactPath: path.join(temporaryDirectory, "base.ndjson"),
          baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
          baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
          corpusManifestPath: path.join(temporaryDirectory, "corpus.json"),
          corpusManifestSha256: "4".repeat(64),
          corpusProjectSetSha256: "5".repeat(64),
          evaluatorSourceHash: "6".repeat(64),
          configContract: EVALUATION_CONFIG_CONTRACT,
          scanContract: MATRIX_SCAN_CONTRACT,
          reportContract: MATRIX_REPORT_CONTRACT,
          projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
        },
      },
      impactManifestContents,
      impactManifest: JSON.parse(impactManifestContents),
      ruleKeys: ["react-doctor/example"],
    };

    const canonicalDeadlineMilliseconds =
      globalThis.performance.now() + MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS;
    await expect(
      verifyMatrixImpactManifests([treatment], canonicalDeadlineMilliseconds),
    ).resolves.toBeUndefined();
    const mismatchDeadlineMilliseconds =
      globalThis.performance.now() + MATRIX_IMPACT_MANIFEST_OPERATION_TIMEOUT_MS;
    await expect(
      verifyMatrixImpactManifests(
        [{ ...treatment, impactManifestContents: `${impactManifestContents} ` }],
        mismatchDeadlineMilliseconds,
      ),
    ).rejects.toThrow("does not match the canonical generator");
    await expect(
      verifyMatrixImpactManifests([treatment], globalThis.performance.now()),
    ).rejects.toThrow("Evaluation time budget exhausted");
  });
});
