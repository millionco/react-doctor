import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { jsxNumericAndLeakedRender } from "./jsx-numeric-and-leaked-render.js";

describe("jsx-numeric-and-leaked-render", () => {
  it("flags {items.length && <List/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{items.length && <List items={items} />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a parenthesized JSX right operand {cart.items.length && (<Summary/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ cart }) => <div>{cart.items.length && (<Summary />)}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .size on a binding provably initialized to a Set", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ ids }) => {
        const selected = new Set(ids);
        return <div>{selected.size && <Badge />}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .size on a useState(new Set()) destructure", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = () => {
        const [selected, setSelected] = useState(new Set());
        return <div>{selected.size && <Badge />}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags .size on a useRef(new Map()) current", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = () => {
        const cacheRef = useRef(new Map());
        return <div>{cacheRef.current.size && <Badge />}</div>;
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {(count - 1) && <More/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ count }) => <div>{(count - 1) && <More />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {Number(value) && <Chip/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ value }) => <div>{Number(value) && <Chip />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the JSX-adjacent .length in a chain {!isLoading && items.length && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ isLoading, items }) => <div>{!isLoading && items.length && <List />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a numeric operand earlier in the chain {items.length && isOpen && <List/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items, isOpen }) => <div>{items.length && isOpen && <List />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags numeric && inside a ternary branch {ready ? items.length && <List/> : <Spinner/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ ready, items }) => <div>{ready ? items.length && <List /> : <Spinner />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags numeric && in the right arm of || {empty || (items.length && <List/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ empty, items }) => <div>{empty || (items.length && <List />)}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags {items.length && items.map(i => <Item/>)}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <ul>{items.length && items.map((i) => <Item key={i.id} />)}</ul>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag react-hook-form errors.size (FieldError for a field named size)", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ errors }) => <div>{errors.size && <FieldError message={errors.size.message} />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string size prop {props.size && <SizeBadge/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = (props) => <div>{props.size && <SizeBadge size={props.size} />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag .size on a bare prop with no provable Map/Set origin", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ selected }) => <div>{selected.size && <Badge />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a boolean LHS {isOpen && <Modal/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ isOpen }) => <div>{isOpen && <Modal />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a comparison {arr.length > 0 && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{arr.length > 0 && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag inequality {items.length !== 0 && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{items.length !== 0 && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a double-negation {!!arr.length && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{!!arr.length && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a ternary {arr.length ? <X/> : null}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ arr }) => <div>{arr.length ? <X /> : null}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a string/identifier LHS {name && <X/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ name }) => <div>{name && <X />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a numeric && used as an attribute value", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <X hidden={items.length && <Y />} />;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the left arm of || where a falsy 0 never renders {(items.length && <List/>) || <Empty/>}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const C = ({ items }) => <div>{(items.length && <List />) || <Empty />}</div>;`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a map call whose callback renders no JSX {count && names.map(n => n.toUpperCase())}", () => {
    const result = runRule(
      jsxNumericAndLeakedRender,
      `const total = ({ count, names }) => count && names.map((n) => n.toUpperCase());`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
