import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { noPromiseThenSideEffectInEffectWithoutCatch } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/no-promise-then-side-effect-in-effect-without-catch.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { resetFilesystemCaches } from "../../oxlint-plugin-react-doctor/src/plugin/utils/reset-filesystem-caches.js";
import { DEFAULT_FUZZ_ITERATIONS, DEFAULT_FUZZ_SEED } from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-repeat-corpus-"));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
for (const name of ["package.json", "entry.tsx"])
  fs.writeFileSync(
    path.join(directory, name),
    fs.readFileSync(new URL(`../fixtures/native-repeat-mode/${name}.txt`, import.meta.url)),
  );
const filename = path.join(directory, "entry.tsx");
const source = fs.readFileSync(filename, "utf8");
describe("native repeat-mode project corpus", () => {
  it("fires for a native-capable declared SDK project", () => {
    resetFilesystemCaches();
    const result = runRule(noPromiseThenSideEffectInEffectWithoutCatch, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("keeps an actual rejection handler quiet", () => {
    resetFilesystemCaches();
    const result = runRule(
      noPromiseThenSideEffectInEffectWithoutCatch,
      source.replace(".then(setMode)", ".then(setMode).catch(()=>{})"),
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("checks native project inputs without executing fixture code", () => {
    resetFilesystemCaches();
    const result = fuzzRuleWithStats(
      "no-promise-then-side-effect-in-effect-without-catch",
      noPromiseThenSideEffectInEffectWithoutCatch,
      {
        iterations: DEFAULT_FUZZ_ITERATIONS,
        checkInvariants: true,
        seed: DEFAULT_FUZZ_SEED,
        corpus: [
          {
            relativePath: "entry.tsx",
            sourcePath: filename,
            code: source,
            ruleIds: ["no-promise-then-side-effect-in-effect-without-catch"],
            verdict: "fail",
          },
        ],
      },
    );
    expect(result.findings).toEqual([]);
    expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  });
});
