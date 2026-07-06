import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noStaticElementInteractions } from "./no-static-element-interactions.js";

describe("a11y/no-static-element-interactions regressions", () => {
  it("does not flag a string-literal role wrapped in a JSX expression container", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div role={'link'} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a wrapped string-literal role that is not interactive", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div role={'wat'} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an svg with a click handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <svg width="10" height="10" onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a div with a click handler and no role", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a conditional role where both branches are valid roles", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Option = ({ menu, onClick, onKeyDown }) => (
        <div role={menu ? 'menuitemcheckbox' : 'option'} tabIndex={0} onClick={onClick} onKeyDown={onKeyDown} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role present exactly when the element is clickable", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Row = ({ isClickable, onClick }) => (
        <div role={isClickable ? 'button' : undefined} tabIndex={isClickable ? 0 : undefined} onClick={onClick} />
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a role computed at runtime", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ computedRole, onClick }) => <div role={computedRole} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags role={undefined}", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onClick }) => <div role={undefined} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a conditional role where no branch is a recognized role", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ wat, onClick }) => <div role={wat ? 'wat' : undefined} onClick={onClick} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a keyboard-delegation wrapper that can't take focus", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Palette = ({ handleKeyDown, children }) => (
        <div onKeyDown={handleKeyDown}>{children}</div>
      );`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a focusable div with only a keyboard handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const A = ({ onKeyDown }) => <div tabIndex={0} onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a programmatically focusable editor with only a keyboard handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Editor = ({ onKeyDown }) => <div tabIndex={-1} onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a contentEditable div with only a keyboard handler", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Title = ({ onKeyDown }) => <div contentEditable onKeyDown={onKeyDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a mouse-only drag grip", () => {
    const result = runRule(
      noStaticElementInteractions,
      `export const Grip = ({ onMouseDown }) => <span onMouseDown={onMouseDown} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
