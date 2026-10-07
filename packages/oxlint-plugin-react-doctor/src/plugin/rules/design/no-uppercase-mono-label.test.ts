import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUppercaseMonoLabel } from "./no-uppercase-mono-label.js";

describe("no-uppercase-mono-label", () => {
  it("flags a short uppercase monospace eyebrow", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Hero = () => <><span className="font-mono text-xs uppercase tracking-widest">System online</span><span className="font-mono text-xs uppercase tracking-widest">LATEST NEWS</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts code content, untracked type badges, and ordinary monospace values", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Metadata = () => <><code className="font-mono uppercase tracking-widest">GET</code><span className="font-mono uppercase">ARRAY</span><span className="font-mono">a8f92c</span><span className="uppercase">Status</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts technical terminal labels", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Terminal = () => <>
        <span className="font-mono uppercase tracking-widest">BASH — ERROR_LOG</span>
        <span className="font-mono uppercase tracking-widest">bash — readme-generator</span>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when font family, casing, or tracking utilities conflict", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Labels = () => <><span className="font-mono font-sans uppercase tracking-wide">System online</span><span className="font-mono uppercase normal-case tracking-wide">System online</span><span className="font-mono uppercase tracking-wide tracking-normal">System online</span><span className="font-sans font-mono normal-case uppercase tracking-normal tracking-wide">System online</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet when important utilities conflict", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Labels = () => <><span className="!font-mono !font-sans uppercase tracking-wide">System online</span><span className="font-mono !uppercase !normal-case tracking-wide">System online</span><span className="font-mono uppercase !tracking-wide !tracking-normal">System online</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors important font family, casing, and tracking precedence", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Labels = () => <>
        <span className="!font-sans font-mono uppercase tracking-wide">System online</span>
        <span className="font-sans !font-mono font-sans uppercase tracking-wide">System online</span>
        <span className="font-mono !normal-case uppercase tracking-wide">System online</span>
        <span className="font-mono normal-case !uppercase normal-case tracking-wide">System online</span>
        <span className="font-mono uppercase !tracking-normal tracking-wide">System online</span>
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("ignores zero arbitrary tracking", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Label = () => <span className="font-mono uppercase tracking-wide tracking-[0rem]">System online</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores spread-overridable rendered styles", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Labels = ({ props }) => <><span {...props} className="font-mono uppercase tracking-wide">System online</span><span className="font-mono uppercase tracking-wide" {...props}>System online</span></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores opaque custom label components", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Label = () => <Text className="font-mono uppercase tracking-wide">System online</Text>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores inline styles that can override the visual claim", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Label = () => <span className="font-mono uppercase tracking-wide" style={{ fontFamily: "sans-serif" }}>System online</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores dynamic identifiers without static label text", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Identifier = ({ value }) => <span className="font-mono uppercase tracking-widest">{value}</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores partially static labels containing a dynamic identifier", () => {
    const result = runRule(
      noUppercaseMonoLabel,
      `const Identifier = ({ value }) => <span className="font-mono uppercase tracking-widest">ID: {value}</span>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
