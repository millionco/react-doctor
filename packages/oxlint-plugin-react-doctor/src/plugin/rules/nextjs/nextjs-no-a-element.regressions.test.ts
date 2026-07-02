import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoAElement } from "./nextjs-no-a-element.js";

describe("nextjs/nextjs-no-a-element — regressions", () => {
  it("stays silent on a protocol-relative external URL", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="//cdn.example.com/asset">CDN</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an internal route", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/about">About</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a download anchor", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/files/report.pdf" download>PDF</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a target=_blank new-tab anchor", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/external" target="_blank">New</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('stays silent on a target={"_blank"} expression-container anchor', () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/external" target={"_blank"}>New</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a target=_self internal route", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/about" target="_self">About</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags download={false}, which renders no download attribute", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/about" download={false}>About</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('stays silent on a named download anchor (download="report.pdf")', () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href="/files/report" download="report.pdf">PDF</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a dynamic download value (abstain)", () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C({ isDownload }) { return <a href="/about" download={isDownload}>About</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags an internal route href={"/"} in an expression container', () => {
    const result = runRule(
      nextjsNoAElement,
      `export default function C() { return <a href={"/"}>Home</a>; }`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
