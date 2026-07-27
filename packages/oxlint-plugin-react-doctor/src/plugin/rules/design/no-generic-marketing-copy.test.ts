import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noGenericMarketingCopy } from "./no-generic-marketing-copy.js";

describe("no-generic-marketing-copy", () => {
  it.each([
    "Streamline your reviews",
    "Empower your team",
    "Supercharge your release process",
    "Unleash your creativity",
    "Unleash the power of automation",
    "Leverage the power of diagnostics",
    "Harness the power of static analysis",
    "Built for the modern engineering team",
    "Trusted by leading developers",
    "Trusted by the world",
    "Best-in-class diagnostics",
    "Industry-leading analysis",
    "Enterprise-grade reporting",
    "Best of breed tooling",
    "A game-changer for CI",
    "Game changing insights",
    "Seamlessly integrate with CI",
    "Drive engagement across teams",
    "Drive growth with better tooling",
    "Drive results on every pull request",
  ])("flags the bounded marketing phrase in %s", (copy) => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><p>${copy}</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a generic promise in page copy", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><h1>Supercharge your workflow</h1><p>Move faster.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a nested article only through its page root", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><article><p>Build a future-proof platform.</p></article></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports one diagnostic using the first matching phrase in the rendered copy", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><p>Drive growth with evidence.</p><p>Industry-leading analysis.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("drive growth");
  });

  it("accepts concrete product copy", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><h1>Review React diagnostics before merge</h1><p>Scan changed files locally or in CI.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not judge an isolated component label", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Badge = () => <span>Next-generation</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps intentionally unbounded words quiet", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><p>Revolutionize incident response for mission-critical systems.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("requires lexical boundaries around a phrase", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main>
        <p>best-in-classical architecture</p>
        <p>enterprise-grades are documented</p>
        <p>supercharge yourself before the release</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips an invalid substring and reports the first later bounded phrase", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main>
        <p>best-in-classical architecture</p>
        <p>Drive results with measured diagnostics.</p>
        <p>Enterprise-grade reporting.</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("drive results");
  });

  it("accepts lexical punctuation around a phrase", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main><p>(Enterprise-grade) reporting.</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores phrases in code, Markdown, and render-proxy descendants", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main>
        <code>streamline your workflow</code>
        <pre>drive growth</pre>
        <Markdown>industry-leading tools</Markdown>
        <ReactMarkdown>enterprise-grade software</ReactMarkdown>
        <RenderProxy>best-in-class analytics</RenderProxy>
        <Preview>unleash your creativity</Preview>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores a page root inside Markdown and render proxies", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Examples = () => <>
        <Markdown><main>Drive engagement</main></Markdown>
        <RenderProxy><article>Harness the power of data</article></RenderProxy>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores phrases in statically non-rendered descendants", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main>
        <p hidden>streamline your workflow</p>
        <p aria-hidden="true">drive growth</p>
        <p className="hidden">industry-leading tools</p>
        <p style={{ display: "none" }}>enterprise-grade software</p>
        <p style={{ visibility: "hidden" }}>best-in-class analytics</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors hidden styles that override earlier computed properties", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = ({ styleProperty }) => <main>
        <p style={{ [styleProperty]: "block", display: "none" }}>Enterprise-grade software</p>
        <p style={{ [styleProperty]: "visible", visibility: "hidden" }}>Best-in-class analytics</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps dynamic page copy quiet", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = ({ headline, copy }) => <main><h1>{headline}</h1><p>{copy}</p></main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not fabricate phrases across dynamic template interpolations", () => {
    const result = runRule(
      noGenericMarketingCopy,
      "const Page = ({ metric }) => <main><p>{`Drive ${metric}growth`}</p></main>;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not fabricate phrases around unresolved JSX expressions", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = ({ format, middle, value }) => <main>
        <p>Drive{middle}growth</p>
        <p>Enterprise-{format()}grade</p>
        <p>Best-in-{value.category}class</p>
        <p>Supercharge {value.owner}your workflow</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps statically empty JSX expressions neutral", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = () => <main>
        <p>Drive {/* formatting */}growth</p>
        <p>{null}{false}{true}{""}</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("drive growth");
  });

  it("does not fabricate phrases across conditional or logical branches", () => {
    const result = runRule(
      noGenericMarketingCopy,
      `const Page = ({ isDriving, showDrive, showGrowth }) => <main>
        <p>{isDriving ? "drive" : "growth"}</p>
        <p>{showDrive && "drive"} {showGrowth && "growth"}</p>
      </main>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still reports a complete phrase inside one static branch or template segment", () => {
    const result = runRule(
      noGenericMarketingCopy,
      'const Page = ({ count, isDriving }) => <main><p>{isDriving ? "Drive growth with evidence" : "Review diagnostics"}</p><p>{`Scanned ${count}: enterprise-grade reporting`}</p></main>;',
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("drive growth");
  });
});
