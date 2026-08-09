import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

interface ReactBenchAuditExpectedCounts {
  falsePositiveCohorts: number;
  falseNegativeCohorts: number;
  falsePositiveMemberships: number;
  falseNegativeMemberships: number;
  uniqueTrials: number;
}

interface ReactBenchAuditCallsite {
  cohortId: string;
  verdict: "pass" | "fail";
  rule: string;
  fixture: string;
  trialSuffixes: string[];
}

interface ReactBenchAuditManifest {
  sourcePayloadSha256: string;
  expected: ReactBenchAuditExpectedCounts;
  callsites: ReactBenchAuditCallsite[];
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusDirectory = path.join(packageRoot, "corpus");
const manifestPath = path.join(corpusDirectory, "react-bench-0.9.6-audit.json");
const manifest: ReactBenchAuditManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

describe("React Bench 0.9.6 audit corpus", () => {
  it("accounts for every confirmed FP and FN callsite membership", () => {
    const falsePositiveCallsites = manifest.callsites.filter(
      (callsite) => callsite.verdict === "pass",
    );
    const falseNegativeCallsites = manifest.callsites.filter(
      (callsite) => callsite.verdict === "fail",
    );
    const falsePositiveMembershipCount = falsePositiveCallsites.reduce(
      (count, callsite) => count + callsite.trialSuffixes.length,
      0,
    );
    const falseNegativeMembershipCount = falseNegativeCallsites.reduce(
      (count, callsite) => count + callsite.trialSuffixes.length,
      0,
    );
    const uniqueTrialSuffixes = new Set(
      manifest.callsites.flatMap((callsite) => callsite.trialSuffixes),
    );

    expect(falsePositiveCallsites).toHaveLength(manifest.expected.falsePositiveCohorts);
    expect(falseNegativeCallsites).toHaveLength(manifest.expected.falseNegativeCohorts);
    expect(falsePositiveMembershipCount).toBe(manifest.expected.falsePositiveMemberships);
    expect(falseNegativeMembershipCount).toBe(manifest.expected.falseNegativeMemberships);
    expect(uniqueTrialSuffixes.size).toBe(manifest.expected.uniqueTrials);
  });

  it("contains no duplicate cohort or cohort-trial callsite", () => {
    const cohortIds = manifest.callsites.map((callsite) => callsite.cohortId);
    const callsiteKeys = manifest.callsites.flatMap((callsite) =>
      callsite.trialSuffixes.map((trialSuffix) => `${callsite.cohortId}:${trialSuffix}`),
    );

    expect(new Set(cohortIds).size).toBe(cohortIds.length);
    expect(new Set(callsiteKeys).size).toBe(callsiteKeys.length);
    for (const callsite of manifest.callsites) {
      expect(new Set(callsite.trialSuffixes).size).toBe(callsite.trialSuffixes.length);
    }
  });

  it("maps every cohort to a loaded deterministic fuzz verdict", () => {
    const loadedCorpus = loadFuzzCorpus(corpusDirectory, {
      maximumFiles: Number.POSITIVE_INFINITY,
    });
    const entriesByPath = new Map(loadedCorpus.map((entry) => [entry.relativePath, entry]));

    for (const callsite of manifest.callsites) {
      const entry = entriesByPath.get(callsite.fixture);
      expect(entry, callsite.fixture).toBeDefined();
      expect(entry?.ruleIds, callsite.fixture).toContain(callsite.rule);
      expect(entry?.verdict, callsite.fixture).toBe(callsite.verdict);
    }
  });

  it("deduplicates semantically shared callsites into unique fixture sources", () => {
    const fixturePaths = [...new Set(manifest.callsites.map((callsite) => callsite.fixture))];
    const fixtureSources = fixturePaths.map((fixturePath) =>
      fs.readFileSync(path.join(corpusDirectory, fixturePath), "utf8"),
    );

    expect(new Set(fixtureSources).size).toBe(fixtureSources.length);
    expect(fixturePaths.length).toBeLessThan(manifest.callsites.length);
  });
});
