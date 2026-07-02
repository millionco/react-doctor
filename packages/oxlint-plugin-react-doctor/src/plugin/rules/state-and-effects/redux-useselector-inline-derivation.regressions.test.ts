import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { reduxUseselectorInlineDerivation } from "./redux-useselector-inline-derivation.js";

describe("redux-useselector-inline-derivation — regressions", () => {
  it("flags array pagination via .slice(0, 10)", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `import { useSelector } from "react-redux";
      function List() {
        const page = useSelector((state) => state.items.slice(0, 10));
        return <span>{page.length}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a zero-arg .slice() array copy", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `import { useSelector } from "react-redux";
      function List() {
        const copy = useSelector((state) => state.items.slice());
        return <span>{copy.length}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an array merge via .concat", () => {
    const result = runRule(
      reduxUseselectorInlineDerivation,
      `import { useSelector } from "react-redux";
      function Merged() {
        const all = useSelector((state) => state.activeUsers.concat(state.invitedUsers));
        return <span>{all.length}</span>;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
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
