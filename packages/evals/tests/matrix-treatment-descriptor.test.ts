import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  EVALUATION_CONFIG_CONTRACT,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
} from "../src/constants.js";
import {
  hashMatrixCorpusProjectSet,
  loadMatrixTreatments,
} from "../src/matrix-treatment-descriptor.js";

const temporaryDirectories: string[] = [];
const hash = (contents: string): string => createHash("sha256").update(contents).digest("hex");

const createTreatment = ({
  temporaryDirectory,
  id,
  baseCommit = "a".repeat(40),
  headCommit = "b".repeat(40),
  mode = "incremental",
  candidateRuleKeys,
  groupOverride = {},
}: {
  temporaryDirectory: string;
  id: string;
  baseCommit?: string;
  headCommit?: string;
  mode?: "full" | "incremental";
  candidateRuleKeys?: ReadonlyArray<string>;
  groupOverride?: Record<string, unknown>;
}): string => {
  const impactManifestPath = path.join(temporaryDirectory, `${id}-impact.json`);
  const resolvedCandidateRuleKeys =
    candidateRuleKeys ?? (mode === "incremental" ? ["react-doctor/example"] : []);
  const impactedRuleKeys =
    mode === "incremental" ? resolvedCandidateRuleKeys : ["react-doctor/example"];
  const impactManifestContents = `${JSON.stringify({
    schemaVersion: 1,
    mode,
    baseCommit,
    headCommit,
    changedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
    runtimeChangedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
    impactedRuleKeys,
    candidateRuleKeys: resolvedCandidateRuleKeys,
    fallbackReasons: mode === "full" ? ["Full parity required"] : [],
    rules: impactedRuleKeys.map((ruleKey) => ({
      ruleKey,
      baseFingerprint: "1".repeat(64),
      headFingerprint: "2".repeat(64),
    })),
  })}\n`;
  fs.writeFileSync(impactManifestPath, impactManifestContents);
  const descriptorPath = path.join(temporaryDirectory, `${id}.json`);
  fs.writeFileSync(
    descriptorPath,
    `${JSON.stringify({
      schemaVersion: 1,
      id,
      artifactDirectory: path.join(temporaryDirectory, id),
      reactDoctorRepository: "https://github.com/example/react-doctor.git",
      reactDoctorCommit: headCommit,
      impactManifestPath,
      impactManifestSha256: hash(impactManifestContents),
      group: {
        baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        baseReactDoctorCommit: baseCommit,
        baseFullRuleSetHash: "c".repeat(64),
        baseArtifactPath: path.join(temporaryDirectory, "base-scoped.ndjson"),
        baselineOutputPath: path.join(temporaryDirectory, "baseline.ndjson"),
        baselineProvenancePath: path.join(temporaryDirectory, "baseline.provenance.json"),
        corpusManifestPath: path.join(temporaryDirectory, "corpus.json"),
        corpusManifestSha256: "d".repeat(64),
        corpusProjectSetSha256: "e".repeat(64),
        evaluatorSourceHash: "f".repeat(64),
        configContract: EVALUATION_CONFIG_CONTRACT,
        scanContract: MATRIX_SCAN_CONTRACT,
        reportContract: MATRIX_REPORT_CONTRACT,
        projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
        ...groupOverride,
      },
    })}\n`,
  );
  return descriptorPath;
};

const rewriteImpactManifest = (
  descriptorPath: string,
  rewrite: (manifest: Record<string, unknown>) => Record<string, unknown>,
): void => {
  const descriptor = JSON.parse(fs.readFileSync(descriptorPath, "utf8"));
  const manifest = JSON.parse(fs.readFileSync(descriptor.impactManifestPath, "utf8"));
  const contents = `${JSON.stringify(rewrite(manifest))}\n`;
  fs.writeFileSync(descriptor.impactManifestPath, contents);
  descriptor.impactManifestSha256 = hash(contents);
  fs.writeFileSync(descriptorPath, `${JSON.stringify(descriptor)}\n`);
};

