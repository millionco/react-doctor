import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";
import { noAsyncEventHandlerWithoutReentryGuard } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-async-event-handler-without-reentry-guard.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

it("replays the complete imported request and action regression", () => {
  const sourcePath = fileURLToPath(
    new URL("../fixtures/imported-request-action/screen.tsx", import.meta.url),
  );
  const result = fuzzRuleWithStats(
    noAsyncEventHandlerWithoutReentryGuard.id,
    noAsyncEventHandlerWithoutReentryGuard,
    {
      iterations: 0,
      corpus: [
        {
          relativePath: "true-positives/imported-request-action.tsx",
          sourcePath,
          code: fs.readFileSync(sourcePath, "utf8"),
          ruleIds: [noAsyncEventHandlerWithoutReentryGuard.id],
          verdict: "fail",
        },
      ],
    },
  );
  expect(result.findings).toEqual([]);
  expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  expect(result.stats.skippedParseErrorCount).toBe(0);
});

it("keeps a wrapper default that acquires reentry outside the imported-request certificate", () => {
  const fixtureDirectory = fileURLToPath(
    new URL("../fixtures/imported-request-action", import.meta.url),
  );
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-request-default-"));
  try {
    fs.cpSync(fixtureDirectory, temporaryDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(temporaryDirectory, "request.ts"),
      `import axios from "axios";
let claimed = false;
const claimOnce = () => {
  if (claimed) throw new Error("already running");
  claimed = true;
  return {};
};
export const send = (endpoint, body = claimOnce()) => axios.post(endpoint, body);
`,
    );
    const sourcePath = path.join(temporaryDirectory, "screen.tsx");
    const originalSource = fs.readFileSync(sourcePath, "utf8");
    expect(originalSource).toContain('await send("/tasks.commit", {});');
    const code = originalSource.replace(
      'await send("/tasks.commit", {});',
      'await send("/tasks.commit", undefined);',
    );
    fs.writeFileSync(sourcePath, code);
    const result = fuzzRuleWithStats(
      noAsyncEventHandlerWithoutReentryGuard.id,
      noAsyncEventHandlerWithoutReentryGuard,
      {
        iterations: 0,
        corpus: [
          {
            relativePath: "true-negatives/imported-request-default-reentry.tsx",
            sourcePath,
            code,
            ruleIds: [noAsyncEventHandlerWithoutReentryGuard.id],
            verdict: "pass",
          },
        ],
      },
    );
    expect(result.findings).toEqual([]);
    expect(result.stats.firedProgramCount).toBe(0);
    expect(result.stats.skippedParseErrorCount).toBe(0);
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
