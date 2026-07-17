import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { iframeTitleUnique } from "./iframe-title-unique.js";

describe("iframe-title-unique", () => {
  it("reports duplicate normalized frame titles", () => {
    const result = runRule(
      iframeTitleUnique,
      `const View = () => <><iframe title="Store map" /><iframe title=" store   MAP " /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts distinct and dynamic frame titles", () => {
    const result = runRule(
      iframeTitleUnique,
      `const View = ({ title }) => <><iframe title="Store map" /><iframe title="Directions" /><iframe title={title} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
