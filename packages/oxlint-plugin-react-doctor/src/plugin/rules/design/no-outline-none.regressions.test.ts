import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noOutlineNone } from "./no-outline-none.js";

const run = (code: string) => runRule(noOutlineNone, code, { filename: "fixture.tsx" });

describe("design/no-outline-none — regressions", () => {
  it("uses the effective duplicate inline outline declaration", () => {
    const result = run(
      `<><button style={{ outline: "none", outline: "2px solid red" }}>Safe</button><button style={{ outline: "2px solid red", outline: "none" }}>Unsafe</button></>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag outline:none paired with a tailwind focus-visible ring", () => {
    const result = run(
      `<button style={{ outline: "none" }} className="focus-visible:ring-2 focus-visible:ring-blue-500" />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags outline:none with no replacement focus indicator", () => {
    const result = run(`<button style={{ outline: "none" }} />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // Bugbot: `focus:outline-none` / `focus:shadow-none` REMOVE focus styling —
  // they must not be read as a replacement focus ring.
  it("still flags outline:none when the className only removes focus styling", () => {
    const outlineNone = run(
      `<button style={{ outline: "none" }} className="focus:outline-none" />`,
    );
    expect(outlineNone.diagnostics.length).toBeGreaterThan(0);
    const shadowNone = run(`<button style={{ outline: "none" }} className="focus:shadow-none" />`);
    expect(shadowNone.diagnostics.length).toBeGreaterThan(0);
    const ringZero = run(`<button style={{ outline: "none" }} className="focus:ring-0" />`);
    expect(ringZero.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag outline:none paired with a shadow-based focus ring", () => {
    const result = run(`<button style={{ outline: "none" }} className="focus:shadow-outline" />`);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags the all-removal combo focus:outline-none focus:ring-0 focus:ring-offset-0", () => {
    const result = run(
      `<button style={{ outline: "none" }} className="focus:outline-none focus:ring-0 focus:ring-offset-0" />`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags focus:ring-offset-0 alone (an offset knob adds no ring)", () => {
    const result = run(`<button style={{ outline: "none" }} className="focus:ring-offset-0" />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags the tailwind v4 removal utility focus:outline-hidden", () => {
    const result = run(`<button style={{ outline: "none" }} className="focus:outline-hidden" />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags focus:ring-transparent (an invisible ring)", () => {
    const result = run(`<button style={{ outline: "none" }} className="focus:ring-transparent" />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("honors important focus ring resets independently of class order", () => {
    const first = run(
      `<button style={{ outline: "none" }} className="focus:ring-2 focus:!ring-0" />`,
    );
    const second = run(
      `<button style={{ outline: "none" }} className="focus:!ring-0 focus:ring-2" />`,
    );
    expect(first.diagnostics).toHaveLength(1);
    expect(second.diagnostics).toHaveLength(1);
  });

  it("honors important focus ring additions independently of class order", () => {
    const first = run(
      `<button style={{ outline: "none" }} className="focus:ring-0 focus:!ring-2" />`,
    );
    const second = run(
      `<button style={{ outline: "none" }} className="focus:!ring-2 focus:ring-0" />`,
    );
    expect(first.diagnostics).toEqual([]);
    expect(second.diagnostics).toEqual([]);
  });

  it("does not accept equal-priority or important focus ring conflicts", () => {
    const equalPriority = run(
      `<button style={{ outline: "none" }} className="focus:ring-2 focus:ring-0" />`,
    );
    const important = run(
      `<button style={{ outline: "none" }} className="focus:!ring-2 focus:!ring-0" />`,
    );
    expect(equalPriority.diagnostics).toHaveLength(1);
    expect(important.diagnostics).toHaveLength(1);
  });

  it("accepts multiple focus utilities that all add a visible style", () => {
    const result = run(
      `<button style={{ outline: "none" }} className="focus:ring-2 focus:ring-4 focus:ring-blue-500" />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("accepts a visible ring when another focus style family is reset", () => {
    const result = run(
      `<button style={{ outline: "none" }} className="focus:outline-none focus:ring-2" />`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("flags group-focus:ring-2 (styles the group's focus, not this element's)", () => {
    const result = run(`<button style={{ outline: "none" }} className="group-focus:ring-2" />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a stacked-variant own-focus ring like dark:focus:ring-2", () => {
    const result = run(`<button style={{ outline: "none" }} className="dark:focus:ring-2" />`);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a conditional tabIndex that is focusable in one branch", () => {
    const result = run(
      `const T = ({ open }) => <div tabIndex={open ? -1 : 0} style={{ outline: "none" }} />;`,
    );
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("does not flag a conditional tabIndex that is negative in both branches", () => {
    const result = run(
      `const T = ({ open }) => <div tabIndex={open ? -1 : -2} style={{ outline: "none" }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag outline:none on an aria-modal dialog surface", () => {
    const result = run(
      `const Content = ({ role, ariaModal, isOpen }) => (
        <div role={role} aria-modal={ariaModal} style={{ outline: 'none' }} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag outline:none when the component renders a FocusManager", () => {
    const result = run(
      `const PopoverContent = ({ isOpen, children }) => {
        const content = <div style={{ outline: 'none' }}>{children}</div>;
        if (isOpen) {
          return <Floater.FocusManager modal>{content}</Floater.FocusManager>;
        }
        return content;
      };`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag outline:none with own onFocus/onBlur indicator handlers", () => {
    const result = run(
      `const LegendItem = ({ showRing, hideRing }) => (
        <g tabIndex={0} onFocus={showRing} onBlur={hideRing} style={{ outline: 'none' }} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag outline:0 on a SkipNav content target", () => {
    const result = run(
      `const App = () => <SkipNavContent style={{ display: 'flex', outline: 0 }} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags outline:none on a plain button with only onFocus", () => {
    const result = run(`<button onFocus={track} style={{ outline: "none" }} />`);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
