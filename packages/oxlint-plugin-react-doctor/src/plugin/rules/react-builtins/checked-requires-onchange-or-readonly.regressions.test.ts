import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { checkedRequiresOnchangeOrReadonly } from "./checked-requires-onchange-or-readonly.js";

describe("react-builtins/checked-requires-onchange-or-readonly — regressions", () => {
  // A spread can supply `onChange`/`readOnly` at runtime, so the
  // missing-handler report must be suppressed when one is present.
  it("stays silent when onChange/readOnly may arrive via spread", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = ({ checked, ...rest }) => <input type="checkbox" checked={checked} {...rest} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags checked + defaultChecked used together even with a spread", () => {
    const result = runRule(
      checkedRequiresOnchangeOrReadonly,
      `const C = (props) => <input type="checkbox" checked defaultChecked {...props} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
