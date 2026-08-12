import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMultiComp } from "./no-multi-comp.js";

const expectDiagnosticCount = (code: string, count: number, filename = "fixture.tsx"): void => {
  const result = runRule(noMultiComp, code, { filename });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("react-builtins/no-multi-comp — regressions", () => {
  it("reports every component after the first", () => {
    expectDiagnosticCount(
      `function Row() { return <li />; }
       function Header() { return <h1 />; }
       function List() { return <div><Header /><Row /></div>; }`,
      2,
    );
  });

  it("reports files that export one of several components", () => {
    expectDiagnosticCount(
      `function Row() { return <li />; }
       function Header() { return <h1 />; }
       export function List() { return <div><Header /><Row /></div>; }`,
      2,
    );
  });

  it("reports test files like the upstream rule", () => {
    expectDiagnosticCount(
      `function FirstFixture() { return <div />; }
       function SecondFixture() { return <div />; }`,
      1,
      "components.test.tsx",
    );
  });
});
