import type { Rule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/rule.js";
import { parseFixture } from "../../oxlint-plugin-react-doctor/src/test-utils/parse-fixture.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { runScanRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-scan-rule.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  MAX_NOISE_MUTATIONS,
  NOISE_MUTATION_PROBABILITY,
  SLOW_RULE_THRESHOLD_MS,
} from "./constants.js";
import { buildEquivalentFuzzVariants } from "./equivalent-fuzz-variants.js";
import { generateFuzzProgram } from "./generate-fuzz-program.js";
import { mutateFuzzProgram } from "./mutate-fuzz-program.js";
import { createSeededRandom } from "./seeded-random.js";

export type FuzzFindingKind = "crash" | "slow" | "invariant-violation";

export interface FuzzFinding {
  ruleId: string;
  kind: FuzzFindingKind;
  seed: number;
  iteration: number;
  detail: string;
  code: string;
  variantLabel?: string;
}

export interface FuzzRuleOptions {
  iterations?: number;
  seed?: number;
  slowThresholdMs?: number;
  checkInvariants?: boolean;
}

interface RunOutcome {
  diagnosticSignature?: string[];
  crashDetail?: string;
  elapsedMs: number;
}

const hasParseErrors = (code: string): boolean => {
  try {
    return parseFixture(code).errors.length > 0;
  } catch {
    return true;
  }
};

const runRuleOnCode = (rule: Rule, code: string): RunOutcome => {
  const startedAt = performance.now();
  try {
    if (typeof rule.scan === "function") {
      const findings = runScanRule(rule, { relativePath: "src/fuzz-fixture.tsx", content: code });
      return {
        diagnosticSignature: findings.map((finding) => finding.message).sort(),
        elapsedMs: performance.now() - startedAt,
      };
    }
    const result = runRule(rule, code);
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
export const fuzzRule = (
  ruleId: string,
  rule: Rule,
  options: FuzzRuleOptions = {},
): FuzzFinding[] => {
  const iterations = options.iterations ?? DEFAULT_FUZZ_ITERATIONS;
  const baseSeed = options.seed ?? 1;
  const slowThresholdMs = options.slowThresholdMs ?? SLOW_RULE_THRESHOLD_MS;
  const findings: FuzzFinding[] = [];
  const isScanRule = typeof rule.scan === "function";

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const iterationSeed = (baseSeed * 1_000_003 + iteration) >>> 0;
    const random = createSeededRandom(iterationSeed);
    let code = generateFuzzProgram(random);
    const didApplyNoise = random.chance(NOISE_MUTATION_PROBABILITY);
    if (didApplyNoise) {
      code = mutateFuzzProgram(code, random, random.intBetween(1, MAX_NOISE_MUTATIONS + 1));
    }

    if (!isScanRule && hasParseErrors(code)) continue;
    const outcome = runRuleOnCode(rule, code);
    if (outcome.crashDetail !== undefined) {
      findings.push({
        ruleId,
        kind: "crash",
        seed: iterationSeed,
        iteration,
        detail: outcome.crashDetail,
        code,
      });
      continue;
    }
    if (outcome.elapsedMs > slowThresholdMs) {
      findings.push({
        ruleId,
        kind: "slow",
        seed: iterationSeed,
        iteration,
        detail: `took ${Math.round(outcome.elapsedMs)}ms (threshold ${slowThresholdMs}ms)`,
        code,
      });
    }

    if (!options.checkInvariants || isScanRule || didApplyNoise) continue;
    for (const variant of buildEquivalentFuzzVariants(code)) {
      if (hasParseErrors(variant.code)) continue;
      const variantOutcome = runRuleOnCode(rule, variant.code);
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

  return findings;
};
