import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tabindexNoPositive } from "./tabindex-no-positive.js";

describe("a11y/tabindex-no-positive regressions", () => {
  it("does not flag a passthrough sentinel in a .test file", () => {
    const result = runRule(
      tabindexNoPositive,
      `render(<VictoryAccessibleGroup tabIndex={2} className="accessibility-group" />);`,
      { filename: "src/victory-accessible-group/victory-accessible-group.test.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a passthrough sentinel in a .spec file", () => {
    const result = runRule(tabindexNoPositive, `render(<Accordion tabIndex={1} />);`, {
      filename: "src/components/accordion/Accordion.spec.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a tab-order demo in a Storybook story", () => {
    const result = runRule(
      tabindexNoPositive,
      `export const Demo = () => <button tabIndex={1}>first</button>;`,
      { filename: "src/core/utils/RovingFocusGroup/stories/RovingFocusGroup.stories.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a docs-site example", () => {
    const result = runRule(tabindexNoPositive, `<DatePicker tabIndex={1} />`, {
      filename: "docs-site/src/examples/ts/tabIndex.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a positive tabIndex in production code", () => {
    const result = runRule(
      tabindexNoPositive,
      `export const Form = () => <input tabIndex={3} />;`,
      { filename: "src/components/checkout/Form.tsx" },
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a positive string tabIndex in production code", () => {
    const result = runRule(tabindexNoPositive, `export const A = () => <div tabIndex="5" />;`, {
      filename: "src/app/page.tsx",
    });
    expect(result.diagnostics).toHaveLength(1);
  });
});
