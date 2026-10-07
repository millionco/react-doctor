import { describe, expect, it } from "vite-plus/test";

import { assertMatrixBaseRecord } from "../src/utils/assert-matrix-base-record.js";

const repository = {
  org: "example",
  name: "repository",
  ref: "a".repeat(40),
  rootDir: ".",
};

describe("assertMatrixBaseRecord", () => {
  it("accepts a final full-base failure without evaluation provenance", () => {
    expect(() =>
      assertMatrixBaseRecord({
        record: { schemaVersion: 1, repository, error: "retries exhausted" },
        expectedRuleSetHash: "b".repeat(64),
        isFullRuleSet: true,
      }),
    ).not.toThrow();
  });

  it("rejects a successful full-base record with mismatched provenance", () => {
    expect(() =>
      assertMatrixBaseRecord({
        record: {
          schemaVersion: 1,
          repository,
          evaluation: {
            reactDoctorRepository: "https://github.com/example/react-doctor.git",
            reactDoctorCommit: "c".repeat(40),
            configContract: "contract",
            ruleSetHash: "d".repeat(64),
            ruleKeys: [],
            evaluatorSourceHash: "e".repeat(64),
          },
        },
        expectedRuleSetHash: "b".repeat(64),
        isFullRuleSet: true,
      }),
    ).toThrow("Matrix full base rule-set hash does not match its descriptor");
  });

  it("accepts a successful full-base record with matching provenance", () => {
    const expectedRuleSetHash = "b".repeat(64);
    expect(() =>
      assertMatrixBaseRecord({
        record: {
          schemaVersion: 1,
          repository,
          evaluation: {
            reactDoctorRepository: "https://github.com/example/react-doctor.git",
            reactDoctorCommit: "c".repeat(40),
            configContract: "contract",
            ruleSetHash: expectedRuleSetHash,
            ruleKeys: [],
            evaluatorSourceHash: "e".repeat(64),
          },
        },
        expectedRuleSetHash,
        isFullRuleSet: true,
      }),
    ).not.toThrow();
  });
});
