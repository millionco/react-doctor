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
});
