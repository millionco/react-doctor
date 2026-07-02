import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { runScanRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-scan-rule.js";
import { generateStructuredFuzzProgram } from "../src/generate-fuzz-program.js";
import { createSeededRandom } from "../src/seeded-random.js";
import { FUZZ_FILENAME_POOL } from "../src/snippet-pools.js";

const iterations = Number(process.env.FUZZ_ITERATIONS ?? 50);
const programs: Array<{ code: string; filename: string }> = [];
for (let iteration = 0; iteration < iterations; iteration += 1) {
  const random = createSeededRandom((1_000_003 + iteration) >>> 0);
  const filename = random.pick(FUZZ_FILENAME_POOL);
  programs.push({ code: generateStructuredFuzzProgram(random).code, filename });
}

let fired = 0;
const neverFired: string[] = [];
for (const entry of reactDoctorRules) {
  let didFire = false;
  for (const { code, filename } of programs) {
    try {
      if (typeof entry.rule.scan === "function") {
        const findings = runScanRule(entry.rule, { relativePath: filename, content: code });
        if (findings.length > 0) didFire = true;
      } else {
        const result = runRule(entry.rule, code, { filename, forceJsx: true });
        if (result.parseErrors.length > 0) continue;
        if (result.diagnostics.length > 0) didFire = true;
      }
    } catch {
      didFire = true;
    }
    if (didFire) break;
  }
  if (didFire) fired += 1;
  else neverFired.push(entry.id);
}
console.log(`rules: ${reactDoctorRules.length}`);
console.log(`fired at least once in ${iterations} programs: ${fired}`);
console.log(`never fired: ${neverFired.length}`);
console.log(neverFired.join("\n"));
