import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTinyUppercaseTrackedLabel } from "./no-tiny-uppercase-tracked-label.js";

describe("no-tiny-uppercase-tracked-label", () => {
  it("reports tiny uppercase labels with decorative tracking", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <><span className="text-[10px] uppercase tracking-[0.18em]">Recent activity</span><p className="text-[0.6875rem] uppercase tracking-wide">Account details</p><span className="text-[10px] uppercase tracking-wide">LATEST NEWS</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows each ingredient on its own and readable label sizes", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <><span className="text-[10px] tracking-wide">Recent activity</span><span className="text-[10px] uppercase">Recent activity</span><span className="text-xs uppercase tracking-wide">Recent activity</span></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays quiet when size, casing, or tracking utilities conflict", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <><span className="text-[10px] text-sm uppercase tracking-wide">Recent activity</span><span className="text-[10px] uppercase normal-case tracking-wide">Recent activity</span><span className="text-[10px] uppercase tracking-wide tracking-normal">Recent activity</span><span className="text-sm text-[10px] normal-case uppercase tracking-normal tracking-tight">Recent activity</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when important utilities conflict", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <><span className="!text-[10px] !text-sm uppercase tracking-wide">Size</span><span className="text-[10px] !uppercase !normal-case tracking-wide">Case</span><span className="text-[10px] uppercase !tracking-wide !tracking-normal">Tracking</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors important size, casing, and tracking precedence", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <><span className="!text-xs text-[10px] uppercase tracking-wide">Readable important size</span><span className="text-xs !text-[10px] text-xs uppercase tracking-wide">Tiny important size</span><span className="text-[10px] !normal-case uppercase tracking-wide">Normal case</span><span className="text-[10px] normal-case !uppercase normal-case tracking-wide">Uppercase</span><span className="text-[10px] uppercase !tracking-normal tracking-wide">Normal tracking</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports type-hinted arbitrary font lengths", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Label = () => <span className="text-[length:10px] uppercase tracking-wide">Recent activity</span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores code-like values, preformatted text, and dynamic labels", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = ({ value }) => <><span className="text-[10px] uppercase tracking-wide">API_V2</span><code className="text-[10px] uppercase tracking-wide">GET request</code><span className="text-[10px] uppercase tracking-wide">{value}</span></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores responsive-only ingredients and zero arbitrary tracking in any unit", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <><span className="text-[10px] md:uppercase tracking-wide">Recent activity</span><span className="text-[10px] uppercase md:tracking-wide">Recent activity</span><span className="text-[10px] uppercase tracking-[0em]">Recent activity</span><span className="text-[10px] uppercase tracking-wide tracking-[0rem]">Recent activity</span></>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores malformed arbitrary font sizes", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Labels = () => <span className="text-[..px] uppercase tracking-wide">Recent activity</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips spread-overridable class contracts", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Label = ({ props }) => <span className="text-[10px] uppercase tracking-wide" {...props}>Recent activity</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips inline styles that can override the visual claim", () => {
    const result = runRule(
      noTinyUppercaseTrackedLabel,
      `const Label = () => <span className="text-[10px] uppercase tracking-wide" style={{ fontSize: 16 }}>Recent activity</span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
