import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFillMapElementAsKey } from "./no-fill-map-element-as-key.js";

describe("no-fill-map-element-as-key", () => {
  it("flags Array(n).fill(null).map((index) => key={index})", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Skeleton = ({ count }) => (
        <>{Array(count).fill(null).map((index) => <Row key={index} />)}</>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Array(5).fill(0).map((i) => key={i})", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `function Stars() {
        return new Array(5).fill(0).map((i) => <Star key={i} />);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Array(3).fill(null).map((idx) => key={String(idx)}) coercion", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Loading = () => (
        <div>{Array(3).fill(null).map((idx) => <li key={String(idx)}>loading</li>)}</div>
      );`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Array(n).fill('').map((index) => key={String(index)})", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Placeholders = ({ n }) => Array(n).fill('').map((index) => <Card key={String(index)} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags template-literal coercion key={`${index}`}", () => {
    const result = runRule(
      noFillMapElementAsKey,
      "const P = ({ n }) => Array(n).fill(null).map((index) => <Card key={`${index}`} />);",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the correct two-param form (_, index)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok = ({ n }) => Array(n).fill(null).map((_, index) => <Row key={index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a real element + index two-param callback", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok2 = ({ items }) => items.map((item, i) => <Row key={i} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single-param map on a non-fill receiver", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok3 = ({ items }) => items.map((index) => <Row key={index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a sole param regardless of its name — the element is the constant fill value (internxt skeleton idiom)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `function loadingSkeleton() {
        return new Array(20).fill(0).map((n) => <DriveGridItemSkeleton key={n} />);
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a non-index-named sole param over a string fill value", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Rows = () => Array(3).fill('a').map((letter) => <Row key={letter} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a non-fill single-param map with a non-index name", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok4 = ({ letters }) => letters.map((letter) => <Row key={letter} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Array.from with a mapfn (out of scope in v1)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok5 = () => Array.from({ length: 3 }, (_, index) => <Row key={index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the harmless single-element Array(1).fill() case", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const One = () => Array(1).fill(null).map((index) => <Row key={index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a for-loop counter shadowing the map param (calendar week/day grid idiom)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Calendar = ({ weeks }) =>
        Array(weeks).fill(null).map((i) => {
          const days = [];
          for (let i = 0; i < 7; i++) days.push(<Day key={i} />);
          return <Week>{days}</Week>;
        });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a for-of [i, v] entries() destructure shadowing the map param", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Grid = ({ rows, cells }) =>
        Array(rows).fill(null).map((i) => {
          const rendered = [];
          for (const [i, cell] of cells.entries()) rendered.push(<Cell key={i} value={cell} />);
          return <Row>{rendered}</Row>;
        });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a nested-block const shadowing the map param", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Blocks = ({ n }) =>
        Array(n).fill(null).map((i) => {
          {
            const i = nextStableId();
            return <Row key={i} />;
          }
        });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a const fill array mapped through a variable (skeleton-loader idiom)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Skeletons = ({ count }) => {
        const slots = Array(count).fill(null);
        return slots.map((index) => <Row key={index} />);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a const fill array whose elements are mutated before mapping", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Positions = ({ count }) => {
        const slots = Array(count).fill(0);
        slots.forEach((_, position) => { slots[position] = position * 2; });
        return slots.map((i) => <Row key={i} />);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a let fill array that may be reassigned before mapping", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Rows = ({ count, loaded }) => {
        let slots = Array(count).fill(null);
        if (loaded) slots = fetchRows();
        return slots.map((index) => <Row key={index} />);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when the index key lives inside a nested function, not the map callback", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Nested = ({ n }) =>
        Array(n).fill(null).map((outer) => {
          const render = (index) => <Row key={index} />;
          return render(outer);
        });`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet: In-place Fisher-Yates shuffle helper populates the fill array before mapping", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const fillWithShuffledIndices = (slots) => {
  for (let position = 0; position < slots.length; position += 1) {
    slots[position] = position;
  }
  for (let position = slots.length - 1; position > 0; position -= 1) {
    const swapWith = Math.floor(Math.random() * (position + 1));
    const held = slots[position];
    slots[position] = slots[swapWith];
    slots[swapWith] = held;
  }
};

const QuizChoices = ({ choices }) => {
  const order = Array(choices.length).fill(0);
  fillWithShuffledIndices(order);
  return <ol>{order.map((index) => <li key={index}>{choices[index]}</li>)}</ol>;
};`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags when the filled binding is only mapped, never passed to a call", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Grid = ({ count }) => {
         const slots = Array(count).fill(0);
         return <ul>{slots.map((index) => <li key={index} />)}</ul>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});

describe("audit regressions", () => {
  it("allows a statically empty filled array", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const C = () => Array(0).fill(null).map((item) => <X key={item} />);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows a callback parameter reassigned before the key", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const C = () => Array(3).fill(null).map((item) => { item = crypto.randomUUID(); return <X key={item} />; });`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not let a later benign call hide duplicate keys", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const C = () => { const slots = Array(3).fill(null); const out = slots.map((item) => <X key={item} />); console.log(slots); return out; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let an earlier observational call hide duplicate keys", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const C = () => { const slots = Array(3).fill(null); console.log(slots); return slots.map((item) => <X key={item} />); };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows a filled array passed through a TypeScript wrapper before mapping", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const C = () => { const slots = Array(3).fill(0); populate(slots as number[]); return slots.map((item) => <X key={item} />); };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
