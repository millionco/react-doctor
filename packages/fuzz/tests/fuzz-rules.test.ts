import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { fuzzRule } from "../src/fuzz-rule.js";
import type { FuzzFinding } from "../src/fuzz-rule.js";
import { DEFAULT_FUZZ_ITERATIONS, DEFAULT_FUZZ_SEED } from "../src/constants.js";

const isFuzzEnabled = process.env.REACT_DOCTOR_FUZZ === "1";
const isStrict = process.env.FUZZ_STRICT === "1";
const shouldCheckInvariants = isStrict || process.env.FUZZ_INVARIANTS === "1";
const ruleFilter = process.env.FUZZ_RULE;
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const findingsDirectory = path.join(packageRoot, "tmp", "fuzz-findings");

const writeReproducer = (finding: FuzzFinding): string => {
  fs.mkdirSync(findingsDirectory, { recursive: true });
  const fileName = `${finding.ruleId.replace(/\//g, "__")}-${finding.kind}-seed-${finding.seed}.tsx`;
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
describe.skipIf(!isFuzzEnabled)("adversarial rule fuzzing", () => {
  for (const entry of selectedRules) {
    it(`survives fuzzing: ${entry.id}`, () => {
      const findings = fuzzRule(entry.id, entry.rule, {
        iterations,
        seed,
        checkInvariants: shouldCheckInvariants,
      });
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
