import { ruleRegistry } from "../../packages/oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { runRule } from "../../packages/oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { runScanRule } from "../../packages/oxlint-plugin-react-doctor/src/test-utils/run-scan-rule.js";
import type { FnMiningCase } from "./fn-mining-case.js";
import { allFnMiningCases } from "./cases/index.js";

interface VariantResult {
  miningCase: FnMiningCase;
  didFire: boolean;
  messages: ReadonlyArray<string>;
  parseErrors: ReadonlyArray<string>;
}

const executeCase = (miningCase: FnMiningCase): VariantResult => {
  const rule = ruleRegistry[miningCase.ruleId];
  if (!rule) {
    throw new Error(`Unknown ruleId "${miningCase.ruleId}" — not present in ruleRegistry.`);
  }
  if (typeof rule.scan === "function") {
    const findings = runScanRule(rule, {
      relativePath: miningCase.filePath,
      content: miningCase.code,
    });
    return {
      miningCase,
      didFire: findings.length > 0,
      messages: findings.map((finding) => finding.message),
      parseErrors: [],
    };
  }
  const { diagnostics, parseErrors } = runRule(rule, miningCase.code, {
    filename: miningCase.filePath,
  });
  return {
    miningCase,
    didFire: diagnostics.length > 0,
    messages: diagnostics.map((diagnostic) => diagnostic.message),
    parseErrors: parseErrors.map((parseError) => parseError.message),
  };
};

const groupByRule = (results: ReadonlyArray<VariantResult>): Map<string, VariantResult[]> => {
  const byRule = new Map<string, VariantResult[]>();
  for (const result of results) {
    const bucket = byRule.get(result.miningCase.ruleId) ?? [];
    bucket.push(result);
    byRule.set(result.miningCase.ruleId, bucket);
  }
  return byRule;
};

const results = allFnMiningCases.map(executeCase);
const resultsByRule = groupByRule(results);

let firedCount = 0;
let silentCount = 0;
const silentResults: VariantResult[] = [];
const firedCarveOuts: VariantResult[] = [];

for (const [ruleId, ruleResults] of resultsByRule) {
  const ruleFiredCount = ruleResults.filter((result) => result.didFire).length;
  console.log(`\n${ruleId} — ${ruleFiredCount}/${ruleResults.length} variants fired`);
  for (const result of ruleResults) {
    const isCarveOut = !result.miningCase.shouldFire;
    const marker = result.didFire ? "  [fired]  " : isCarveOut ? "  [carved] " : "  [SILENT] ";
    console.log(`${marker}${result.miningCase.description}`);
    for (const parseError of result.parseErrors) {
      console.log(`             parse error: ${parseError}`);
    }
    if (result.didFire) {
      firedCount += 1;
      if (isCarveOut) firedCarveOuts.push(result);
    } else {
      silentCount += 1;
      if (!isCarveOut) silentResults.push(result);
    }
  }
}

console.log(`\n${"=".repeat(72)}`);
console.log(
  `Total: ${results.length} variants across ${resultsByRule.size} rules — ` +
    `${firedCount} fired, ${silentCount} silent`,
);

if (firedCarveOuts.length > 0) {
  console.log(
    `\nCarve-out variants that FIRED (possible precision regression — recheck the gate):`,
  );
  for (const result of firedCarveOuts) {
    console.log(`  - [${result.miningCase.ruleId}] ${result.miningCase.description}`);
  }
}

if (silentResults.length > 0) {
  console.log(`\nFN candidates (silent variants — need human triage):`);
  for (const result of silentResults) {
    console.log(`  - [${result.miningCase.ruleId}] ${result.miningCase.description}`);
  }
  console.log(
    "\nA silent variant is a CANDIDATE false negative, not a confirmed bug: it may be" +
      "\ndeliberate rule scoping (a documented carve-out, a precision-over-recall gate)." +
      "\nRead the rule source before filing anything.",
  );
}

process.exitCode = 0;
