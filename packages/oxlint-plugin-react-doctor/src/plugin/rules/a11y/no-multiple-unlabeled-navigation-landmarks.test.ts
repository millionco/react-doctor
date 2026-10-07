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

  it("accepts mutually exclusive responsive navigation landmarks", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <main><section className="block md:hidden"><nav>Mobile</nav></section><aside className="hidden md:grid"><nav>Desktop</nav></aside></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports navigation landmarks that coexist at inherited responsive breakpoints", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <main><nav className="hidden md:block">Primary</nav><nav className="hidden lg:block">Secondary</nav></main>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores statically hidden Tailwind navigation landmarks", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <main><nav className="collapse">Collapsed</nav><nav className="[display:none]">Display</nav><nav className="[visibility:hidden]">Visibility</nav><nav>Primary</nav></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips landmarks separated by opaque component boundaries", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <main><aside className="hidden sm:flex"><nav>Desktop</nav></aside><DrawerContent><nav>Mobile</nav></DrawerContent></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports coexisting landmarks within the same opaque component boundary", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = () => <DrawerContent><nav>Primary</nav><nav>Secondary</nav></DrawerContent>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips landmarks with dynamic ancestor visibility", () => {
    const result = runRule(
      noMultipleUnlabeledNavigationLandmarks,
      `const Page = ({ className }) => <main><aside className={className}><nav>Primary</nav></aside><nav>Secondary</nav></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
