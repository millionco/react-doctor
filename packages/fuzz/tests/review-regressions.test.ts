import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noDerivedState } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-derived-state.js";
import { noDerivedStateEffect } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-derived-state-effect.js";
import { noResetAllStateOnPropChange } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-reset-all-state-on-prop-change.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const regressionFiles = [
  "no-derived-state--review-sdk-network-quality-erased-export-use-state.tsx",
  "no-derived-state--review-sdk-network-quality-erased-react-hook.tsx",
  "no-derived-state--review-sdk-network-quality-inert-provider-key.tsx",
  "no-derived-state--review-wrapped-snapshot.tsx",
  "no-derived-state--review-erased-react-hook.tsx",
  "no-derived-state--review-inert-provider-key.tsx",
  "no-derived-state--review-dropping-custom-jsx-ancestor.tsx",
  "no-derived-state--review-template-ancestor.tsx",
  "no-derived-state--review-erased-export-useState.tsx",
  "no-derived-state--review-inactive-fieldset-spread.tsx",
  "no-derived-state--review-inert-jsx-string.tsx",
  "no-derived-state--review-ancestor-noscript.tsx",
  "no-derived-state--review-ancestor-textarea.tsx",
  "no-derived-state--review-ancestor-input.tsx",
  "no-derived-state--review-ancestor-title-react19.tsx",
  "no-derived-state--review-ancestor-hoisted-style-react19.tsx",
  "no-derived-state--review-ancestor-hoisted-script-react19.tsx",
];

const regressionCases = [
  ...regressionFiles.map((fileName) => ({ fileName, rule: noDerivedState })),
  ...[
    "no-derived-state-effect--editable-native-writer.tsx",
    "no-derived-state-effect--inactive-native-writer.tsx",
  ].map((fileName) => ({ fileName, rule: noDerivedStateEffect })),
  ...[
    "no-reset-all-state-on-prop-change--review-erased-react-hook.tsx",
    "no-reset-all-state-on-prop-change--review-wrapped-live-getter.tsx",
    "no-reset-all-state-on-prop-change--review-inert-provider-key.tsx",
    "no-reset-all-state-on-prop-change--review-erased-export-useState.tsx",
  ].map((fileName) => ({ fileName, rule: noResetAllStateOnPropChange })),
];

it.each(regressionCases)("replays review regression $fileName", ({ fileName, rule }) => {
  const corpusPath = fileURLToPath(new URL(`../corpus/regressions/${fileName}`, import.meta.url));
  const code = fs.readFileSync(corpusPath, "utf8");
  const sourceDirective = /^\/\/ file-path: (.+)$/m.exec(code)?.[1];
  const sourcePath = sourceDirective
    ? path.resolve(fileURLToPath(new URL("..", import.meta.url)), sourceDirective)
    : corpusPath;
  const verdict = /^\/\/ verdict: (pass|fail)$/m.exec(code)?.[1];
  if (verdict !== "pass" && verdict !== "fail") throw Error("Regression requires a verdict");
  const result = fuzzRuleWithStats(rule.id, rule, {
    iterations: 0,
    corpus: [
      {
        relativePath: `regressions/${fileName}`,
        sourcePath,
        code,
        ruleIds: [rule.id],
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
