import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import type { FuzzFinding } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import type { FuzzCorpusEntry } from "../src/load-fuzz-corpus.js";
import { DEFAULT_FUZZ_ITERATIONS, DEFAULT_FUZZ_SEED } from "../src/constants.js";

const isFuzzEnabled = process.env.REACT_DOCTOR_FUZZ === "1";
const isStrict = process.env.FUZZ_STRICT === "1";
const shouldCheckInvariants = isStrict || process.env.FUZZ_INVARIANTS === "1";
const ruleFilter = process.env.FUZZ_RULE;

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
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The built-in regression corpus (confirmed historical false positives —
// see corpus/README.md) is always fuzzed; FUZZ_CORPUS_DIR adds external
// real-world files on top.
const corpusDirectory = process.env.FUZZ_CORPUS_DIR;
const builtinCorpus: FuzzCorpusEntry[] = isFuzzEnabled
  ? loadFuzzCorpus(path.join(packageRoot, "corpus"))
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

const selectedRules = reactDoctorRules.filter(
  (entry) => ruleFilter === undefined || entry.id === ruleFilter || entry.id.includes(ruleFilter),
);

// Adversarial fuzzing of every rule: generated + mutated React/TSX programs
// with crash, pathological-slowness, and (in strict mode) metamorphic
// invariance oracles. Opt-in via REACT_DOCTOR_FUZZ=1 (`pnpm fuzz`); tune with
// FUZZ_RULE=<id substring>, FUZZ_ITERATIONS, FUZZ_SEED, FUZZ_INVARIANTS=1
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

  if (ruleFilter !== undefined && selectedRules.length === 0) {
    it(`FUZZ_RULE matches at least one rule`, () => {
      expect.fail(
        `FUZZ_RULE=${JSON.stringify(ruleFilter)} matches no registry rule id — nothing was fuzzed`,
      );
    });
  }

  for (const entry of selectedRules) {
    it(`survives fuzzing: ${entry.id}`, () => {
      const { findings, stats } = fuzzRuleWithStats(entry.id, entry.rule, {
        iterations,
        seed,
        checkInvariants: shouldCheckInvariants,
        corpus,
      });
      // A rule with crash/slow findings was definitely exercised past its
      // early bails, so it isn't "silent" even without a diagnostic.
      const wasExercised = stats.firedProgramCount > 0 || findings.length > 0;
      (wasExercised ? firedRuleIds : silentRuleIds).add(entry.id);
      const blockingFindings = isStrict
        ? findings
        : findings.filter((finding) => finding.kind !== "invariant-violation");
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
    });
  }
});
