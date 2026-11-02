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

const directory = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "rd-owned-close-focus-"));
const packageBody = fs.readFileSync(
  new URL("../fixtures/owned-input-selection-focus/package.json.txt", import.meta.url),
  "utf8",
);
const source = fs.readFileSync(
  new URL("../corpus/regressions/no-effect-chain--owned-input-close-focus.tsx", import.meta.url),
  "utf8",
);
const filename = path.join(directory, "close-focus-field.tsx");
const inverseWithState = source.replace(
  "  const field = useRef(null);",
  "  const [total, setTotal] = useState(0);\n  const field = useRef(null);",
);
const inverseWithOutput = inverseWithState.replace(
  "  return <input ref={field} onClick={() => setPosition(0)} />;",
  "  return <input ref={field} onClick={() => setPosition(0)} data-total={total} />;",
);
const inverse = inverseWithOutput.replace(
  "    if (isActive && position === 0) restoreFocus();",
  "    if (isActive && position === 0) restoreFocus();\n    setTotal(position);",
);
const iterations = Number(process.env.FUZZ_ITERATIONS ?? DEFAULT_FUZZ_ITERATIONS);
const seed = Number(process.env.FUZZ_SEED ?? DEFAULT_FUZZ_SEED);
const timeoutMs = Math.max(
  DEFAULT_FUZZ_TEST_TIMEOUT_MS,
  iterations * FUZZ_ITERATION_TIMEOUT_BUDGET_MS,
);
const warningControls = [
  {
    name: "true writes preserve navigation work",
    source: source.replace("    setOpened(false);", "    setOpened(true);"),
  },
  {
    name: "mixed writes preserve navigation work",
    source: source.replace(
      "    setOpened(false);",
      "    setOpened(false); if (query) setOpened(true);",
    ),
  },
  {
    name: "unknown writes preserve navigation work",
    source: source.replace("    setOpened(false);", "    setOpened(query);"),
  },
  {
    name: "custom hosts decline the native certificate",
    source: source.replace("return <input ref={field}", "return <ForeignField ref={field}"),
  },
  { name: "reachable sibling work remains a chain", source: inverse },
];

beforeEach(() => {
  fs.writeFileSync(path.join(directory, "package.json"), packageBody);
  fs.writeFileSync(filename, source);
  resetFilesystemCaches();
});
afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  resetFilesystemCaches();
});

describe("owned input close-edge project regression", () => {
  it("keeps only the all-false native focus restoration edge quiet", () => {
    const result = runRule(noEffectChain, source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
  it.each(warningControls)("$name", (control) => {
    expect(control.source).not.toBe(source);
    const result = runRule(noEffectChain, control.source, { filename });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain('changes "opened"');
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
      expect(inverse).not.toBe(source);
      expect(inverseWithState).not.toBe(source);
      expect(inverseWithOutput).not.toBe(inverseWithState);
      expect(inverse).not.toBe(inverseWithOutput);
      const result = fuzzRuleWithStats("no-effect-chain", noEffectChain, {
        iterations,
        seed,
        checkInvariants: true,
        corpus: [
          {
            relativePath: "owned-close-focus.tsx",
            sourcePath: filename,
            code: source,
            ruleIds: ["no-effect-chain"],
            verdict: "pass",
          },
          {
            relativePath: "close-derived-state-inverse.tsx",
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
