import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noDerivedState } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-derived-state.js";
import { noDerivedStateEffect } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-derived-state-effect.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const regressionFiles = [
  "no-derived-state--review-erased-react-hook.tsx",
  "no-derived-state--review-wrapped-snapshot.tsx",
  "no-derived-state--review-inert-provider-key.tsx",
  "no-derived-state--review-erased-export-useState.tsx",
];

it.each(regressionFiles)("replays review regression %s", (fileName) => {
  const corpusPath = fileURLToPath(new URL(`../corpus/regressions/${fileName}`, import.meta.url));
  const code = fs.readFileSync(corpusPath, "utf8");
  const sourceDirective = /^\/\/ file-path: (.+)$/m.exec(code)?.[1];
  const sourcePath = sourceDirective
    ? path.resolve(fileURLToPath(new URL("..", import.meta.url)), sourceDirective)
    : corpusPath;
  const verdict = /^\/\/ verdict: (pass|fail)$/m.exec(code)?.[1];
  if (verdict !== "pass" && verdict !== "fail") throw Error("Regression requires a verdict");
  const result = fuzzRuleWithStats(noDerivedState.id, noDerivedState, {
    iterations: 0,
    corpus: [
      {
        relativePath: `regressions/${fileName}`,
        sourcePath,
        code,
        ruleIds: [noDerivedState.id],
        verdict,
      },
    ],
  });
  expect(result.findings).toEqual([]);
  expect(result.stats.executedProgramCount).toBe(1);
  expect(result.stats.skippedParseErrorCount).toBe(0);
  expect(result.stats.firedProgramCount).toBe(verdict === "fail" ? 1 : 0);
});

it("keeps the SDK snapshot quiet in the companion effect corpus", () => {
  const corpusPath = fileURLToPath(
    new URL(
      "../corpus/regressions/no-derived-state-effect--sdk-network-quality-snapshot.tsx",
      import.meta.url,
    ),
  );
  const code = fs.readFileSync(corpusPath, "utf8");
  const sourcePath = path.resolve(
    fileURLToPath(new URL("..", import.meta.url)),
    "corpus/regressions/no-derived-state--sdk-network-quality-snapshot-context/snapshot.tsx",
  );
  const result = fuzzRuleWithStats(noDerivedStateEffect.id, noDerivedStateEffect, {
    iterations: 0,
    corpus: [
      {
        relativePath: path.basename(corpusPath),
        sourcePath,
        code,
        ruleIds: [noDerivedStateEffect.id],
        verdict: "pass",
      },
    ],
  });
  expect(result.findings).toEqual([]);
  expect(result.stats.executedProgramCount).toBe(1);
  expect(result.stats.skippedParseErrorCount).toBe(0);
  expect(result.stats.firedProgramCount).toBe(0);
});
