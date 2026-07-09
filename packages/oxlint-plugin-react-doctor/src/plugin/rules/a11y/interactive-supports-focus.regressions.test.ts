import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { interactiveSupportsFocus } from "./interactive-supports-focus.js";

describe("a11y/interactive-supports-focus regressions", () => {
  it("exempts an interactive element whose tabIndex may arrive via a spread", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = (p) => <div role="button" onClick={p.onPress} {...p.focusProps} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a literal interactive element lacking tabIndex", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = (p) => <div role="button" onClick={p.onPress} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("exempts a role=toolbar container whose onKeyDown handles bubbled arrows", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const Legend = ({ handleKeyDown }) => (
        <div role="toolbar" aria-label="legend" onKeyDown={handleKeyDown}>
          {items}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts a role=listbox container with pointer-leave bookkeeping", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const Month = ({ handleMouseLeave }) => (
        <div role="listbox" onMouseLeave={handleMouseLeave} onPointerLeave={handleMouseLeave}>
          {options}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts a role=menu container with a click-outside guard", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const Picker = () => (
        <div role="menu" onClick={(e) => e.stopPropagation()}>
          {content}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("exempts an aria-activedescendant option carrying an explicit id", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const Route = ({ baseId, index, choose, setFlyoutHighlight, isCurrent }) => (
        <div
          role="option"
          id={baseId + "-fly-" + index}
          aria-selected={isCurrent}
          onMouseEnter={() => setFlyoutHighlight(index)}
          onClick={choose}
        >
          {label}
        </div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a role=option without an id or tabIndex", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ select }) => <div role="option" onClick={select}>{label}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a ternary role whose branches are both interactive and unfocusable", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ navigates, go }) => (
        <div role={navigates ? "link" : "button"} onClick={go}>{label}</div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a const-bound interactive role lacking tabIndex", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const clickableRole = "button";
const X = ({ go }) => <div role={clickableRole} onClick={go}>{label}</div>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a ternary role with a non-interactive branch", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ active, go }) => (
        <div role={active ? "button" : "presentation"} onClick={go}>{label}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a ternary role with a composite-container branch", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ isMenu, handle }) => (
        <div role={isMenu ? "menu" : "button"} onKeyDown={handle}>{items}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role resolved from a parameter", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ widgetRole, go }) => <div role={widgetRole} onClick={go}>{label}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });
});
