import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnsafe } from "./no-unsafe.js";

describe("react-builtins/no-unsafe — regressions", () => {
  it("flags computed string lifecycle method definitions", () => {
    const result = runRule(
      noUnsafe,
      `
        class Example extends React.Component {
          ["UNSAFE_componentWillMount"]() {}
          render() {
            return null;
          }
        }
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags computed string lifecycle properties", () => {
    const result = runRule(
      noUnsafe,
      `
        const Example = React.createClass({
          ["UNSAFE_componentWillMount"]: function () {},
          render() {
            return null;
          },
        });
      `,
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
