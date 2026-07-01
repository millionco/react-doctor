import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNumericAndLeakedRender } from "./jsx-numeric-and-leaked-render.js";

describe("jsx-numeric-and-leaked-render", () => {
  it("flags {items.length && <List/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{items.length && <List items={items} />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a parenthesized JSX right operand {cart.items.length && (<Summary/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ cart }) => <div>{cart.items.length && (<Summary />)}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {selected.size && <Badge/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ selected }) => <div>{selected.size && <Badge />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {(count - 1) && <More/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ count }) => <div>{(count - 1) && <More />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {Number(value) && <Chip/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ value }) => <div>{Number(value) && <Chip />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the JSX-adjacent .length in a chain {!isLoading && items.length && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ isLoading, items }) => <div>{!isLoading && items.length && <List />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a boolean LHS {isOpen && <Modal/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ isOpen }) => <div>{isOpen && <Modal />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a comparison {arr.length > 0 && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{arr.length > 0 && <X />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inequality {items.length !== 0 && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{items.length !== 0 && <X />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a double-negation {!!arr.length && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{!!arr.length && <X />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ternary {arr.length ? <X/> : null}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{arr.length ? <X /> : null}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string/identifier LHS {name && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ name }) => <div>{name && <X />}</div>;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric && used as an attribute value", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <X hidden={items.length && <Y />} />;`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
