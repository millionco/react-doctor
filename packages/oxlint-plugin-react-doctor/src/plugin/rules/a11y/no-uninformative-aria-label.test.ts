import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUninformativeAriaLabel } from "./no-uninformative-aria-label.js";

describe("no-uninformative-aria-label", () => {
  it('flags `aria-label="icon"`', () => {
    const code = `const A = () => <button aria-label="icon"><Svg /></button>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `aria-label="button"` (case-insensitive, trimmed)', () => {
    const code = `const A = () => <button aria-label="  Button "><X /></button>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('flags `aria-label="image"` on an svg', () => {
    const code = `const A = () => <svg aria-label="image" />;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a descriptive action label", () => {
    const code = `const A = () => <button aria-label="Search"><Svg /></button>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a descriptive destination label", () => {
    const code = `const A = () => <a aria-label="Close dialog" href="#">x</a>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts Link as the action name of an editor control", () => {
    const result = runRule(
      noUninformativeAriaLabel,
      `const Toolbar = () => <Button aria-label="Link" variant="icon"><LinkIcon /></Button>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a multi-word label containing a type word", () => {
    const code = `const A = () => <button aria-label="Download icon set" />;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a braced string literal `aria-label={'icon'}`", () => {
    const code = `const A = () => <button aria-label={'icon'}><Svg /></button>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does NOT flag a braced descriptive label `aria-label={'Search'}`", () => {
    const code = `const A = () => <button aria-label={'Search'}><Svg /></button>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag a dynamic aria-label", () => {
    const code = `const A = ({ label }) => <button aria-label={label} />;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does NOT flag elements without aria-label", () => {
    const code = `const A = () => <button>Save</button>;`;
    const result = runRule(noUninformativeAriaLabel, code);
    expect(result.diagnostics).toHaveLength(0);
  });
});
