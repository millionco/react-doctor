import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { iframeHasTitle } from "./iframe-has-title.js";

describe("a11y/iframe-has-title regressions", () => {
  it("allows an unnamed preview iframe inside a statically hidden subtree", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => (
        <div className="design-card-thumb" aria-hidden>
          <iframe src="/preview" title="" loading="lazy" sandbox="allow-scripts" tabIndex={-1} />
        </div>
      );`,
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still reports a visible unnamed preview iframe", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = () => <iframe src="/preview" title="" tabIndex={-1} />;`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when the ancestor hidden state is dynamic", () => {
    const result = runRule(
      iframeHasTitle,
      `const Preview = ({ isHidden }) => (
        <div aria-hidden={isHidden}>
          <iframe src="/preview" title="" />
        </div>
      );`,
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
