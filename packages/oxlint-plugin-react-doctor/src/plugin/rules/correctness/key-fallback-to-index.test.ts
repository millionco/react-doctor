import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { keyFallbackToIndex } from "./key-fallback-to-index.js";

describe("key-fallback-to-index", () => {
  it("flags key={item.id ?? index}", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, index) => <Row key={item.id ?? index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags key={item.id || index}", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, index) => <Row key={item.id || index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a chained fallback ending in index (x ?? y ?? index)", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, index) => <Row key={item.a ?? item.b ?? index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a conditional fallback (cond ? item.id : index)", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, index) => <Row key={item.ok ? item.id : index} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a template-literal fallback key={`order-${token ?? index}`}", () => {
    const result = runRule(
      keyFallbackToIndex,
      "const L = ({ items }) => items.map((token, index) => <Row key={`order-${token ?? index}`} />);",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags idx and i index parameter names too", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, idx) => <Row key={item.id ?? idx} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a composite key `${item.id}-${index}`", () => {
    const result = runRule(
      keyFallbackToIndex,
      "const L = ({ items }) => items.map((item, index) => <Row key={`${item.id}-${index}`} />);",
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a fallback to another stable id", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, index) => <Row key={item.id ?? item.fallbackId} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag `a ?? b` outside any map iteration", () => {
    const result = runRule(keyFallbackToIndex, `const One = ({ a, b }) => <Row key={a ?? b} />;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag when `i` in scope is not the map index parameter", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items, i }) => items.map((item) => <Row key={item.id ?? i} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a plain stable id key", () => {
    const result = runRule(
      keyFallbackToIndex,
      `const L = ({ items }) => items.map((item, index) => <Row key={item.id} />);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });
});
