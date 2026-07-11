import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsFlatmapFilter } from "./js-flatmap-filter.js";

describe("js-flatmap-filter — bounded UI pipelines", () => {
  it.each([
    `levels.slice(0, index).map((level) => level.selected).filter(Boolean);`,
    `search.split(",").map((token) => token.trim()).filter(Boolean);`,
  ])("accepts a bounded map/filter pipeline", (code) => {
    const result = runRule(jsFlatmapFilter, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports generic collection pipelines", () => {
    const result = runRule(jsFlatmapFilter, `items.map((item) => item.value).filter(Boolean);`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
