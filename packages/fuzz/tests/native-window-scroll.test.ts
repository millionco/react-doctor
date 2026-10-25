import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { noSmoothScrollWithoutReducedMotion } from "../../oxlint-plugin-react-doctor/src/plugin/rules/design/no-smooth-scroll-without-reduced-motion.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  DEFAULT_FUZZ_SEED,
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
} from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const directory = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "rd-native-scroll-corpus-"),
);
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
for (const name of ["package.json", "entry.tsx"])
  fs.writeFileSync(
    path.join(directory, name),
    fs.readFileSync(new URL(`../fixtures/native-window-scroll/${name}.txt`, import.meta.url)),
  );
const filename = path.join(directory, "entry.tsx");
const source = fs.readFileSync(filename, "utf8");
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
const timeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);

describe("native window scroll project corpus", () => {
  it("fires the imperative arm with a complete synthetic project", () => {
    const result = runRule(noSmoothScrollWithoutReducedMotion, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(
      "button always requests smooth window scrolling",
    );
  });
  it("retains an instant scrolling control", () => {
    const result = runRule(
      noSmoothScrollWithoutReducedMotion,
      source.replace('behavior: "smooth"', 'behavior: "instant"'),
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it(
    "fuzzes the project-backed imperative arm with invariant and fire gates",
    () => {
      expect(Number.isInteger(iterations) && iterations > 0).toBe(true);
      expect(Number.isInteger(seed) && seed > 0).toBe(true);
      const result = fuzzRuleWithStats(
        "no-smooth-scroll-without-reduced-motion",
        noSmoothScrollWithoutReducedMotion,
        {
          iterations,
          checkInvariants: true,
          seed,
          corpus: [
            {
              relativePath: "entry.tsx",
              sourcePath: filename,
              code: source,
              ruleIds: ["no-smooth-scroll-without-reduced-motion"],
              verdict: "fail",
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
