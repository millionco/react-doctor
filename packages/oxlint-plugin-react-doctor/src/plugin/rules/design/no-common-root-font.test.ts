import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCommonRootFont } from "./no-common-root-font.js";

describe("no-common-root-font", () => {
  it("flags a common font assigned to main", () => {
    const result = runRule(
      noCommonRootFont,
      `const Page = () => <main style={{ fontFamily: "Inter, sans-serif" }}>Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a full-page wrapper", () => {
    const result = runRule(
      noCommonRootFont,
      `const Page = () => <div className="min-h-screen" style={{ fontFamily: "Roboto" }}>Content</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a common Tailwind font on main", () => {
    const result = runRule(
      noCommonRootFont,
      `const Page = () => <main className="font-inter">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a distinctive root font", () => {
    const result = runRule(
      noCommonRootFont,
      `const Page = () => <main style={{ fontFamily: "Recursive, sans-serif" }}>Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not judge local component typography", () => {
    const result = runRule(
      noCommonRootFont,
      `const Badge = () => <span style={{ fontFamily: "Inter" }}>Status</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a conditional font as the page default", () => {
    const result = runRule(
      noCommonRootFont,
      `const Page = () => <main className="dark:font-inter">Content</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
