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

  it("flags a nested ternary whose branches are all interactive and unfocusable", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ a, b, go }) => (
        <div role={a ? "button" : b ? "link" : "switch"} onClick={go}>{label}</div>
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a role bound via a destructuring default (source may override)", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const { role = "button" } = config;
const X = ({ go }) => <div role={role} onClick={go}>{label}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a space-separated fallback role list (conservative bail)", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const X = ({ go }) => <div role="button link" onClick={go}>{label}</div>;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag the Datastoria conditional editing host", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const ChatInput = ({ isRunning, handleInput, handleKeyDown }) => (
        <div
          role="textbox"
          aria-multiline="true"
          contentEditable={!isRunning}
          suppressContentEditableWarning
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a statically enabled editing host", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const Editor = ({ handleKeyDown }) => (
        <div role="textbox" contentEditable="plaintext-only" onKeyDown={handleKeyDown} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a statically disabled editing host", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const Editor = ({ handleKeyDown }) => (
        <div role="textbox" contentEditable={false} onKeyDown={handleKeyDown} />
      );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("handles static editing-host value variants", () => {
    const validSources = [
      `<div role="textbox" contentEditable onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable="TRUE" onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable={true} onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable={enabled ? true : false} onKeyDown={handleKeyDown} />`,
      `const editable = true; <div role="textbox" contentEditable={editable} onKeyDown={handleKeyDown} />`,
    ];
    for (const source of validSources) {
      expect(runRule(interactiveSupportsFocus, source).diagnostics).toEqual([]);
    }

    const invalidSources = [
      `<div role="textbox" contentEditable="false" onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable={false} onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable="inherit" onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable="invalid" onKeyDown={handleKeyDown} />`,
      `const editable = false; <div role="textbox" contentEditable={editable} onKeyDown={handleKeyDown} />`,
      `<div role="textbox" contentEditable={enabled ? false : false} onKeyDown={handleKeyDown} />`,
      `const editable = false; <div role="textbox" contentEditable={condition ? editable : editable} onKeyDown={handleKeyDown} />`,
    ];
    for (const source of invalidSources) {
      expect(runRule(interactiveSupportsFocus, source).diagnostics).toHaveLength(1);
    }
  });

  it("still flags a nested editing host without an explicit tabIndex", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `<div contentEditable>
        <div role="textbox" contentEditable onKeyDown={handleKeyDown} />
      </div>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a nested editing host under a const-enabled ancestor", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `const outerEditable = true;
      <div contentEditable={outerEditable}>
        <div role="textbox" contentEditable onKeyDown={handleKeyDown} />
      </div>`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not assume a dynamic editing ancestor is always enabled", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `<div contentEditable={outerEnabled}>
        <div role="textbox" contentEditable onKeyDown={handleKeyDown} />
      </div>`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not look past uncertain or disabled editing-host boundaries", () => {
    const sources = [
      `<div contentEditable>
        <div contentEditable={false}>
          <div role="textbox" contentEditable onKeyDown={handleKeyDown} />
        </div>
      </div>`,
      `<div contentEditable>
        <div contentEditable={innerEnabled}>
          <div role="textbox" contentEditable onKeyDown={handleKeyDown} />
        </div>
      </div>`,
      `<div contentEditable>
        <Wrapper>
          <div role="textbox" contentEditable onKeyDown={handleKeyDown} />
        </Wrapper>
      </div>`,
    ];
    for (const source of sources) {
      expect(runRule(interactiveSupportsFocus, source).diagnostics).toEqual([]);
    }
  });
});
