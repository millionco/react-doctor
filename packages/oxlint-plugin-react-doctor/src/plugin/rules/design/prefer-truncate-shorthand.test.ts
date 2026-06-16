import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferTruncateShorthand } from "./prefer-truncate-shorthand.js";

describe("prefer-truncate-shorthand", () => {
  it("flags the three-class combo", () => {
    const code = `const A = () => <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name}</span>;`;
    const result = runRule(preferTruncateShorthand, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags regardless of order/extra classes", () => {
    const code = `const A = () => <span className="max-w-40 whitespace-nowrap text-sm overflow-hidden text-ellipsis">{name}</span>;`;
    const result = runRule(preferTruncateShorthand, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag when only two of the three are present", () => {
    const code = `const A = () => <span className="overflow-hidden whitespace-nowrap">{name}</span>;`;
    const result = runRule(preferTruncateShorthand, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a line-clamp pattern", () => {
    const code = `const A = () => <p className="overflow-hidden line-clamp-2">{body}</p>;`;
    const result = runRule(preferTruncateShorthand, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag an already-truncate element", () => {
    const code = `const A = () => <span className="truncate max-w-40">{name}</span>;`;
    const result = runRule(preferTruncateShorthand, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
