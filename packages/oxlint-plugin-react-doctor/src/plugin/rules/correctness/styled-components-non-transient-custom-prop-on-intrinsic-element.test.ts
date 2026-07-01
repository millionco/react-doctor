import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { styledComponentsNonTransientCustomPropOnIntrinsicElement } from "./styled-components-non-transient-custom-prop-on-intrinsic-element.js";

const rule = styledComponentsNonTransientCustomPropOnIntrinsicElement;

describe("styled-components-non-transient-custom-prop-on-intrinsic-element", () => {
  it("flags a custom boolean prop on styled.div", () => {
    const result = runRule(rule, "const D = styled.div<{ selected: boolean }>`color: red;`;");
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an invented prop on styled.button", () => {
    const result = runRule(rule, "const B = styled.button<{ active: boolean }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags backgroundImage on styled.div", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ backgroundImage: string }>`background: none;`;",
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags multiple invented props", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ isTarget: boolean; showActions: boolean; grabbing: boolean }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("does not flag transient $-prefixed props", () => {
    const result = runRule(rule, "const D = styled.div<{ $active: boolean }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag styled(Component) wrapping a component", () => {
    const result = runRule(rule, "const D = styled(Base)<{ active: boolean }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag props stripped through .attrs()", () => {
    const result = runRule(
      rule,
      "const D = styled.div.attrs({})<{ active: boolean }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag valid element-specific attributes on their tag", () => {
    const cases = [
      "const I = styled.input<{ value: string }>`color: red;`;",
      "const I = styled.input<{ checked: boolean }>`color: red;`;",
      "const M = styled.img<{ loading: string }>`color: red;`;",
      "const T = styled.details<{ open: boolean }>`color: red;`;",
      "const S = styled.select<{ multiple: boolean }>`color: red;`;",
      "const X = styled.textarea<{ rows: number }>`color: red;`;",
    ];
    for (const code of cases) {
      const result = runRule(rule, code);
      expect(result.diagnostics).toHaveLength(0);
    }
  });

  it("does not flag global attributes on any tag", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ id: string; role: string; title: string; hidden: boolean; tabIndex: number }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag svg fill on svg", () => {
    const result = runRule(rule, "const S = styled.svg<{ fill: string }>`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag data-* / aria-* string keys", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ 'data-testid': string; 'aria-label': string }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag event handler props", () => {
    const result = runRule(
      rule,
      "const D = styled.div<{ onCustomThing: () => void }>`color: red;`;",
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag styled.div without a generic", () => {
    const result = runRule(rule, "const D = styled.div`color: red;`;");
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags selected on div but not on option", () => {
    const div = runRule(rule, "const D = styled.div<{ selected: boolean }>`color: red;`;");
    expect(div.diagnostics).toHaveLength(1);
    const option = runRule(rule, "const O = styled.option<{ selected: boolean }>`color: red;`;");
    expect(option.diagnostics).toHaveLength(0);
  });
});
