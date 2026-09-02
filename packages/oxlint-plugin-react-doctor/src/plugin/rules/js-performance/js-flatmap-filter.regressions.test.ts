import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsFlatmapFilter } from "./js-flatmap-filter.js";

describe("js-performance/js-flatmap-filter — regressions", () => {
  it("still flags `.map().filter(Boolean)` when the inner call is wrapped in `as any`", () => {
    const result = runRule(
      jsFlatmapFilter,
      `const ids = (items.map((item) => item.id) as any).filter(Boolean);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recommends a direct single-pass rewrite instead of flatMap", () => {
    const result = runRule(jsFlatmapFilter, `items.map((item) => item.value).filter(Boolean);`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("measured hot path");
    expect(result.diagnostics[0].message).toContain(".reduce()");
    expect(result.diagnostics[0].message).toContain("for...of");
    expect(result.diagnostics[0].message).not.toContain("flatMap");
    expect(jsFlatmapFilter.recommendation).toContain("measured hot path");
    expect(jsFlatmapFilter.recommendation).toContain("`.reduce()`");
    expect(jsFlatmapFilter.recommendation).toContain("`for...of`");
    expect(jsFlatmapFilter.recommendation).not.toContain("flatMap");
  });
});
