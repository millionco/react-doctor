import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMultiComp } from "./no-multi-comp.js";

const expectFail = (code: string): void => {
  const result = runRule(noMultiComp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noMultiComp, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

// Hand-written coverage for React Doctor's intentional divergence from
// OXC: OXC flags 2+ components per file, we flag only 3+ (see the
// `no-multi-comp` entry in `oxc-divergences.ts` — every OXC fail fixture
// declares exactly 2 components, so they are all skipped there). These
// tests guard the 3+ threshold and the feature-module exemption that the
// OXC fixtures can't.
describe("react-builtins/no-multi-comp — regressions", () => {
  it("does not flag a 2-component file (idiomatic main + helper co-location)", () => {
    expectPass(`const Foo = () => <div />; const Bar = () => <div />;`);
  });

  it("flags a 3-component file", () => {
    expectFail(`const Foo = () => <div />; const Bar = () => <div />; const Baz = () => <div />;`);
  });

  it("counts null-returning components toward the 3+ threshold", () => {
    expectFail(`const Foo = () => null; const Bar = () => null; const Baz = () => null;`);
  });

  it("does not flag a small feature module (1-2 exports + private helper)", () => {
    expectPass(
      `export const Foo = () => <div />; export const Bar = () => <div />; function Helper() { return <span />; }`,
    );
  });
});
