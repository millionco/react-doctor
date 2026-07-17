import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { dataTableRequiresAccessibleName } from "./data-table-requires-accessible-name.js";

describe("data-table-requires-accessible-name", () => {
  it("reports a header-bearing table without a name", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Ada</td></tr></tbody></table>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows captions and ARIA names", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = () => <><table><caption>Results</caption><tr><th>Name</th></tr></table><table aria-labelledby="results-title"><tr><th>Name</th></tr></table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips layout, spread-owned, headerless, and custom tables", () => {
    const result = runRule(
      dataTableRequiresAccessibleName,
      `const Results = ({ props }) => <><table role="presentation"><tr><th>Name</th></tr></table><table {...props}><tr><th>Name</th></tr></table><table><tr><td>Ada</td></tr></table><Table><th>Name</th></Table></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
