import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNoJsxAsProp } from "./jsx-no-jsx-as-prop.js";

describe("react-builtins/jsx-no-jsx-as-prop regressions", () => {
  // `separator` is a canonical layout slot — `<Join separator={<Spacer />}>`,
  // `<Stack separator={<Divider />}>` — on children-taking layout primitives
  // that never memoize. The inline element is the intended API, not a footgun.
  it("does not flag a `separator` slot receiving inline JSX", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Join separator={<Spacer y={4} />}>{rows}</Join>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a `divider` slot receiving inline JSX", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Stack divider={<Divider />}>{rows}</Stack>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags inline JSX passed to a non-slot prop on a (memo-unknown) imported component", () => {
    const result = runRule(
      jsxNoJsxAsProp,
      `const View = () => <Imported widget={<Heavy />}>{rows}</Imported>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
