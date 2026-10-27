import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { noAsyncEventHandlerWithoutReentryGuard } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-async-event-handler-without-reentry-guard.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  DEFAULT_FUZZ_SEED,
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
} from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-styled-auth-"));
const filename = path.join(directory, "editor.tsx");
const fixtureFiles = ["package.json", "tsconfig.json", "editor.tsx", "session.ts", "controls.tsx"];
const source = fs.readFileSync(
  new URL("../fixtures/styled-auth-submit/editor.tsx.txt", import.meta.url),
  "utf8",
);
const guarded = source
  .replace(
    "  const [, setSaved]",
    "  const [pending, setPending] = useState(false);\n  const [, setSaved]",
  )
  .replace(
    "    event.preventDefault();",
    "    event.preventDefault();\n    if (pending) return;\n    setPending(true);\n    try {",
  )
  .replace(
    "    setSaved(true);",
    "    setSaved(true);\n    } finally {\n      setPending(false);\n    }",
  )
  .replace('<button type="submit">', '<button type="submit" disabled={pending}>');
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
const timeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);

beforeEach(() => {
  for (const basename of fixtureFiles) {
    fs.writeFileSync(
      path.join(directory, basename),
      fs.readFileSync(new URL(`../fixtures/styled-auth-submit/${basename}.txt`, import.meta.url)),
    );
  }
  resetFilesystemCaches();
});
afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("canonical styled auth submit project fuzzing", () => {
  it("reaches the SDK request and keeps a leading disabled-state guard quiet", () => {
    const unsafeResult = runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename });
    expect(unsafeResult.parseErrors).toEqual([]);
    expect(unsafeResult.diagnostics).toHaveLength(1);
    expect(guarded).not.toBe(source);
    const guardedResult = runRule(noAsyncEventHandlerWithoutReentryGuard, guarded, { filename });
    expect(guardedResult.parseErrors).toEqual([]);
    expect(guardedResult.diagnostics).toEqual([]);
  });

  it("replays a same-export Auth alias mutation as a quiet regression", () => {
    const regressionFilename = fs.realpathSync(
      new URL(
        "../corpus/regressions/no-async-event-handler-without-reentry-guard--shared-auth-provider/editor.tsx",
        import.meta.url,
      ),
    );
    const regressionSource = fs.readFileSync(regressionFilename, "utf8");
    const regressionResult = runRule(noAsyncEventHandlerWithoutReentryGuard, regressionSource, {
      filename: regressionFilename,
    });
    expect(regressionResult.parseErrors).toEqual([]);
    expect(regressionResult.diagnostics).toEqual([]);
    const result = fuzzRuleWithStats(
      "no-async-event-handler-without-reentry-guard",
      noAsyncEventHandlerWithoutReentryGuard,
      {
        iterations: 0,
        corpus: [
          {
            relativePath: "shared-auth-provider-editor.tsx",
            sourcePath: regressionFilename,
            code: regressionSource,
            ruleIds: ["no-async-event-handler-without-reentry-guard"],
            verdict: "pass",
          },
        ],
      },
    );
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBe(1);
    expect(result.stats.firedProgramCount).toBe(0);
  });

  it(
    "fuzzes the canonical styled form with firing and guarded seeds",
    () => {
      expect(Number.isInteger(iterations) && iterations > 0).toBe(true);
      expect(Number.isInteger(seed) && seed > 0).toBe(true);
      const result = fuzzRuleWithStats(
        "no-async-event-handler-without-reentry-guard",
        noAsyncEventHandlerWithoutReentryGuard,
        {
          iterations,
          seed,
          checkInvariants: true,
          corpus: [
            {
              relativePath: "unsafe-styled-auth-editor.tsx",
              sourcePath: filename,
              code: source,
              ruleIds: ["no-async-event-handler-without-reentry-guard"],
              verdict: "fail",
            },
            {
              relativePath: "guarded-styled-auth-editor.tsx",
              sourcePath: filename,
              code: guarded,
              ruleIds: ["no-async-event-handler-without-reentry-guard"],
              verdict: "pass",
            },
          ],
        },
      );
      expect(result.findings).toEqual([]);
      expect(result.stats.firedProgramCount).toBeGreaterThan(0);
    },
    timeoutMs,
  );
});
