import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferTagOverRole } from "./prefer-tag-over-role.js";

describe("a11y/prefer-tag-over-role regressions", () => {
  it('does not suggest a tag for `<div role="group">` (would map to the nonsensical <address>)', () => {
    const result = runRule(preferTagOverRole, `const Group = () => <div role="group" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest a tag for `<div role="region">` (<section> only when named)', () => {
    const result = runRule(preferTagOverRole, `const Region = () => <div role="region" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <option> for `<div role="option">` (native option needs a <select> parent, text-only)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Opt = () => <div role="option">{label}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <img> for `<span role="img">` (img is a void element; cannot wrap children)', () => {
    const result = runRule(
      preferTagOverRole,
      `const Icon = () => <span role="img" aria-label="busy"><Spinner /></span>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <dialog> for `<div role="dialog">` (top-layer/showModal semantics)', () => {
    const result = runRule(preferTagOverRole, `const D = () => <div role="dialog" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it('does not suggest <output> for `<div role="status">` (output is form-result-specific)', () => {
    const result = runRule(preferTagOverRole, `const S = () => <div role="status" />;`);
    expect(result.diagnostics).toEqual([]);
  });

  it("still suggests a tag for a role with a clean native equivalent", () => {
    const result = runRule(preferTagOverRole, `const Nav = () => <div role="navigation" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it('still suggests <button> for `<div role="button">` (the canonical safe replacement)', () => {
    const result = runRule(preferTagOverRole, `const B = () => <div role="button" />;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
