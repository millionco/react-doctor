import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { analyzeReducedMotionSource } from "../../core/src/check-reduced-motion.js";
import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { livenessFixtures } from "../../oxlint-plugin-react-doctor/src/plugin/liveness/liveness-fixtures.js";
import { defineRule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/define-rule.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import type { FuzzFinding } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import type { FuzzCorpusEntry } from "../src/load-fuzz-corpus.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  DEFAULT_FUZZ_SEED,
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
} from "../src/constants.js";

const isFuzzEnabled = process.env.REACT_DOCTOR_FUZZ === "1";
const isStrict = process.env.FUZZ_STRICT === "1";
const shouldCheckInvariants = isStrict || process.env.FUZZ_INVARIANTS === "1";
const shouldPrintStats = process.env.FUZZ_PRINT_STATS === "1";
const ruleFilter = process.env.FUZZ_RULE;
const tagFilter = process.env.FUZZ_TAG;

// A malformed env value silently degrading to zero iterations would make
// the whole run a false green, so fail loudly instead. Only validated when
// fuzzing is actually enabled — a stale env var must not break the default
// (skipped) suite at module load.
const readPositiveIntegerEnv = (name: string, defaultValue: number): number => {
  const raw = process.env[name];
  if (raw === undefined || !isFuzzEnabled) return defaultValue;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
};
const iterations = readPositiveIntegerEnv("FUZZ_ITERATIONS", DEFAULT_FUZZ_ITERATIONS);
const seed = readPositiveIntegerEnv("FUZZ_SEED", DEFAULT_FUZZ_SEED);
const fuzzTestTimeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requireReducedMotionFuzzRule = defineRule({
  id: "require-reduced-motion",
  title: "Missing reduced-motion handling",
  severity: "error",
  recommendation: "Add real reduced-motion handling for motion-library use.",
  scan: (file) => {
    const evidence = analyzeReducedMotionSource({
      fileName: file.relativePath,
      sourceText: file.content,
    });
    return evidence.hasMotionUse && !evidence.hasReducedMotionHandling
      ? [{ message: "Motion use has no reduced-motion handling.", line: 1, column: 1 }]
      : [];
  },
});

const fuzzRuleEntries = [
  ...reactDoctorRules,
  { id: requireReducedMotionFuzzRule.id, rule: requireReducedMotionFuzzRule },
];

// The built-in corpus combines confirmed false-positive regressions with
// intentional liveness targets; FUZZ_CORPUS_DIR adds external real-world
// files on top.
const corpusDirectory = process.env.FUZZ_CORPUS_DIR;
const builtinCorpus: FuzzCorpusEntry[] = isFuzzEnabled
  ? loadFuzzCorpus(path.join(packageRoot, "corpus"), {
      maximumFiles: Number.POSITIVE_INFINITY,
    })
  : [];
const externalCorpus: FuzzCorpusEntry[] =
  isFuzzEnabled && corpusDirectory ? loadFuzzCorpus(corpusDirectory) : [];
const corpus: FuzzCorpusEntry[] = [...builtinCorpus, ...externalCorpus];
const findingsDirectory = path.join(packageRoot, "tmp", "fuzz-findings");

let reproducerSequence = 0;

const writeReproducer = (finding: FuzzFinding): string => {
  fs.mkdirSync(findingsDirectory, { recursive: true });
  reproducerSequence += 1;
  const fileName = `${finding.ruleId.replace(/\//g, "__")}-${finding.kind}-seed-${finding.seed}-${reproducerSequence}.tsx`;
  const filePath = path.join(findingsDirectory, fileName);
  const header = [
    `// rule: ${finding.ruleId}`,
    `// kind: ${finding.kind}`,
    `// seed: ${finding.seed} (iteration ${finding.iteration})`,
    ...(finding.variantLabel === undefined ? [] : [`// variant: ${finding.variantLabel}`]),
    `// detail: ${finding.detail.split("\n")[0]}`,
  ].join("\n");
  fs.writeFileSync(filePath, `${header}\n${finding.code}`);
  return filePath;
};

const formatFinding = (finding: FuzzFinding, reproducerPath: string): string =>
  [
    `[${finding.kind}] ${finding.ruleId} (seed ${finding.seed}, iteration ${finding.iteration})`,
    finding.detail,
    `reproducer: ${reproducerPath}`,
  ].join("\n");

