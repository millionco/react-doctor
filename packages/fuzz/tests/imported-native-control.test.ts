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

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-imported-control-"));
const filename = path.join(directory, "editor.tsx");
const source = fs.readFileSync(
  new URL("../fixtures/imported-native-control/editor.tsx.txt", import.meta.url),
  "utf8",
);
const guarded = source
  .replace(
    "  const [, setSaved]",
    "  const [pending, setPending] = useState(false);\n  const [, setSaved]",
  )
  .replace(
    "  const save = async () => {",
    "  const save = async () => {\n    if (pending) return;\n    setPending(true);\n    try {",
  )
  .replace(
    "    setSaved(true);",
    "    setSaved(true);\n    } finally {\n      setPending(false);\n    }",
  )
  .replace("<ActionControl onClick={save}>", "<ActionControl onClick={save} disabled={pending}>");
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
const timeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);

beforeEach(() => {
  for (const basename of ["package.json", "action-control.tsx"]) {
    fs.writeFileSync(
      path.join(directory, basename),
      fs.readFileSync(
        new URL(`../fixtures/imported-native-control/${basename}.txt`, import.meta.url),
      ),
    );
  }
  fs.writeFileSync(filename, source);
  fs.writeFileSync(
    path.join(directory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { jsx: "react-jsx" } }),
  );
  fs.rmSync(path.join(directory, "tsconfig.app.json"), { force: true });
  resetFilesystemCaches();
});
afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("imported native control project fuzzing", () => {
  it(
    "fuzzes a direct referenced alias with firing and guarded seeds",
    () => {
      const referencedSource = source.replace('"./action-control"', '"@/action-control"');
      const referencedGuardedSource = guarded.replace('"./action-control"', '"@/action-control"');
      expect(referencedSource).not.toBe(source);
      expect(referencedGuardedSource).not.toBe(guarded);
      fs.writeFileSync(
        path.join(directory, "tsconfig.json"),
        JSON.stringify({ files: [], references: [{ path: "./tsconfig.app.json" }] }),
      );
      fs.writeFileSync(
        path.join(directory, "tsconfig.app.json"),
        JSON.stringify({
          include: ["*.tsx"],
          compilerOptions: { jsx: "react-jsx", baseUrl: ".", paths: { "@/*": ["./*"] } },
        }),
      );
      fs.writeFileSync(filename, referencedSource);
      resetFilesystemCaches();
      expect(
        runRule(noAsyncEventHandlerWithoutReentryGuard, referencedSource, { filename }).diagnostics,
      ).toHaveLength(1);
      const result = fuzzRuleWithStats(
        "no-async-event-handler-without-reentry-guard",
        noAsyncEventHandlerWithoutReentryGuard,
        {
          iterations,
          seed,
          checkInvariants: true,
          corpus: [
            {
              relativePath: "referenced-unsafe-editor.tsx",
              sourcePath: filename,
              code: referencedSource,
              ruleIds: ["no-async-event-handler-without-reentry-guard"],
              verdict: "fail",
            },
            {
              relativePath: "referenced-guarded-editor.tsx",
              sourcePath: filename,
              code: referencedGuardedSource,
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

  it("replays the classic JSX provider false-positive regression", () => {
    const regressionFilename = fs.realpathSync(
      new URL(
        "../corpus/regressions/no-async-event-handler-without-reentry-guard--classic-jsx-provider/editor.tsx",
        import.meta.url,
      ),
    );
    const regressionSource = fs.readFileSync(regressionFilename, "utf8");
    const result = fuzzRuleWithStats(
      "no-async-event-handler-without-reentry-guard",
      noAsyncEventHandlerWithoutReentryGuard,
      {
        iterations: 0,
        corpus: [
          {
            relativePath: "classic-provider-editor.tsx",
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

  it("reaches the imported-control warning and keeps a leading guard quiet", () => {
    const unsafeResult = runRule(noAsyncEventHandlerWithoutReentryGuard, source, { filename });
    expect(unsafeResult.parseErrors).toEqual([]);
    expect(unsafeResult.diagnostics).toHaveLength(1);
    expect(guarded).not.toBe(source);
    const guardedResult = runRule(noAsyncEventHandlerWithoutReentryGuard, guarded, { filename });
    expect(guardedResult.parseErrors).toEqual([]);
    expect(guardedResult.diagnostics).toEqual([]);
  });

  it(
    "fuzzes imported native forwarding with firing and guarded seeds",
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
              relativePath: "unsafe-editor.tsx",
              sourcePath: filename,
              code: source,
              ruleIds: ["no-async-event-handler-without-reentry-guard"],
              verdict: "fail",
            },
            {
              relativePath: "guarded-editor.tsx",
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
