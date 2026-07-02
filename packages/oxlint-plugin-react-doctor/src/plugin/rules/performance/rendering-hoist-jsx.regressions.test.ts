import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingHoistJsx } from "./rendering-hoist-jsx.js";

const expectFail = (code: string): void => {
  const result = runRule(renderingHoistJsx, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(renderingHoistJsx, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("performance/rendering-hoist-jsx — regressions", () => {
  it("flags truly static JSX (host tags, no local refs) built in a component", () => {
    expectFail(`function List(){ const ICON = <svg><path /></svg>; return <div>{ICON}</div>; }`);
  });

  it("does not flag JSX whose component is declared inside the component", () => {
    expectPass(
      `function List({ items }){ const Empty = () => <p>none</p>; const placeholder = <Empty />; return items.length ? <ul /> : placeholder; }`,
    );
  });
});
