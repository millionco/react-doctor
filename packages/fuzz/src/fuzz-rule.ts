import type { Rule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule.js";
import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import type { ParseFixtureResult } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import { runRuleOnParsedFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { runScanRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-scan-rule.js";
import {
  CORPUS_PROGRAM_PROBABILITY,
  DEFAULT_FUZZ_ITERATIONS,
  EXPLOIT_DESCENDANT_COUNT,
  MAX_NOISE_MUTATIONS,
  NOISE_MUTATION_PROBABILITY,
  SLOW_RULE_THRESHOLD_MS,
  SLOW_VERIFY_RERUN_COUNT,
} from "./constants.js";
import { buildAstEquivalentFuzzVariants } from "./ast-equivalent-fuzz-variants.js";
import { buildEquivalentFuzzVariants } from "./equivalent-fuzz-variants.js";
import { buildVerdictPreservingVariants } from "./verdict-preserving-variants.js";
import { generateStructuredFuzzProgram } from "./generate-fuzz-program.js";
import type { FuzzCorpusEntry } from "./load-fuzz-corpus.js";
import { crossoverFuzzPrograms, mutateFuzzProgram } from "./mutate-fuzz-program.js";
import { createSeededRandom } from "./seeded-random.js";
import { FUZZ_FILENAME_POOL } from "./snippet-pools.js";

const EFFECT_CALLBACK_ALIAS_RULE_IDS = new Set([
  "no-cascading-set-state",
  "no-effect-chain",
  "no-fetch-in-effect",
]);

export type FuzzFindingKind = "crash" | "slow" | "invariant-violation" | "verdict-drop";

export interface FuzzFinding {
  ruleId: string;
  kind: FuzzFindingKind;
  seed: number;
  iteration: number;
  detail: string;
  code: string;
  variantLabel?: string;
}

export interface FuzzRuleStats {
  // Programs on which the rule produced at least one diagnostic — the
  // fire-coverage signal. A rule that never fires is only having its early
  // bails fuzzed, so its findings prove little.
  firedProgramCount: number;
  executedProgramCount: number;
  skippedParseErrorCount: number;
}

export interface FuzzRuleResult {
  findings: FuzzFinding[];
  stats: FuzzRuleStats;
}

export interface FuzzRuleOptions {
  iterations?: number;
  seed?: number;
  slowThresholdMs?: number;
  checkInvariants?: boolean;
  corpus?: ReadonlyArray<FuzzCorpusEntry>;
  priorityCorpusEntry?: FuzzCorpusEntry;
}

interface RunOutcome {
  diagnosticSignature?: string[];
  crashDetail?: string;
  elapsedMs: number;
  hasParseErrors?: boolean;
}

const runRuleOnCode = (rule: Rule, code: string, filename: string): RunOutcome => {
  if (typeof rule.scan === "function") {
    const startedAt = performance.now();
    try {
      const findings = runScanRule(rule, { relativePath: filename, content: code });
      return {
        diagnosticSignature: findings.map((finding) => finding.message).sort(),
        elapsedMs: performance.now() - startedAt,
      };
    } catch (thrown) {
      const detail = thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown);
      return { crashDetail: detail, elapsedMs: performance.now() - startedAt };
    }
  }

  let parsed: ParseFixtureResult;
  try {
    parsed = parseFixture(code, { filename, forceJsx: true });
  } catch {
    return { elapsedMs: 0, hasParseErrors: true };
  }
  if (parsed.errors.length > 0) {
    return { elapsedMs: 0, hasParseErrors: true };
  }

  const startedAt = performance.now();
  try {
    const result = runRuleOnParsedFixture(rule, code, parsed, { filename, forceJsx: true });
    return {
      diagnosticSignature: result.diagnostics
        .map((diagnostic) => `${diagnostic.nodeType}: ${diagnostic.message}`)
        .sort(),
      elapsedMs: performance.now() - startedAt,
    };
  } catch (thrown) {
    const detail = thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown);
    return { crashDetail: detail, elapsedMs: performance.now() - startedAt };
  }
};

// Adversarial fuzzing for a single rule. Three oracles:
// - crash: the rule threw while visiting a parseable program
// - slow: one file took pathologically long (default 2s)
// - invariant-violation: a semantics-preserving rewrite changed the
//   diagnostics (metamorphic testing; AST rules only, since scan rules
//   legitimately match comment/string content)
// Program sources per iteration: grammar-generated (realistic, catalog-
// driven), pathological shapes, or — when a corpus is provided — real
// files, optionally crossed over with a generated program. When a program
// makes the rule FIRE, extra mutated descendants of it are fuzzed too
// (feedback loop that keeps inputs near reporting paths).
export const fuzzRuleWithStats = (
  ruleId: string,
  rule: Rule,
  options: FuzzRuleOptions = {},
): FuzzRuleResult => {
  const iterations = options.iterations ?? DEFAULT_FUZZ_ITERATIONS;
  const baseSeed = options.seed ?? 1;
  const slowThresholdMs = options.slowThresholdMs ?? SLOW_RULE_THRESHOLD_MS;
  const corpus = options.corpus ?? [];
  const findings: FuzzFinding[] = [];
  const stats: FuzzRuleStats = {
    firedProgramCount: 0,
    executedProgramCount: 0,
    skippedParseErrorCount: 0,
  };
  const isScanRule = typeof rule.scan === "function";
  const targetFilePrefix = `${ruleId.replaceAll("/", "__")}--`;
  const livenessTarget = corpus.find((entry) => {
    const pathSegments = entry.relativePath.split(/[\\/]/);
    const fileName = pathSegments.at(-1);
    return pathSegments[0] === "targets" && fileName?.startsWith(targetFilePrefix) === true;
  });

  const checkProgram = (
    code: string,
    filename: string,
    iterationSeed: number,
    iteration: number,
    variantLabel?: string,
  ): RunOutcome | null => {
    const outcome = runRuleOnCode(rule, code, filename);
    if (!isScanRule && outcome.hasParseErrors === true) {
      stats.skippedParseErrorCount += 1;
      return null;
    }
    stats.executedProgramCount += 1;
    if (outcome.crashDetail !== undefined) {
      findings.push({
        ruleId,
        kind: "crash",
        seed: iterationSeed,
        iteration,
        detail: outcome.crashDetail,
        code,
        variantLabel,
      });
      return outcome;
    }
    if ((outcome.diagnosticSignature?.length ?? 0) > 0) stats.firedProgramCount += 1;
    if (outcome.elapsedMs > slowThresholdMs) {
      // Wall-clock spikes from CPU contention (parallel test runs, CI
      // neighbors) masquerade as pathological rules. Re-run the exact
      // program and keep the fastest time — a genuinely slow input stays
      // slow on every run, while a descheduled one drops to milliseconds.
      let fastestElapsedMs = outcome.elapsedMs;
      for (let retry = 0; retry < SLOW_VERIFY_RERUN_COUNT; retry += 1) {
        const rerun = runRuleOnCode(rule, code, filename);
        if (rerun.elapsedMs < fastestElapsedMs) fastestElapsedMs = rerun.elapsedMs;
        if (fastestElapsedMs <= slowThresholdMs) break;
      }
      if (fastestElapsedMs > slowThresholdMs) {
        findings.push({
          ruleId,
          kind: "slow",
          seed: iterationSeed,
          iteration,
          detail: `took ${Math.round(fastestElapsedMs)}ms verified across reruns (threshold ${slowThresholdMs}ms)`,
          code,
          variantLabel,
        });
      }
    }
    return outcome;
  };

  const priorityCorpusEntry = options.priorityCorpusEntry;
  if (priorityCorpusEntry) {
    const priorityRandom = createSeededRandom(baseSeed);
    const priorityOutcome = checkProgram(
      priorityCorpusEntry.code,
      priorityCorpusEntry.relativePath,
      baseSeed,
      0,
      "priority corpus seed",
    );
    if (
      priorityOutcome &&
      priorityOutcome.crashDetail === undefined &&
      (priorityOutcome.diagnosticSignature?.length ?? 0) > 0
    ) {
      for (let descendant = 0; descendant < EXPLOIT_DESCENDANT_COUNT; descendant += 1) {
        const descendantCode = mutateFuzzProgram(priorityCorpusEntry.code, priorityRandom, 1);
        checkProgram(
          descendantCode,
          priorityCorpusEntry.relativePath,
          baseSeed,
          0,
          `priority corpus descendant ${descendant}`,
        );
      }
    }
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const iterationSeed = (baseSeed * 1_000_003 + iteration) >>> 0;
    const random = createSeededRandom(iterationSeed);
    let filename: string = random.pick(FUZZ_FILENAME_POOL);

    const generated = generateStructuredFuzzProgram(random);
    const usesLivenessTarget = iteration === 0 && livenessTarget !== undefined;
    let code = usesLivenessTarget ? livenessTarget.code : generated.code;
    let sections: ReadonlyArray<string> | undefined = usesLivenessTarget
      ? undefined
      : generated.sections;
    if (usesLivenessTarget) {
      filename = livenessTarget.relativePath;
    } else if (corpus.length > 0 && random.chance(CORPUS_PROGRAM_PROBABILITY)) {
      const corpusEntry = random.pick(corpus);
      if (random.chance(0.4)) {
        code = crossoverFuzzPrograms(corpusEntry.code, generated.code, random);
      } else {
        // Verbatim corpus code keeps its own path so path-gated rules see
        // the file as it really lives; synthetic/crossover programs keep
        // the rotated pool filename for path-gating coverage.
        code = corpusEntry.code;
        filename = corpusEntry.relativePath;
      }
      sections = undefined;
    }
    const didApplyNoise = !usesLivenessTarget && random.chance(NOISE_MUTATION_PROBABILITY);
    if (didApplyNoise) {
      code = mutateFuzzProgram(code, random, random.intBetween(1, MAX_NOISE_MUTATIONS + 1));
      sections = undefined;
    }

    const outcome = checkProgram(code, filename, iterationSeed, iteration);
    if (outcome === null || outcome.crashDetail !== undefined) continue;

    const didFire = (outcome.diagnosticSignature?.length ?? 0) > 0;
    if (didFire) {
      for (let descendant = 0; descendant < EXPLOIT_DESCENDANT_COUNT; descendant += 1) {
        const descendantCode = mutateFuzzProgram(code, random, random.intBetween(1, 3));
        checkProgram(
          descendantCode,
          filename,
          iterationSeed,
          iteration,
          `exploit descendant ${descendant}`,
        );
      }
    }

    if (!options.checkInvariants || isScanRule || didApplyNoise) continue;

    // Verdict-preserving mutation oracle ("x + 1 = 2" → "x + 1 + 1 - 1 = 2"):
    // when the rule FIRED, semantics-preserving shape rewrites (extra
    // parens, cast wrappers, concise→block arrows, no-op prologues) must
    // not silence it entirely — a drop means detection keys on incidental
    // token shape, the classic false-negative evasion class. Signature
    // CHANGES are expected here (messages may embed source text), so only
    // full disappearance is a finding.
    if (didFire) {
      for (const variant of buildVerdictPreservingVariants(code, filename)) {
        if (!variant.mustPreserveVerdict) continue;
        const variantOutcome = runRuleOnCode(rule, variant.code, filename);
        if (variantOutcome.hasParseErrors === true) continue;
        if (variantOutcome.crashDetail !== undefined) {
          findings.push({
            ruleId,
            kind: "crash",
            seed: iterationSeed,
            iteration,
            detail: variantOutcome.crashDetail,
            code: variant.code,
            variantLabel: variant.label,
          });
          continue;
        }
        if ((variantOutcome.diagnosticSignature?.length ?? 0) === 0) {
          findings.push({
            ruleId,
            kind: "verdict-drop",
            seed: iterationSeed,
            iteration,
            detail: `diagnostics disappeared under verdict-preserving rewrite "${variant.label}" (base had ${outcome.diagnosticSignature?.length ?? 0})`,
            code: variant.code,
            variantLabel: variant.label,
          });
        }
      }
    }

    for (const variant of [
      ...buildEquivalentFuzzVariants(code, sections),
      ...buildAstEquivalentFuzzVariants(code, filename, EFFECT_CALLBACK_ALIAS_RULE_IDS.has(ruleId)),
    ]) {
      const variantOutcome = runRuleOnCode(rule, variant.code, filename);
      if (variantOutcome.hasParseErrors === true) continue;
      if (variantOutcome.crashDetail !== undefined) {
        findings.push({
          ruleId,
          kind: "crash",
          seed: iterationSeed,
          iteration,
          detail: variantOutcome.crashDetail,
          code: variant.code,
          variantLabel: variant.label,
        });
        continue;
      }
      const baseSignature = JSON.stringify(outcome.diagnosticSignature);
      const variantSignature = JSON.stringify(variantOutcome.diagnosticSignature);
      if (baseSignature !== variantSignature) {
        findings.push({
          ruleId,
          kind: "invariant-violation",
          seed: iterationSeed,
          iteration,
          detail: `diagnostics changed under "${variant.label}":\n  base:    ${baseSignature}\n  variant: ${variantSignature}`,
          code: variant.code,
          variantLabel: variant.label,
        });
      }
    }
  }

  return { findings, stats };
};

export const fuzzRule = (
  ruleId: string,
  rule: Rule,
  options: FuzzRuleOptions = {},
): FuzzFinding[] => fuzzRuleWithStats(ruleId, rule, options).findings;
