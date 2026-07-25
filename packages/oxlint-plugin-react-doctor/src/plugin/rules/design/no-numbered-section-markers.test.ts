import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noNumberedSectionMarkers } from "./no-numbered-section-markers.js";

describe("no-numbered-section-markers", () => {
  it("flags two distinct tiny styled labels beside headings", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><span className="text-xs font-mono text-amber-700">01</span><h2>Principles</h2></section>
        <section><span className="text-xs font-semibold tracking-wider">02</span><h2>Process</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("supports compound indices and a heading-leading wrapper", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section>
          <span style={{ fontSize: 11, fontFamily: "monospace" }}>04 / ROLLOUT</span>
          <header><h2>Ship deliberately</h2><p>Supporting copy</p></header>
        </section>
        <section>
          <span style={{ fontSize: "0.75rem", letterSpacing: "0.08em" }}>8 · OPERATE</span>
          <div><h3>Learn continuously</h3><p>Supporting copy</p></div>
        </section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("resolves const-bound inline label styles", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const labelStyle = { fontFamily: "monospace" };
      const Page = () => <main>
        <section><span className="text-xs" style={labelStyle}>01</span><h2>Principles</h2></section>
        <section><span className="text-xs" style={labelStyle}>02</span><h2>Process</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not require consecutive indices", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><span className="text-xs font-mono">02</span><h2>Explore</h2></section>
        <section><span className="text-xs font-mono">09</span><h2>Refine</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an isolated numbered label or repeated identical index", () => {
    const isolatedResult = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <section>
        <span className="text-xs font-mono">01</span><h2>One moment</h2>
      </section>;`,
    );
    const repeatedResult = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><span className="text-xs font-mono">07</span><h2>Variant A</h2></section>
        <section><span className="text-xs font-mono">07</span><h2>Variant B</h2></section>
      </main>;`,
    );
    expect(isolatedResult.diagnostics).toHaveLength(0);
    expect(repeatedResult.diagnostics).toHaveLength(0);
  });

  it("does not combine isolated markers from separate component roots", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const AboutPage = () => <section>
        <span className="text-xs font-mono">01</span><h2>Our story</h2>
      </section>;
      const CareersPage = () => <section>
        <span className="text-xs font-mono">02</span><h2>Join the team</h2>
      </section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not aggregate markers from conditional or logical JSX branches", () => {
    const conditionalResult = runRule(
      noNumberedSectionMarkers,
      `const Page = ({ showFirst }) => <main>
        {showFirst
          ? <section><span className="text-xs font-mono">01</span><h2>First option</h2></section>
          : <section><span className="text-xs font-mono">02</span><h2>Second option</h2></section>}
      </main>;`,
    );
    const logicalResult = runRule(
      noNumberedSectionMarkers,
      `const Page = ({ showFirst, showSecond }) => <main>
        {showFirst && <section><span className="text-xs font-mono">01</span><h2>First option</h2></section>}
        {showSecond && <section><span className="text-xs font-mono">02</span><h2>Second option</h2></section>}
      </main>;`,
    );
    expect(conditionalResult.diagnostics).toHaveLength(0);
    expect(logicalResult.diagnostics).toHaveLength(0);
  });

  it("does not count hidden markers, headings, or ancestors", () => {
    const hiddenPairs = [
      `<section><span hidden className="text-xs font-mono">02</span><h2>Hidden marker</h2></section>`,
      `<section><span aria-hidden="true" className="text-xs font-mono">02</span><h2>Hidden marker</h2></section>`,
      `<section><span className="hidden text-xs font-mono">02</span><h2>Hidden marker</h2></section>`,
      `<section><span className="text-xs font-mono">02</span><h2 hidden>Hidden heading</h2></section>`,
      `<section><span className="text-xs font-mono">02</span><h2 style={{ display: "none" }}>Hidden heading</h2></section>`,
      `<section style={{ visibility: "hidden" }}><span className="text-xs font-mono">02</span><h2>Hidden ancestor</h2></section>`,
      `<div className="invisible"><section><span className="text-xs font-mono">02</span><h2>Hidden ancestor</h2></section></div>`,
    ];
    for (const hiddenPair of hiddenPairs) {
      const result = runRule(
        noNumberedSectionMarkers,
        `const Page = () => <main>
          <section><span className="text-xs font-mono">01</span><h2>Visible marker</h2></section>
          ${hiddenPair}
        </main>;`,
      );
      expect(result.diagnostics, hiddenPair).toHaveLength(0);
    }
  });

  it("rejects markers with unresolved rendering state", () => {
    const unresolvedPairs = [
      `<section><span hidden={isHidden} className="text-xs font-mono">02</span><h2>Unknown marker</h2></section>`,
      `<section><span className="text-xs font-mono">02</span><h2 aria-hidden={isHidden}>Unknown heading</h2></section>`,
      `<section style={sectionStyle}><span className="text-xs font-mono">02</span><h2>Unknown ancestor</h2></section>`,
      `<section><span className="text-xs font-mono">02</span><h2 className="hover:hidden">Unknown heading</h2></section>`,
    ];
    for (const unresolvedPair of unresolvedPairs) {
      const result = runRule(
        noNumberedSectionMarkers,
        `const Page = ({ isHidden, sectionStyle }) => <main>
          <section><span className="text-xs font-mono">01</span><h2>Visible marker</h2></section>
          ${unresolvedPair}
        </main>;`,
      );
      expect(result.diagnostics, unresolvedPair).toHaveLength(0);
    }
  });

  it("rejects unknown ordered semantics on ancestors", () => {
    const uncertainPairs = [
      `<section {...sectionProps}><span className="text-xs font-mono">02</span><h2>Unknown spread</h2></section>`,
      `<section role={sectionRole}><span className="text-xs font-mono">02</span><h2>Unknown role</h2></section>`,
      `<section aria-label={sectionLabel}><span className="text-xs font-mono">02</span><h2>Unknown label</h2></section>`,
      `<section className={sectionClassName}><span className="text-xs font-mono">02</span><h2>Unknown class</h2></section>`,
      `<section dateTime={sectionDate}><span className="text-xs font-mono">02</span><h2>Unknown date</h2></section>`,
    ];
    for (const uncertainPair of uncertainPairs) {
      const result = runRule(
        noNumberedSectionMarkers,
        `const Page = ({ sectionProps, sectionRole, sectionLabel, sectionClassName, sectionDate }) => <main>
          <section><span className="text-xs font-mono">01</span><h2>Visible marker</h2></section>
          ${uncertainPair}
        </main>;`,
      );
      expect(result.diagnostics, uncertainPair).toHaveLength(0);
    }
  });

  it("accepts unstyled numbers and display-scale indices", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><span>01</span><h2>Plain number</h2></section>
        <section><span className="text-xs">02</span><h2>Small but untreated</h2></section>
        <section><span className="text-base font-mono">03</span><h2>Display number</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts dynamic labels, classes, and headings", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = ({ index, labelClass, heading }) => <main>
        <section><span className="text-xs font-mono">{index}</span><h2>Static heading</h2></section>
        <section><span className={labelClass}>02</span><h2>Another heading</h2></section>
        <section><span className="text-xs font-mono">03</span><h2>{heading}</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts ordered steps, lists, progress, navigation, and card items", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <ol>
          <li><span className="text-xs font-mono">01</span><h3>Install</h3></li>
          <li><span className="text-xs font-mono">02</span><h3>Configure</h3></li>
        </ol>
        <div className="stepper">
          <section><span className="text-xs font-bold">03</span><h2>Connect</h2></section>
          <section><span className="text-xs font-bold">04</span><h2>Verify</h2></section>
        </div>
        <div role="progressbar">
          <span className="text-xs tracking-wider">05</span><h2>Uploading</h2>
          <span className="text-xs tracking-wider">06</span><h2>Processing</h2>
        </div>
        <nav aria-label="Progress">
          <span className="text-xs font-mono">07</span><h2>Account</h2>
          <span className="text-xs font-mono">08</span><h2>Billing</h2>
        </nav>
        <article className="card">
          <span className="text-xs font-mono">09</span><h2>First card</h2>
        </article>
        <article className="card">
          <span className="text-xs font-mono">10</span><h2>Second card</h2>
        </article>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts explicitly named step headings and custom progress components", () => {
    const headingResult = runRule(
      noNumberedSectionMarkers,
      `const Guide = () => <main>
        <section><span className="text-xs font-mono">01</span><h2>Step one</h2></section>
        <section><span className="text-xs font-mono">02</span><h2>Phase two</h2></section>
      </main>;`,
    );
    const componentResult = runRule(
      noNumberedSectionMarkers,
      `const Guide = () => <OnboardingStepper>
        <section><span className="text-xs font-mono">01</span><h2>Install</h2></section>
        <section><span className="text-xs font-mono">02</span><h2>Configure</h2></section>
      </OnboardingStepper>;`,
    );
    expect(headingResult.diagnostics).toHaveLength(0);
    expect(componentResult.diagnostics).toHaveLength(0);
  });

  it("accepts dates and prose-like numeric metadata", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><time dateTime="2026-04-01" className="text-xs font-mono">01</time><h2>April update</h2></section>
        <section><span className="text-xs font-mono">02 / 2026</span><h2>February update</h2></section>
        <section><span className="text-xs font-mono">03 · March</span><h2>March update</h2></section>
        <section><span className="text-xs font-mono">12 minute read</span><h2>Research note</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts bare day numbers beside date headings", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Events = () => <main>
        <section><span className="text-xs font-mono">01</span><h2>April update</h2></section>
        <section><span className="text-xs font-mono">02</span><h2>Tuesday briefing</h2></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts labels that are not immediately paired with a heading", () => {
    const result = runRule(
      noNumberedSectionMarkers,
      `const Page = () => <main>
        <section><span className="text-xs font-mono">01</span><p>Introduction</p><h2>First</h2></section>
        <section><span className="text-xs font-mono">02</span><div><p>Preface</p><h2>Second</h2></div></section>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
