import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { preferModuleScopeStaticValue } from "./prefer-module-scope-static-value.js";

const run = (code: string) =>
  runRule(preferModuleScopeStaticValue, code, { filename: "fixture.tsx" });

describe("architecture/prefer-module-scope-static-value — regressions", () => {
  it("does not flag an object initializer that calls Date.now()", () => {
    const result = run(
      `function Banner() { const meta = { renderedAt: Date.now() }; return <span>{meta.renderedAt}</span>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an array initializer built from Math.random()", () => {
    const result = run(
      `function Sparkles() { const seeds = [Math.random(), Math.random()]; return <div>{seeds.join()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an object built from crypto.randomUUID()", () => {
    const result = run(
      `function Row() { const id = { value: crypto.randomUUID() }; return <li>{id.value}</li>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an array built from nanoid() (impure id generator)", () => {
    const result = run(
      `import { nanoid } from "nanoid"; function Row() { const ids = [nanoid(), nanoid()]; return <div>{ids.join()}</div>; }`,
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a pure literal array with no impure call", () => {
    const result = run(
      `function List() { const items = [1, 2, 3]; return <div>{items.join()}</div>; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
