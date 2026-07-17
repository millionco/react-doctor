import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMultipleLabelsForControl } from "./no-multiple-labels-for-control.js";

describe("no-multiple-labels-for-control", () => {
  it("reports a second explicit label for one control", () => {
    const result = runRule(
      noMultipleLabelsForControl,
      `const Form = () => <><label htmlFor="name">Name</label><label htmlFor="name">Required</label><input id="name" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts separate controls and dynamic label targets", () => {
    const result = runRule(
      noMultipleLabelsForControl,
      `const Form = ({ target }) => <><label htmlFor="first">First</label><label htmlFor="last">Last</label><label htmlFor={target}>Dynamic</label></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("leaves duplicate orphaned labels to association rules", () => {
    const result = runRule(
      noMultipleLabelsForControl,
      `const Form = () => <><label htmlFor="missing">First</label><label htmlFor="missing">Second</label></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
