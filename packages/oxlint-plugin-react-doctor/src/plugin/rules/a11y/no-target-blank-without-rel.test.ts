import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noTargetBlankWithoutRel } from "./no-target-blank-without-rel.js";

describe("no-target-blank-without-rel", () => {
  it('flags `<a target="_blank">` with no rel', () => {
    const code = `const A = () => <a href="/x" target="_blank">Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags `target={'_blank'}` (literal in expression)", () => {
    const code = `const A = () => <a href="/x" target={'_blank'}>Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `target="_blank"` with a rel missing noopener/noreferrer', () => {
    const code = `const A = () => <a href="/x" target="_blank" rel="nofollow">Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('does NOT flag with rel="noopener"', () => {
    const code = `const A = () => <a href="/x" target="_blank" rel="noopener noreferrer">Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does NOT flag with rel="noreferrer" alone', () => {
    const code = `const A = () => <a href="/x" target="_blank" rel="noreferrer">Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag same-tab links", () => {
    const code = `const A = () => <a href="/x">Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does NOT flag `target="_self"`', () => {
    const code = `const A = () => <a href="/x" target="_self">Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag dynamic rel", () => {
    const code = `const A = ({ rel }) => <a href="/x" target="_blank" rel={rel}>Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag when a spread could supply rel", () => {
    const code = `const A = (props) => <a href="/x" target="_blank" {...props}>Docs</a>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('does NOT flag a custom `<Link target="_blank">` component', () => {
    const code = `const A = () => <Link href="/x" target="_blank">Docs</Link>;`;
    const result = runRule(noTargetBlankWithoutRel, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