afterEach(() => {
  for (const temporaryDirectory of temporaryDirectories.splice(0)) {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

describe("loadMatrixTreatments", () => {
  it("loads repeatable descriptors with exact refreshed impact manifests", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-descriptors-"));
    temporaryDirectories.push(temporaryDirectory);
    const firstPath = createTreatment({ temporaryDirectory, id: "pr-1" });
    const secondPath = createTreatment({
      temporaryDirectory,
      id: "pr-2",
      headCommit: "2".repeat(40),
      candidateRuleKeys: ["react-doctor/second"],
    });

    const treatments = await loadMatrixTreatments([firstPath, secondPath]);

    expect(treatments.map((treatment) => treatment.descriptor.id)).toEqual(["pr-1", "pr-2"]);
    expect(treatments[1].ruleKeys).toEqual(["react-doctor/second"]);
  });

  it("rejects duplicate candidate keys instead of normalizing them", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-duplicates-"));
    temporaryDirectories.push(temporaryDirectory);
    const descriptorPath = createTreatment({
      temporaryDirectory,
      id: "pr-1",
      candidateRuleKeys: ["react-doctor/example", "react-doctor/example"],
    });

    await expect(loadMatrixTreatments([descriptorPath])).rejects.toThrow("sorted and unique");
  });

  it("rejects uppercase descriptor and impact commits", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-commits-"));
    temporaryDirectories.push(temporaryDirectory);
    const uppercaseHeadPath = createTreatment({
      temporaryDirectory,
      id: "pr-head",
      headCommit: "B".repeat(40),
    });
    const uppercaseBasePath = createTreatment({
      temporaryDirectory,
      id: "pr-base",
      baseCommit: "A".repeat(40),
    });

    await expect(loadMatrixTreatments([uppercaseHeadPath])).rejects.toThrow(
      "lowercase 40-character commit",
    );
    await expect(loadMatrixTreatments([uppercaseBasePath])).rejects.toThrow(
      "lowercase 40-character commit",
    );
  });

  it("fails closed for malformed or under-scoped canonical manifests", async () => {
    const cases: ReadonlyArray<{
      name: string;
      rewrite: (manifest: Record<string, unknown>) => Record<string, unknown>;
      message: string;
    }> = [
      {
        name: "extra-root",
        rewrite: (manifest) => ({ ...manifest, extra: true }),
        message: "unexpected fields",
      },
      {
        name: "missing-root",
        rewrite: (manifest) =>
          Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "rules")),
        message: "unexpected fields",
      },
      {
        name: "unsorted-paths",
        rewrite: (manifest) => ({ ...manifest, changedPaths: ["z.ts", "a.ts"] }),
        message: "sorted and unique",
      },
      {
        name: "runtime-outside-changed",
        rewrite: (manifest) => ({ ...manifest, runtimeChangedPaths: ["outside.ts"] }),
        message: "subset of changedPaths",
      },
      {
        name: "impacted-rules-drift",
        rewrite: (manifest) => ({ ...manifest, impactedRuleKeys: ["react-doctor/other"] }),
        message: "exactly match rules",
      },
      {
        name: "nested-extra",
        rewrite: (manifest) => ({
          ...manifest,
          rules: [
            {
              ruleKey: "react-doctor/example",
              baseFingerprint: "1".repeat(64),
              headFingerprint: "2".repeat(64),
              extra: true,
            },
          ],
        }),
        message: "unexpected fields",
      },
      {
        name: "nested-missing",
        rewrite: (manifest) => ({
          ...manifest,
          rules: [{ ruleKey: "react-doctor/example", headFingerprint: "2".repeat(64) }],
        }),
        message: "unexpected fields",
      },
      {
        name: "uppercase-fingerprint",
        rewrite: (manifest) => ({
          ...manifest,
          rules: [
            {
              ruleKey: "react-doctor/example",
              baseFingerprint: "A".repeat(64),
              headFingerprint: "2".repeat(64),
            },
          ],
        }),
        message: "lowercase SHA-256",
      },
      {
        name: "removed-local-candidate",
        rewrite: (manifest) => ({
          ...manifest,
          rules: [
            {
              ruleKey: "react-doctor/example",
              baseFingerprint: "1".repeat(64),
              headFingerprint: null,
            },
          ],
        }),
        message: "invalid invariants",
      },
      {
        name: "removed-local-with-external-closure",
        rewrite: (manifest) => ({
          ...manifest,
          impactedRuleKeys: ["react-doctor/example", "react-hooks-js/hooks"],
          candidateRuleKeys: ["react-hooks-js/hooks"],
          rules: [
            {
              ruleKey: "react-doctor/example",
              baseFingerprint: "1".repeat(64),
              headFingerprint: null,
            },
            {
              ruleKey: "react-hooks-js/hooks",
              baseFingerprint: null,
              headFingerprint: null,
            },
          ],
        }),
        message: "invalid invariants",
      },
      {
        name: "known-full-parity-rule",
        rewrite: (manifest) => ({
          ...manifest,
          impactedRuleKeys: ["react-doctor/react-compiler-no-manual-memoization"],
          candidateRuleKeys: ["react-doctor/react-compiler-no-manual-memoization"],
          rules: [
            {
              ruleKey: "react-doctor/react-compiler-no-manual-memoization",
              baseFingerprint: "1".repeat(64),
              headFingerprint: "2".repeat(64),
            },
          ],
        }),
        message: "invalid invariants",
      },
      {
        name: "under-scoped-candidate",
        rewrite: (manifest) => ({
          ...manifest,
          impactedRuleKeys: ["react-doctor/example", "react-doctor/second"],
          rules: [
            {
              ruleKey: "react-doctor/example",
              baseFingerprint: "1".repeat(64),
              headFingerprint: "2".repeat(64),
            },
            {
              ruleKey: "react-doctor/second",
              baseFingerprint: "3".repeat(64),
              headFingerprint: "4".repeat(64),
            },
          ],
        }),
        message: "invalid invariants",
      },
      {
        name: "invalid-array-item",
        rewrite: (manifest) => ({ ...manifest, changedPaths: [1] }),
        message: "canonical strings",
      },
      {
        name: "incremental-fallback",
        rewrite: (manifest) => ({ ...manifest, fallbackReasons: ["uncertain"] }),
        message: "invalid invariants",
      },
    ];
    for (const testCase of cases) {
      const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), `matrix-${testCase.name}-`));
      temporaryDirectories.push(temporaryDirectory);
      const descriptorPath = createTreatment({ temporaryDirectory, id: "pr-1" });
      rewriteImpactManifest(descriptorPath, testCase.rewrite);
      await expect(loadMatrixTreatments([descriptorPath])).rejects.toThrow(testCase.message);
    }
  });

  it("accepts nullable fingerprints for external interaction closure", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-external-rule-"));
    temporaryDirectories.push(temporaryDirectory);
    const descriptorPath = createTreatment({
      temporaryDirectory,
      id: "pr-1",
      candidateRuleKeys: ["react-hooks-js/hooks"],
    });
    rewriteImpactManifest(descriptorPath, (manifest) => ({
      ...manifest,
      rules: [{ ruleKey: "react-hooks-js/hooks", baseFingerprint: null, headFingerprint: null }],
    }));

    await expect(loadMatrixTreatments([descriptorPath])).resolves.toHaveLength(1);
  });

  it("accepts canonical full mode and requires a fallback reason", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-full-impact-"));
    temporaryDirectories.push(temporaryDirectory);
    const descriptorPath = createTreatment({
      temporaryDirectory,
      id: "pr-1",
      mode: "full",
    });
    await expect(loadMatrixTreatments([descriptorPath])).resolves.toHaveLength(1);

    rewriteImpactManifest(descriptorPath, (manifest) => ({ ...manifest, fallbackReasons: [] }));
    await expect(loadMatrixTreatments([descriptorPath])).rejects.toThrow("invalid invariants");
  });

  it("fails closed for grouping drift, stale impact commits, and changed impact bytes", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-invariants-"));
    temporaryDirectories.push(temporaryDirectory);
    const firstPath = createTreatment({ temporaryDirectory, id: "pr-1" });
    const groupDriftPath = createTreatment({
      temporaryDirectory,
      id: "pr-2",
      headCommit: "2".repeat(40),
      groupOverride: { corpusManifestSha256: "1".repeat(64) },
    });
    await expect(loadMatrixTreatments([firstPath, groupDriftPath])).rejects.toThrow(
      "different group contract",
    );

    const overlappingPath = createTreatment({
      temporaryDirectory,
      id: "pr-overlap",
      headCommit: "5".repeat(40),
    });
    const overlappingDescriptor = JSON.parse(fs.readFileSync(overlappingPath, "utf8"));
    overlappingDescriptor.artifactDirectory = path.join(temporaryDirectory, "pr-1", "nested");
    fs.writeFileSync(overlappingPath, JSON.stringify(overlappingDescriptor));
    await expect(loadMatrixTreatments([firstPath, overlappingPath])).rejects.toThrow(
      "cannot overlap",
    );

    const staleImpactPath = createTreatment({
      temporaryDirectory,
      id: "pr-3",
      headCommit: "3".repeat(40),
    });
    const staleDescriptor = JSON.parse(fs.readFileSync(staleImpactPath, "utf8"));
    const staleImpactContents = `${JSON.stringify({
      schemaVersion: 1,
      mode: "incremental",
      baseCommit: "a".repeat(40),
      headCommit: "4".repeat(40),
      changedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
      runtimeChangedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
      impactedRuleKeys: ["react-doctor/example"],
      candidateRuleKeys: ["react-doctor/example"],
      fallbackReasons: [],
      rules: [
        {
          ruleKey: "react-doctor/example",
          baseFingerprint: "1".repeat(64),
          headFingerprint: "2".repeat(64),
        },
      ],
    })}\n`;
    fs.writeFileSync(staleDescriptor.impactManifestPath, staleImpactContents);
    staleDescriptor.impactManifestSha256 = hash(staleImpactContents);
    fs.writeFileSync(staleImpactPath, JSON.stringify(staleDescriptor));
    await expect(loadMatrixTreatments([staleImpactPath])).rejects.toThrow(
      "headCommit does not match",
    );

    const changedImpactPath = createTreatment({ temporaryDirectory, id: "pr-4" });
    const changedDescriptor = JSON.parse(fs.readFileSync(changedImpactPath, "utf8"));
    fs.appendFileSync(changedDescriptor.impactManifestPath, " ");
    await expect(loadMatrixTreatments([changedImpactPath])).rejects.toThrow(
      "Impact manifest hash does not match",
    );
  });

  it("hashes the project tuple set independently of manifest order", () => {
    const first = { org: "a", name: "one", ref: "1".repeat(40), rootDir: "." };
    const second = { org: "b", name: "two", ref: "2".repeat(40), rootDir: "app" };
    expect(hashMatrixCorpusProjectSet([first, second])).toBe(
      hashMatrixCorpusProjectSet([second, first]),
    );
  });

  it("hashes project tuples without consulting the process locale", () => {
    const first = { org: "ä", name: "one", ref: "1".repeat(40), rootDir: "." };
    const second = { org: "z", name: "two", ref: "2".repeat(40), rootDir: "app" };
    const localeCompare = vi.spyOn(String.prototype, "localeCompare").mockImplementation(() => {
      throw new Error("locale-sensitive comparison used");
    });

    try {
      expect(hashMatrixCorpusProjectSet([first, second])).toBe(
        hashMatrixCorpusProjectSet([second, first]),
      );
      expect(localeCompare).not.toHaveBeenCalled();
    } finally {
      localeCompare.mockRestore();
    }
  });

  it("rejects the reserved base lane id", async () => {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "matrix-reserved-id-"));
    temporaryDirectories.push(temporaryDirectory);
    const descriptorPath = createTreatment({ temporaryDirectory, id: "matrix-base" });

    await expect(loadMatrixTreatments([descriptorPath])).rejects.toThrow("reserved matrix lane id");
  });
});
