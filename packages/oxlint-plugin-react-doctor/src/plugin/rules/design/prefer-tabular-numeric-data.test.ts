import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferTabularNumericData } from "./prefer-tabular-numeric-data.js";

describe("prefer-tabular-numeric-data", () => {
  it("flags formatted dynamic numbers in table cells", () => {
    const result = runRule(
      preferTabularNumericData,
      `const Row = ({ total }) => <tr><td>{total.toLocaleString()}</td><td>{total.toFixed(2)}</td></tr>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("allows tabular numerals inherited from the table", () => {
    const result = runRule(
      preferTabularNumericData,
      `const Row = ({ total }) => <table className="tabular-nums"><tbody><tr><td>{total.toLocaleString()}</td></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores prose cells and static numbers", () => {
    const result = runRule(
      preferTabularNumericData,
      `const Row = () => <tr><td>Revenue</td><td>2026</td></tr>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
