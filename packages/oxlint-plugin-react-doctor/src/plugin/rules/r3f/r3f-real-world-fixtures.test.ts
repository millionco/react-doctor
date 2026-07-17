import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { r3fRealWorldFixtures } from "./__fixtures__/real-world-r3f-fixtures.js";

describe("R3F real-world fixtures", () => {
  for (const fixture of r3fRealWorldFixtures) {
    it(`${fixture.name} — ${fixture.sourceUrl}`, () => {
      const result = runRule(fixture.rule, fixture.code);
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(fixture.expectedDiagnosticCount);
    });
  }
});
