import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { EFFECT_SNIPPET_POOL } from "../../../../../fuzz/src/snippet-pools.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassLiveStateToParent } from "./no-pass-live-state-to-parent.js";

interface GetterCorpusCase {
  fixtureName: string;
  expected: number;
}

const cases: GetterCorpusCase[] = [
  { fixtureName: "consumed-status-getter", expected: 0 },
  { fixtureName: "bare-getter-notification", expected: 1 },
  { fixtureName: "react-provider-accessor-replacement", expected: 1 },
];

describe("status getter corpus roles", () => {
  it.each(cases)("$fixtureName", ({ fixtureName, expected }) => {
    const source = readFileSync(
      new URL(
        `../../../../../fuzz/corpus/regressions/no-pass-live-state-to-parent--${fixtureName}.tsx`,
        import.meta.url,
      ),
      "utf8",
    );
    const result = runRule(noPassLiveStateToParent, source, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });

  it("keeps the separate bare notification in the generator block", () => {
    const snippet = EFFECT_SNIPPET_POOL.find((entry) => entry.includes("FuzzConsumedStatusGetter"));
    expect(snippet).toBeDefined();
    const source = `import {useCallback,useEffect,useState} from "react";const handle=(value)=>String(value);${snippet}`;
    const result = runRule(noPassLiveStateToParent, source, { filename: "fixture.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
