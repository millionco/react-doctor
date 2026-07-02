import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noManyBooleanProps } from "./no-many-boolean-props.js";

describe("no-many-boolean-props", () => {
  it("flags a component with many destructured boolean props", () => {
    const result = runRule(
      noManyBooleanProps,
      `const Toggle = ({ isOpen, isLoading, hasIcon, canEdit }) => <div />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a component that reads many boolean props off its param", () => {
    const result = runRule(
      noManyBooleanProps,
      `function Panel(props) {
        return <div>{props.isOpen && props.isLoading && props.hasIcon && props.canEdit ? "a" : "b"}</div>;
      }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  // A factory that happens to take an options object with on/off flags is
  // not a component — it never returns render output.
  it("does not flag a non-component factory with boolean-prefixed options", () => {
    const result = runRule(
      noManyBooleanProps,
      `function CreateValidator(options) {
        return { run: () => options.isStrict && options.hasSchema && options.canCoerce && options.shouldThrow };
      }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
