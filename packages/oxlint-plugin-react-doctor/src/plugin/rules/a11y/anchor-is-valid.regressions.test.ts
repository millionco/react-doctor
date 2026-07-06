import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { anchorIsValid } from "./anchor-is-valid.js";

describe("a11y/anchor-is-valid regressions", () => {
  it("does not flag an href-less anchor inside a Next.js `<Link legacyBehavior>`", () => {
    const source = `
      import Link from "next/link";
      const Nav = ({ href }) => (
        <Link href={href} legacyBehavior>
          <a className="nav-link">Home</a>
        </Link>
      );
    `;
    const result = runRule(anchorIsValid, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an href-less anchor inside a namespaced `<Next.Link>`", () => {
    const source = `const Nav = () => <Next.Link href="/login" legacyBehavior><a>Log in</a></Next.Link>;`;
    const result = runRule(anchorIsValid, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an href-less anchor inside a non-Link wrapper", () => {
    const source = `const Nav = () => <nav><a onClick={go}>Home</a></nav>;`;
    const result = runRule(anchorIsValid, source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an href-less anchor acting as a keyboard-operable widget", () => {
    const source = `
      const Toggle = ({ checked, onToggle }) => (
        <a role="switch" aria-checked={checked} tabIndex={0} onClick={onToggle} onKeyDown={handleKey}>
          Toggle
        </a>
      );
    `;
    const result = runRule(anchorIsValid, source);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an href-less anchor with a role but no keyboard support", () => {
    const source = `const B = () => <a role="button" onClick={go}>Go</a>;`;
    const result = runRule(anchorIsValid, source);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag fixture anchors in testlike files", () => {
    const result = runRule(anchorIsValid, `const Fixture = () => <a href="#">dummy button</a>;`, {
      filename: "src/components/tab-loop.test.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it('still flags `href="#"` with onClick in production files', () => {
    const result = runRule(anchorIsValid, `const B = () => <a href="#" onClick={go}>Go</a>;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
