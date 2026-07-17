import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFlatPageTypeScale } from "./no-flat-page-type-scale.js";

describe("no-flat-page-type-scale", () => {
  it("flags a page with several tightly grouped text sizes", () => {
    const result = runRule(
      noFlatPageTypeScale,
      `const Page = () => <main><p className="text-sm">A</p><h2 className="text-base">B</h2><h1 className="text-lg">C</h1></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reads arbitrary and inline sizes", () => {
    const result = runRule(
      noFlatPageTypeScale,
      `const Page = () => <main><p className="text-[14px]">A</p><h2 style={{ fontSize: "1rem" }}>B</h2><h1 style={{ fontSize: 18 }}>C</h1></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a page with a strong type hierarchy", () => {
    const result = runRule(
      noFlatPageTypeScale,
      `const Page = () => <main><p className="text-sm">A</p><h2 className="text-2xl">B</h2><h1 className="text-5xl">C</h1></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer a page scale from dynamic component styles", () => {
    const result = runRule(
      noFlatPageTypeScale,
      `const Page = ({ titleClass }) => <main><p className="text-sm">A</p><h2 className={titleClass}>B</h2><Hero /></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine responsive sizes into one page scale", () => {
    const result = runRule(
      noFlatPageTypeScale,
      `const Page = () => <main><h1 className="text-sm md:text-base lg:text-lg">Title</h1></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
