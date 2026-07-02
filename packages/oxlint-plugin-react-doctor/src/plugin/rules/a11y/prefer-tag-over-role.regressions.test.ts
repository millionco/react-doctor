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

  it('suggests <ul> (not <menu>) for `<div role="list">`', () => {
    const result = runRule(preferTagOverRole, `const L = () => <div role="list" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<ul>`");
    expect(result.diagnostics[0].message).not.toContain("`<menu>`");
  });

  it('does not suggest <hr> for a window-splitter `<div role="separator">` (focusable/valued)', () => {
    const result = runRule(
      preferTagOverRole,
      `const S = () => <div role="separator" tabIndex={0} aria-valuenow={50} aria-valuemin={0} aria-valuemax={100} aria-orientation="vertical" />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('still suggests <hr> for a decorative `<div role="separator">`', () => {
    const result = runRule(preferTagOverRole, `const S = () => <div role="separator" />;`);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("`<hr>`");
  });
});
