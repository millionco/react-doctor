import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noArrayIndexKey } from "./no-array-index-key.js";

describe("react-builtins/no-array-index-key — regressions", () => {
  // prod-fp 2026-07: the JSX `key={index}` attribute is owned by the
  // canonical `no-array-index-as-key` rule; this opt-in port reporting
  // it too double-reported every hit when both rules were enabled.
  it("stays silent on JSX key={index} (delegated to no-array-index-as-key)", () => {
    const result = runRule(
      noArrayIndexKey,
      `const rows = things.map((thing, index) => <Hello key={index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on JSX key={`abc${index}`} (delegated to no-array-index-as-key)", () => {
    const result = runRule(
      noArrayIndexKey,
      "const rows = things.map((thing, index) => <Hello key={`abc${index}`} />);",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // The cloneElement coverage is this rule's whole remaining purpose.
  it("still flags React.cloneElement(child, { key: index })", () => {
    const result = runRule(
      noArrayIndexKey,
      `const rows = things.map((thing, index) => React.cloneElement(thing, { key: index }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags React.cloneElement with a coerced index key", () => {
    const result = runRule(
      noArrayIndexKey,
      `const rows = things.map((thing, index) => React.cloneElement(thing, { key: String(index) }));`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on cloneElement over a positionally stable receiver", () => {
    const result = runRule(
      noArrayIndexKey,
      `const rows = Array.from({ length: 3 }).map((thing, index) =>
        React.cloneElement(placeholder, { key: index }),
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
