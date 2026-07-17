import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMultipleUnlabeledNavigationLandmarks } from "./no-multiple-unlabeled-navigation-landmarks.js";

describe("no-multiple-unlabeled-navigation-landmarks", () => {
  it("reports coexisting unnamed landmarks", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <><nav>Primary</nav><main /><nav>Footer</nav></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports duplicate names", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <div><nav aria-label="Sections" /><nav aria-label={"Sections"} /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows unique labels and a single landmark", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const A = () => <><nav aria-label="Primary" /><nav aria-labelledby="footer-heading" /></>; const B = () => <nav />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips alternate roots, dynamic labels, spreads, and custom components", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = ({ mobile, label, props }) => mobile ? <nav /> : <nav />; const Dynamic = () => <><nav aria-label={label} /><nav {...props} /></>; const Custom = () => <><Nav /><Nav /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
