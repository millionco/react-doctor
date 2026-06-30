import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rnListDataMapped } from "./rn-list-data-mapped.js";

describe("react-native/rn-list-data-mapped — regressions", () => {
  it("stays silent on an empty-array placeholder", () => {
    const result = runRule(
      rnListDataMapped,
      `const C = () => <FlatList data={[]} renderItem={r} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a freshly mapped array", () => {
    const result = runRule(
      rnListDataMapped,
      `const C = ({ items }) => <FlatList data={items.map((x) => x.id)} renderItem={r} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
