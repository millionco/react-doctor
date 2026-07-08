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

  // Production FP sweep: design-system parts / atoms / table-trio files
  // export EVERY component they declare (Alert + AlertTitle +
  // AlertDescription, Table + TableRow + TableHeader). The 4-component
  // barrel band already forgave 2-of-4 exported, so 3-of-3 firing was
  // an inconsistency and the most common FP shape in the corpus.
  it("does not flag a file whose components are all exported", () => {
    expectPass(
      `export const Foo = () => <div />; export const Bar = () => <div />; export const Baz = () => <div />;`,
    );
  });

  it("does not flag all-exported components gathered in a bottom export block", () => {
    expectPass(
      `function Alert() { return <div role="alert" />; }
       function AlertTitle() { return <div />; }
       function AlertDescription() { return <div />; }
       export { Alert, AlertTitle, AlertDescription };`,
    );
  });

  // Production FP sweep: demo / page files export one ANONYMOUS default
  // component plus private helpers. The anonymous default previously
  // counted toward neither the component tally nor exportedCount, so
  // the file looked all-private and lost the feature-module exemption.
  it("counts an anonymous default export as the file's exported component", () => {
    expectPass(
      `export default function () { return <Layout><Overview /></Layout>; }
       function Overview() { return <div />; }
       function InstancesTable() { return <table />; }
       function CaloriesChart() { return <svg />; }`,
    );
  });

  // Production FP sweep: `export const FileGrid = memo(FileGridComponent)`
  // re-exports the private declaration through a HoC wrapper — the file
  // has exactly one public component plus private helpers.
  it("traces a memo-wrapped identifier export to its private component", () => {
    expectPass(
      `import { memo } from "react";
       const RowCard = memo(function RowCard() { return <div />; });
       const HeaderCard = memo(function HeaderCard() { return <div />; });
       function GridComponent() { return <div><RowCard /><HeaderCard /></div>; }
       export const Grid = memo(GridComponent);`,
    );
  });

  // Production FP sweep: compound components export their root through a
  // TS cast (`export default SplitButton as SplitButtonComponent`).
  it("unwraps TS casts when resolving a default-exported component name", () => {
    expectPass(
      `const SplitButton = () => <div />;
       const SplitButtonMain = () => { const shared = useShared(); return <button>{shared}</button>; };
       const SplitButtonMenu = () => { const shared = useShared(); return <menu>{shared}</menu>; };
       type SplitButtonComponent = typeof SplitButton;
       export default SplitButton as SplitButtonComponent;`,
    );
  });

  it("still flags 3+ private components with no exports at all", () => {
    expectFail(
      `function Foo() { return <div />; } function Bar() { return <div />; } function Baz() { return <div />; }`,
    );
  });
});
