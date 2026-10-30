import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { clickEventsHaveKeyEvents } from "../../oxlint-plugin-react-doctor/src/plugin/rules/a11y/click-events-have-key-events.js";
import { noStaticElementInteractions } from "../../oxlint-plugin-react-doctor/src/plugin/rules/a11y/no-static-element-interactions.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const corpus = loadFuzzCorpus(
  fileURLToPath(new URL("../corpus/regressions/native-focus-callback/", import.meta.url)),
);

describe("native focus callback synthetic corpus", () => {
  for (const rule of [clickEventsHaveKeyEvents, noStaticElementInteractions]) {
    it(`preserves verdicts while fuzzing ${rule.id}`, () => {
      expect(corpus).toHaveLength(5);
      const result = fuzzRuleWithStats(rule.id, rule, {
        corpus,
        iterations: 500,
        seed: 42,
        checkInvariants: true,
      });
      expect(result.findings).toEqual([]);
      expect(result.stats.firedProgramCount).toBeGreaterThan(0);
    });
  }
});