const selectedRules = fuzzRuleEntries.filter(
  (entry) =>
    (ruleFilter === undefined || entry.id === ruleFilter || entry.id.includes(ruleFilter)) &&
    (tagFilter === undefined || entry.rule.tags?.includes(tagFilter)),
);

// Adversarial fuzzing of every rule: generated + mutated React/TSX programs
// with crash, pathological-slowness, and (in strict mode) metamorphic
// invariance oracles. Opt-in via REACT_DOCTOR_FUZZ=1 (`pnpm fuzz`); tune with
// FUZZ_RULE=<id substring>, FUZZ_TAG=<tag>, FUZZ_ITERATIONS, FUZZ_SEED, FUZZ_INVARIANTS=1
// (warn on invariant violations), FUZZ_STRICT=1 (fail on them too).
const firedRuleIds = new Set<string>();
const silentRuleIds = new Set<string>();

describe.skipIf(!isFuzzEnabled)("adversarial rule fuzzing", () => {
  if (corpusDirectory) {
    console.info(
      `fuzz corpus: ${externalCorpus.length} files from ${corpusDirectory} + ${builtinCorpus.length} built-in regression seeds`,
    );
  }

  // Fire-coverage summary — the health metric of the generator itself. A
  // rule that never fires only has its early bails fuzzed, so growing this
  // number (not the iteration count) is what strengthens the harness.
  afterAll(() => {
    const totalRuleCount = firedRuleIds.size + silentRuleIds.size;
    if (totalRuleCount === 0) return;
    console.info(
      `fuzz fire-coverage: ${firedRuleIds.size}/${totalRuleCount} rules produced a diagnostic at least once`,
    );
    if (silentRuleIds.size > 0 && process.env.FUZZ_PRINT_SILENT === "1") {
      console.info(`silent rules:\n${[...silentRuleIds].sort().join("\n")}`);
    }
  });

  if ((ruleFilter !== undefined || tagFilter !== undefined) && selectedRules.length === 0) {
    it(`fuzz filters match at least one rule`, () => {
      expect.fail(
        `FUZZ_RULE=${JSON.stringify(ruleFilter)} and FUZZ_TAG=${JSON.stringify(tagFilter)} match no registry rule — nothing was fuzzed`,
      );
    });
  }

  for (const entry of selectedRules) {
    it(
      `survives fuzzing: ${entry.id}`,
      () => {
        const livenessFixture = livenessFixtures[entry.id];
        const priorityCorpusEntry =
          livenessFixture &&
          livenessFixture.settings === undefined &&
          livenessFixture.isGeneratedBundle === undefined
            ? {
                code: livenessFixture.code,
                relativePath: livenessFixture.filePath ?? "fixture.tsx",
              }
            : undefined;
        const { findings, stats } = fuzzRuleWithStats(entry.id, entry.rule, {
          iterations,
          seed,
          checkInvariants: shouldCheckInvariants,
          corpus,
          priorityCorpusEntry,
        });
        if (shouldPrintStats) {
          console.info(
            `fuzz stats: ${entry.id} executed=${stats.executedProgramCount} fired=${stats.firedProgramCount} skipped-parse=${stats.skippedParseErrorCount}`,
          );
        }
        // A rule with crash/slow findings was definitely exercised past its
        // early bails, so it isn't "silent" even without a diagnostic.
        const wasExercised = stats.firedProgramCount > 0 || findings.length > 0;
        (wasExercised ? firedRuleIds : silentRuleIds).add(entry.id);
        const blockingFindings = isStrict
          ? findings
          : findings.filter(
              (finding) =>
                finding.kind !== "invariant-violation" && finding.kind !== "verdict-drop",
            );
        const advisoryFindings = findings.filter((finding) => !blockingFindings.includes(finding));
        for (const finding of advisoryFindings) {
          console.warn(formatFinding(finding, writeReproducer(finding)));
        }
        if (blockingFindings.length > 0) {
          const summary = blockingFindings
            .map((finding) => formatFinding(finding, writeReproducer(finding)))
            .join("\n\n");
          expect.fail(`${blockingFindings.length} fuzz finding(s):\n\n${summary}`);
        }
      },
      fuzzTestTimeoutMs,
    );
  }
});
