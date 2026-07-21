import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMonotonousPageSpacing } from "./no-monotonous-page-spacing.js";

const REPEATED_SPACING = Array.from(
  { length: 12 },
  (_, sampleIndex) => `<div className="p-4">${sampleIndex}</div>`,
).join("");

describe("no-monotonous-page-spacing", () => {
  it("flags a page dominated by one spacing value", () => {
    const result = runRule(
      noMonotonousPageSpacing,
      `const Page = () => <main>${REPEATED_SPACING}</main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reads static inline spacing", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div style={{ padding: 16 }}>${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a page with varied spacing tiers", () => {
    const panels = [1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24]
      .map((spacing) => `<div className="p-${spacing}">${spacing}</div>`)
      .join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not judge a small component sample", () => {
    const result = runRule(
      noMonotonousPageSpacing,
      `const Card = () => <main><div className="p-4">A</div><div className="p-4">B</div></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer spacing from unresolved custom component class contracts", () => {
    const customComponents = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<Widget className="p-4" key={${sampleIndex}} />`,
    ).join("");
    const intrinsicAliases = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<Panel className="p-4" key={${sampleIndex}} />`,
    ).join("");
    const result = runRule(
      noMonotonousPageSpacing,
      `const Panel = "section"; const Page = () => <><main>${customComponents}</main><main>${intrinsicAliases}</main></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not count conditional spacing variants as page samples", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="hover:p-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for overlapping equal-priority spacing conflicts", () => {
    const forwardPanels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="p-4 px-6 gap-4">${sampleIndex}</div>`,
    ).join("");
    const reversePanels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="px-6 p-4 gap-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(
      noMonotonousPageSpacing,
      `const Page = () => <><main>${forwardPanels}</main><main>${reversePanels}</main></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet for distinct important spacing conflicts", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="!p-4 p-6! gap-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors one important spacing tier over normal utilities", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="p-2 !p-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows compatible axis utilities with the same effective value", () => {
    const panels = Array.from(
      { length: 12 },
      (_, sampleIndex) => `<div className="px-4 py-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("only interprets class spacing when Tailwind is available", () => {
    const result = runRule(
      noMonotonousPageSpacing,
      `const Page = () => <main>${REPEATED_SPACING}</main>;`,
      { settings: { "react-doctor": { capabilities: [] } } },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count class spacing overridden by inline declarations", () => {
    const overriddenPanels = [1, 2, 3, 4, 5, 6]
      .map(
        (spacing, sampleIndex) =>
          `<div className="p-4" style={{ padding: ${spacing} }}>${sampleIndex}</div>`,
      )
      .join("");
    const classPanels = Array.from(
      { length: 6 },
      (_, sampleIndex) => `<div className="p-4">${sampleIndex}</div>`,
    ).join("");
    const result = runRule(
      noMonotonousPageSpacing,
      `const Page = () => <main>${overriddenPanels}${classPanels}</main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when important class spacing competes with inline spacing", () => {
    const panels = [1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20]
      .map(
        (spacing, sampleIndex) =>
          `<div className="!p-${spacing}" style={{ padding: 16 }}>${sampleIndex}</div>`,
      )
      .join("");
    const result = runRule(noMonotonousPageSpacing, `const Page = () => <main>${panels}</main>;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
