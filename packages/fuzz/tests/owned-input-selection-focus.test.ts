import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vite-plus/test";
import { noEffectChain } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-effect-chain.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import {
  DEFAULT_FUZZ_ITERATIONS,
  DEFAULT_FUZZ_SEED,
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
} from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const directory = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), "rd-owned-selection-corpus-"),
);
const packageBody = fs.readFileSync(
  new URL("../fixtures/owned-input-selection-focus/package.json.txt", import.meta.url),
  "utf8",
);
const source = fs.readFileSync(
  new URL("../fixtures/owned-input-selection-focus/entry.tsx.txt", import.meta.url),
  "utf8",
);
const filename = path.join(directory, "entry.tsx");
fs.writeFileSync(filename, source);
const inverse = source
  .replace("      finish();", "      setTotal(position * 5);\n      finish();")
  .replace("// verdict: pass", "// verdict: fail");
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
const timeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);

beforeEach(() => {
  fs.writeFileSync(path.join(directory, "package.json"), packageBody);
  resetFilesystemCaches();
});
afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("owned input selection project regression", () => {
  it("keeps the native selection and focus reset quiet in its declared profile", () => {
    const result = runRule(noEffectChain, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("retains a real same-index derived-state warning", () => {
    expect(inverse).not.toBe(source);
    const result = runRule(noEffectChain, inverse, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('changes "position"');
  });
  it("fails closed for unsupported React19 with absolute and relative filenames", () => {
    fs.writeFileSync(
      path.join(directory, "package.json"),
      packageBody.replace('"18.2.0"', '"19.0.0"'),
    );
    for (const candidateFilename of [filename, path.relative(process.cwd(), filename)]) {
      resetFilesystemCaches();
      const result = runRule(noEffectChain, source, { filename: candidateFilename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });
  it(
    "fuzzes the physical project with pass and firing inverse controls",
    () => {
      expect(Number.isInteger(iterations) && iterations > 0).toBe(true);
      expect(Number.isInteger(seed) && seed > 0).toBe(true);
      const result = fuzzRuleWithStats("no-effect-chain", noEffectChain, {
        iterations,
        seed,
        checkInvariants: true,
        corpus: [
          {
            relativePath: "owned-native-selection.tsx",
            sourcePath: filename,
            code: source,
            ruleIds: ["no-effect-chain"],
            verdict: "pass",
          },
          {
            relativePath: "derived-state-inverse.tsx",
            sourcePath: filename,
            code: inverse,
            ruleIds: ["no-effect-chain"],
            verdict: "fail",
          },
        ],
      });
      expect(result.findings).toEqual([]);
      expect(result.stats.firedProgramCount).toBeGreaterThan(0);
    },
    timeoutMs,
  );
});
