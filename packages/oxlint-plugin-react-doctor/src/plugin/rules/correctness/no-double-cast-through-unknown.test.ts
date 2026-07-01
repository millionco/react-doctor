import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDoubleCastThroughUnknown } from "./no-double-cast-through-unknown.js";

describe("no-double-cast-through-unknown", () => {
  it("flags x as unknown as SomeType", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = x as unknown as SomeType;`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags (x as any) as SomeType", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = (x as any) as SomeType;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags x as any as SomeType", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = x as any as SomeType;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a spread double cast", () => {
    const result = runRule(
      noDoubleCastThroughUnknown,
      `const el = <Foo {...(props as unknown as T)} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a member access on a double cast", () => {
    const result = runRule(
      noDoubleCastThroughUnknown,
      `const foo = (globalThis as unknown as { foo: Bar }).foo;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags the value as any as ITimestamp form", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = value as any as ITimestamp;`);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a single as T cast", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = JSON.parse(s) as SomeType;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a lone as unknown widening", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = x as unknown;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag as const", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = { a: 1 } as const;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a reduce-accumulator {} as T single cast", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const acc = {} as Record<string, number>;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag two single casts across separate statements", () => {
    const result = runRule(
      noDoubleCastThroughUnknown,
      `const a = x as unknown; const b = a as SomeType;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a double cast whose inner target is a concrete type", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = x as Foo as Bar;`);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports only once for a triple cast through unknown", () => {
    const result = runRule(noDoubleCastThroughUnknown, `const y = x as unknown as A as B;`);
    expect(result.diagnostics).toHaveLength(1);
  });
});
