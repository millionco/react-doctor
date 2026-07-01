import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFillMapElementAsKey } from "./no-fill-map-element-as-key.js";

describe("no-fill-map-element-as-key", () => {
  it("flags Array(n).fill(null).map((index) => key={index})", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Skeleton = ({ count }) => (
        <>{Array(count).fill(null).map((index) => <Row key={index} />)}</>
      );`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags new Array(5).fill(0).map((i) => key={i})", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `function Stars() {
        return new Array(5).fill(0).map((i) => <Star key={i} />);
      }`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Array(3).fill(null).map((idx) => key={String(idx)}) coercion", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Loading = () => (
        <div>{Array(3).fill(null).map((idx) => <li key={String(idx)}>loading</li>)}</div>
      );`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags Array(n).fill('').map((index) => key={String(index)})", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Placeholders = ({ n }) => Array(n).fill('').map((index) => <Card key={String(index)} />);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags template-literal coercion key={`${index}`}", () => {
    const result = runRule(
      noFillMapElementAsKey,
      "const P = ({ n }) => Array(n).fill(null).map((index) => <Card key={`${index}`} />);"
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag the correct two-param form (_, index)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok = ({ n }) => Array(n).fill(null).map((_, index) => <Row key={index} />);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a real element + index two-param callback", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok2 = ({ items }) => items.map((item, i) => <Row key={i} />);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single-param map on a non-fill receiver", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok3 = ({ items }) => items.map((index) => <Row key={index} />);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a single param not named like an index", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok4 = () => Array(3).fill('a').map((letter) => <Row key={letter} />);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag Array.from with a mapfn (out of scope in v1)", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const Ok5 = () => Array.from({ length: 3 }, (_, index) => <Row key={index} />);`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the harmless single-element Array(1).fill() case", () => {
    const result = runRule(
      noFillMapElementAsKey,
      `const One = () => Array(1).fill(null).map((index) => <Row key={index} />);`
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
        });`
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
