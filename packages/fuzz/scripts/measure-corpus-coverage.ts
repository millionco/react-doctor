import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { runScanRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-scan-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const corpusDirectory = process.env.FUZZ_CORPUS_DIR ?? "/tmp/rd-fp-corpus";
const sampleSize = Number(process.env.FUZZ_CORPUS_SAMPLE ?? 120);
const corpus = loadFuzzCorpus(corpusDirectory).slice(0, sampleSize);
console.log(`corpus files: ${corpus.length}`);

let fired = 0;
const neverFired: string[] = [];
for (const entry of reactDoctorRules) {
  let didFire = false;
  for (const { code, relativePath } of corpus) {
    try {
      if (typeof entry.rule.scan === "function") {
        const findings = runScanRule(entry.rule, { relativePath, content: code });
        if (findings.length > 0) didFire = true;
      } else {
        const result = runRule(entry.rule, code, { filename: relativePath, forceJsx: true });
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
console.log(`fired at least once: ${fired}/${reactDoctorRules.length}`);
