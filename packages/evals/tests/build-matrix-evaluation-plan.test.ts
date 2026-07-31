import { describe, expect, it } from "vite-plus/test";

import { buildMatrixEvaluationPlan } from "../src/build-matrix-evaluation-plan.js";
import {
  EVALUATION_CONFIG_CONTRACT,
  MATRIX_PROJECT_ROOT_POLICY,
  MATRIX_REPORT_CONTRACT,
  MATRIX_SCAN_CONTRACT,
} from "../src/constants.js";
import type { LoadedMatrixTreatment } from "../src/matrix-treatment-descriptor.js";

const buildTreatment = ({
  id,
  mode,
  ruleKeys,
}: {
  id: string;
  mode: "full" | "incremental";
  ruleKeys: ReadonlyArray<string>;
}): LoadedMatrixTreatment => {
  const baseCommit = "a".repeat(40);
  const headCommit = id === "pr-1" ? "b".repeat(40) : "c".repeat(40);
  return {
    descriptorPath: `/tmp/${id}.json`,
    descriptorSha256: "1".repeat(64),
    descriptorContents: "{}",
    impactManifestContents: "{}",
    descriptor: {
      schemaVersion: 1,
      id,
      artifactDirectory: `/tmp/${id}`,
      reactDoctorRepository: "https://github.com/example/react-doctor.git",
      reactDoctorCommit: headCommit,
      impactManifestPath: `/tmp/${id}-impact.json`,
      impactManifestSha256: "2".repeat(64),
      group: {
        baseReactDoctorRepository: "https://github.com/millionco/react-doctor.git",
        baseReactDoctorCommit: baseCommit,
        baseFullRuleSetHash: "3".repeat(64),
        baseArtifactPath: "/tmp/base-scoped.ndjson",
        baselineOutputPath: "/tmp/baseline.ndjson",
        baselineProvenancePath: "/tmp/baseline.provenance.json",
        corpusManifestPath: "/tmp/corpus.json",
        corpusManifestSha256: "4".repeat(64),
        corpusProjectSetSha256: "5".repeat(64),
        evaluatorSourceHash: "6".repeat(64),
        configContract: EVALUATION_CONFIG_CONTRACT,
        scanContract: MATRIX_SCAN_CONTRACT,
        reportContract: MATRIX_REPORT_CONTRACT,
        projectRootPolicy: MATRIX_PROJECT_ROOT_POLICY,
      },
    },
    impactManifest: {
      schemaVersion: 1,
      mode,
      baseCommit,
      headCommit,
      changedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
      runtimeChangedPaths: ["packages/oxlint-plugin-react-doctor/src/plugin/rules/example.ts"],
      impactedRuleKeys: ruleKeys,
      candidateRuleKeys: ruleKeys,
      fallbackReasons: mode === "full" ? ["Full parity required"] : [],
      rules: ruleKeys.map((ruleKey) => ({
        ruleKey,
        baseFingerprint: "4".repeat(64),
        headFingerprint: "5".repeat(64),
      })),
    },
    ruleKeys: mode === "full" ? [] : ruleKeys,
  };
};

describe("buildMatrixEvaluationPlan", () => {
  it("uses one sorted union-scoped base and bounded two-lane resources", () => {
    const plan = buildMatrixEvaluationPlan({
      treatments: [
        buildTreatment({
          id: "pr-1",
          mode: "incremental",
          ruleKeys: ["react-doctor/zeta", "react-doctor/shared"],
        }),
        buildTreatment({
          id: "pr-2",
          mode: "incremental",
          ruleKeys: ["react-doctor/alpha", "react-doctor/shared"],
        }),
      ],
      waveWidth: 2,
      hasVerifiedFullBaseline: false,
    });

    expect(plan.lanes[2]).toMatchObject({
      id: "matrix-base",
      kind: "base",
      ruleKeys: ["react-doctor/alpha", "react-doctor/shared", "react-doctor/zeta"],
    });
    expect(plan.lanes.map((lane) => lane.id)).toEqual(["pr-1", "pr-2", "matrix-base"]);
    expect(plan.lanes).toHaveLength(3);
    expect(plan.resources).toEqual({ cpu: 4, memory: 8, disk: 30 });
  });

  it("promotes the base to full when any treatment is full", () => {
    const plan = buildMatrixEvaluationPlan({
      treatments: [
        buildTreatment({ id: "pr-1", mode: "full", ruleKeys: [] }),
        buildTreatment({
          id: "pr-2",
          mode: "incremental",
          ruleKeys: ["react-doctor/alpha"],
        }),
      ],
      waveWidth: 2,
      hasVerifiedFullBaseline: false,
    });
    expect(plan.lanes.find((lane) => lane.kind === "base")?.ruleKeys).toEqual([]);
  });

  it("omits the base lane only after a verified full cache hit", () => {
    const plan = buildMatrixEvaluationPlan({
      treatments: [
        buildTreatment({
          id: "pr-1",
          mode: "incremental",
          ruleKeys: ["react-doctor/alpha"],
        }),
      ],
      waveWidth: 1,
      hasVerifiedFullBaseline: true,
    });
    expect(plan.lanes.map((lane) => lane.id)).toEqual(["pr-1"]);
    expect(plan.resources).toEqual({ cpu: 2, memory: 4, disk: 10 });
  });
});
