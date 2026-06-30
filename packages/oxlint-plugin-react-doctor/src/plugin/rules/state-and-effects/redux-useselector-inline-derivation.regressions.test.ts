import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reduxUseselectorInlineDerivation } from "./redux-useselector-inline-derivation.js";

describe("redux-useselector-inline-derivation — regressions", () => {
  it("stays silent on a String.slice receiver", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `import { useSelector } from "react-redux";
      function Name() {
        const short = useSelector((state) => state.user.name.slice(0, 20));
        return <span>{short}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a String.concat receiver", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `import { useSelector } from "react-redux";
      function Name() {
        const full = useSelector((state) => state.firstName.concat(state.lastName));
        return <span>{full}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an array-only deriving method", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `import { useSelector } from "react-redux";
      function List() {
        const items = useSelector((state) => state.items.filter((x) => x.active));
        return <span>{items.length}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
