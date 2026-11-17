import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noAsyncEventHandlerWithoutReentryGuard } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-async-event-handler-without-reentry-guard.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const regressionFiles = [
  "no-async-event-handler-without-reentry-guard--review-commonjs-provider.tsx",
  "no-async-event-handler-without-reentry-guard--review-erased-action-hook.tsx",
  "no-async-event-handler-without-reentry-guard--review-erased-action-component.tsx",
  "no-async-event-handler-without-reentry-guard--review-type-only-action-export.tsx",
  "no-async-event-handler-without-reentry-guard--review-inert-action-provider-key.tsx",
  "no-async-event-handler-without-reentry-guard--review-custom-action-jsx.tsx",
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
  const result = fuzzRuleWithStats(
    noAsyncEventHandlerWithoutReentryGuard.id,
    noAsyncEventHandlerWithoutReentryGuard,
    {
      iterations: 0,
      corpus: [
        {
          relativePath: `regressions/${fileName}`,
          sourcePath,
          code,
          ruleIds: [noAsyncEventHandlerWithoutReentryGuard.id],
          verdict,
        },
      ],
    },
  );
  expect(result.findings).toEqual([]);
  expect(result.stats.executedProgramCount).toBe(1);
  expect(result.stats.skippedParseErrorCount).toBe(0);
  expect(result.stats.firedProgramCount).toBe(verdict === "fail" ? 1 : 0);
});
