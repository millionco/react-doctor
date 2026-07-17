import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUppercaseTrackedNavigationLabel } from "./no-uppercase-tracked-navigation-label.js";

describe("no-uppercase-tracked-navigation-label", () => {
  it("flags an uppercase tracked sidebar label", () => {
    const result = runRule(
      noUppercaseTrackedNavigationLabel,
      `const Sidebar = () => <aside><span className="text-xs uppercase tracking-widest">Workspace</span></aside>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes an explicit navigation role", () => {
    const result = runRule(
      noUppercaseTrackedNavigationLabel,
      `const Sidebar = () => <div role="navigation"><p className="uppercase tracking-[0.2em]">Projects</p></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts ordinary navigation labels", () => {
    const result = runRule(
      noUppercaseTrackedNavigationLabel,
      `const Sidebar = () => <nav><span className="text-sm font-medium">Projects</span></nav>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores code content and labels outside navigation", () => {
    const result = runRule(
      noUppercaseTrackedNavigationLabel,
      `const Labels = () => <><nav><code className="uppercase tracking-widest">GET</code></nav><span className="uppercase tracking-widest">Overview</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
