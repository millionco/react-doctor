import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noHairlineBorderWideShadow } from "./no-hairline-border-wide-shadow.js";

describe("no-hairline-border-wide-shadow", () => {
  it("flags a Tailwind hairline border with a large shadow", () => {
    const result = runRule(
      noHairlineBorderWideShadow,
      `const Card = () => <div className="border shadow-2xl" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an inline hairline border with a broad shadow", () => {
    const result = runRule(
      noHairlineBorderWideShadow,
      `const Card = () => <div style={{ border: "1px solid #ddd", boxShadow: "0 8px 24px rgba(0,0,0,.15)" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a border with a compact shadow", () => {
    const result = runRule(
      noHairlineBorderWideShadow,
      `const Card = () => <div className="border shadow-sm" style={{ borderWidth: 1, boxShadow: "0 1px 3px #0002" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts a broad shadow without a border", () => {
    const result = runRule(
      noHairlineBorderWideShadow,
      `const Card = () => <div className="shadow-2xl" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not combine border and shadow utilities across variants", () => {
    const result = runRule(
      noHairlineBorderWideShadow,
      `const Card = () => <div className="border dark:shadow-2xl" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores explicitly invisible borders and shadows", () => {
    const result = runRule(
      noHairlineBorderWideShadow,
      `const Cards = () => <>
        <div className="border border-transparent shadow-2xl" />
        <div className="border shadow-2xl shadow-none" />
        <div style={{ border: "1px solid transparent", boxShadow: "0 8px 24px #0002" }} />
        <div style={{ border: "1px solid #ddd", boxShadow: "0 8px 24px transparent" }} />
        <div style={{ borderWidth: 1, boxShadow: "0 8px 24px #0002" }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
