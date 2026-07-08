import * as fs from "node:fs";
import * as path from "node:path";
import { reactDoctorRules } from "../../oxlint-plugin-react-doctor/src/plugin/rule-registry.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

// False-positive hunt over ground-truth-valid code. Every file in
// corpus/regressions/ is a CONFIRMED-valid program (that's the corpus
// contract), so:
//   - the seed's own named rule firing on it  => regression (hard FP)
//   - any OTHER rule firing on it             => FP candidate for triage
// Optionally extends the hunt to real-world corpus files (FP candidates
// only — real code does contain true positives).
//
//   bun scripts/hunt-false-positives.ts                  # regression seeds
//   HUNT_CORPUS_DIR=tmp/corpus-repos bun scripts/hunt-false-positives.ts

const packageRoot = path.resolve(import.meta.dirname, "..");
const regressionsDirectory = path.join(packageRoot, "corpus");

interface SeedHit {
  seed: string;
  rule: string;
  line: string;
  isNamedRule: boolean;
}

const namedRulesFor = (code: string): Set<string> => {
  const match = code.match(/^\/\/ rule: (.+)$/m);
  if (!match) return new Set();
  return new Set(match[1].split(",").map((name) => name.trim()));
};

// Seeds are modern-React programs with no framework context, so rules gated
// on other capabilities (preact, react-native, nextjs, react-compiler,
// version-pinned) would be pipeline-disabled — running them here is noise.
// react-in-jsx-scope assumes the classic JSX runtime (seeds use automatic).
const isHuntableRule = (entry: (typeof reactDoctorRules)[number]): boolean => {
  if (typeof entry.rule.scan === "function") return false;
  if (entry.rule.defaultEnabled === false) return false;
  if (entry.id === "react-in-jsx-scope") return false;
  const requires = entry.rule.requires ?? [];
  return requires.every((capability) => capability === "react");
};

const seeds = loadFuzzCorpus(regressionsDirectory);
const hits: SeedHit[] = [];
for (const seed of seeds) {
  const namedRules = namedRulesFor(seed.code);
  for (const entry of reactDoctorRules) {
    if (!isHuntableRule(entry)) continue;
    let diagnostics: ReadonlyArray<{ message: string }> = [];
    try {
      diagnostics = runRule(entry.rule, seed.code, {
        filename: seed.relativePath,
        forceJsx: true,
      }).diagnostics;
    } catch (thrown) {
      hits.push({
        seed: seed.relativePath,
        rule: entry.id,
        line: `CRASH: ${String(thrown).slice(0, 120)}`,
        isNamedRule: namedRules.has(entry.id),
      });
      continue;
    }
    for (const diagnostic of diagnostics) {
      hits.push({
        seed: seed.relativePath,
        rule: entry.id,
        line: diagnostic.message.slice(0, 110),
        isNamedRule: namedRules.has(entry.id),
      });
    }
  }
}

const regressions = hits.filter((hit) => hit.isNamedRule);
const candidates = hits.filter((hit) => !hit.isNamedRule);
console.log(`seeds: ${seeds.length}`);
console.log(`\n=== REGRESSIONS (named rule fired on its own valid seed): ${regressions.length}`);
for (const hit of regressions) console.log(`  ${hit.rule}  @ ${hit.seed}\n    ${hit.line}`);
console.log(`\n=== FP CANDIDATES (other rules firing on valid seeds): ${candidates.length}`);
const byRule = new Map<string, SeedHit[]>();
for (const hit of candidates) {
  byRule.set(hit.rule, [...(byRule.get(hit.rule) ?? []), hit]);
}
for (const [rule, ruleHits] of [...byRule.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${rule} (${ruleHits.length})`);
  for (const hit of ruleHits) console.log(`    ${hit.seed}: ${hit.line}`);
}

const corpusDirectory = process.env.HUNT_CORPUS_DIR;
if (corpusDirectory) {
  const corpusFiles = loadFuzzCorpus(corpusDirectory);
  const counts = new Map<string, number>();
  for (const file of corpusFiles) {
    for (const entry of reactDoctorRules) {
      if (!isHuntableRule(entry)) continue;
      try {
        const result = runRule(entry.rule, file.code, {
          filename: file.relativePath,
          forceJsx: true,
        });
        if (result.parseErrors.length > 0) continue;
        if (result.diagnostics.length > 0) {
          counts.set(entry.id, (counts.get(entry.id) ?? 0) + result.diagnostics.length);
        }
      } catch {
        counts.set(`CRASH:${entry.id}`, (counts.get(`CRASH:${entry.id}`) ?? 0) + 1);
      }
    }
  }
  console.log(`\n=== CORPUS HIT CENSUS (${corpusFiles.length} real files) — triage candidates`);
  for (const [rule, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(count).padStart(5)}  ${rule}`);
  }
}
