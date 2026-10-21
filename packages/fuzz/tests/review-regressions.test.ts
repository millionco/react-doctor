import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noResetAllStateOnPropChange } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-reset-all-state-on-prop-change.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const regressionFiles = [
  "no-reset-all-state-on-prop-change--review-erased-react-hook.tsx",
  "no-reset-all-state-on-prop-change--review-wrapped-live-getter.tsx",
  "no-reset-all-state-on-prop-change--review-inert-provider-key.tsx",
  "no-reset-all-state-on-prop-change--review-erased-export-useState.tsx",
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
  const result = fuzzRuleWithStats(noResetAllStateOnPropChange.id, noResetAllStateOnPropChange, {
    iterations: 0,
    corpus: [
      {
        relativePath: `regressions/${fileName}`,
        sourcePath,
        code,
        ruleIds: [noResetAllStateOnPropChange.id],
        verdict,
      },
    ],
  });
  expect(result.findings).toEqual([]);
  expect(result.stats.executedProgramCount).toBe(1);
  expect(result.stats.skippedParseErrorCount).toBe(0);
  expect(result.stats.firedProgramCount).toBe(verdict === "fail" ? 1 : 0);
});
