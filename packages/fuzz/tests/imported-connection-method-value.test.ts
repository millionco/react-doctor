import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { effectNeedsCleanup } from "../../oxlint-plugin-react-doctor/src/plugin/rules/state-and-effects/effect-needs-cleanup.js";
import { runRule } from "../../oxlint-plugin-react-doctor/src/test-utils/run-rule.js";
import { DEFAULT_FUZZ_ITERATIONS, DEFAULT_FUZZ_SEED } from "../src/constants.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-connection-corpus-"));
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));
for (const name of ["package.json", "channel.ts", "entry.tsx"])
  fs.writeFileSync(
    path.join(directory, name),
    fs.readFileSync(
      new URL(`../fixtures/imported-connection-method-value/${name}.txt`, import.meta.url),
    ),
  );
const filename = path.join(directory, "entry.tsx");
const source = fs.readFileSync(filename, "utf8");
describe("imported own connection corpus", () => {
  it("reports the missing invocation with complete synthetic project context", () => {
    const result = runRule(effectNeedsCleanup, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
  it("retains an actual same-instance release control", () => {
    const result = runRule(
      effectNeedsCleanup,
      source.replace("()=>client.finish)", "()=>client.finish())"),
      { filename },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it("checks project-backed fuzz inputs without executing the fixture", () => {
    const result = fuzzRuleWithStats("effect-needs-cleanup", effectNeedsCleanup, {
      iterations: DEFAULT_FUZZ_ITERATIONS,
      checkInvariants: true,
      seed: DEFAULT_FUZZ_SEED,
      corpus: [
        {
          relativePath: "entry.tsx",
          sourcePath: filename,
          code: source,
          ruleIds: ["effect-needs-cleanup"],
          verdict: "fail",
        },
      ],
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.firedProgramCount).toBeGreaterThan(0);
  });
});
