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

  it("traces a component through a direct default React HoC call", () => {
    expectPass(
      `import { memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       export default memo(FeatureImpl);`,
    );
  });

  it("traces a component through a default-exported React HoC alias", () => {
    expectPass(
      `import { memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = memo(FeatureImpl);
       export default Feature;`,
    );
  });

  it("traces an as-cast component through a direct default React HoC call", () => {
    expectPass(
      `import { memo, type FC } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       export default memo(FeatureImpl as FC);`,
    );
  });

  it("traces a satisfies-wrapped component through a direct default React HoC call", () => {
    expectPass(
      `import { memo, type FC } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       export default memo(FeatureImpl satisfies FC);`,
    );
  });

  it("traces an as-cast component through a default-exported React HoC alias", () => {
    expectPass(
      `import { memo, type FC } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = memo(FeatureImpl as FC);
       export default Feature;`,
    );
  });

  it("traces a satisfies-wrapped component through a default-exported React HoC alias", () => {
    expectPass(
      `import { memo, type FC } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = memo(FeatureImpl satisfies FC);
       export default Feature;`,
    );
  });

  it("does not trace an as-cast component through a shadowed default HoC call", () => {
    expectFail(
      `import type { FC } from "react";
       const memo = (value) => value;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       export default memo(FeatureImpl as FC);`,
    );
  });

  it("does not trace a satisfies-wrapped component through a shadowed HoC alias", () => {
    expectFail(
      `import type { FC } from "react";
       const memo = (value) => value;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       const Feature = memo(FeatureImpl satisfies FC);
       export default Feature;`,
    );
  });

  it("does not treat a default call to a shadowed memo function as a React export", () => {
    expectFail(
      `const memo = (value) => value;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       export default memo(FeatureImpl);`,
    );
  });

  it("does not treat a default call to non-React memo as a React export", () => {
    expectFail(
      `import { memo } from "./not-react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       export default memo(FeatureImpl);`,
    );
  });

  it("does not treat a non-component wrapped by React memo as an exported component", () => {
    expectFail(
      `import { memo } from "react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Gamma() { return <div />; }
       const notAComponent = 42;
       export default memo(notAComponent);`,
    );
  });

  it("does not trace an overwritten mutable React HoC alias", () => {
    expectFail(
      `import { memo } from "react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       let Feature = memo(FeatureImpl);
       Feature = 42;
       export default Feature;`,
    );
  });

  it("does not trace a later React HoC assignment to a mutable alias", () => {
    expectFail(
      `import { memo } from "react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       let Feature = FeatureImpl;
       Feature = memo(FeatureImpl);
       export default Feature;`,
    );
  });

  it("traces a default export specifier through a React HoC alias", () => {
    expectPass(
      `import { memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = memo(FeatureImpl);
       export { Feature as default };`,
    );
  });

  it("traces a named export specifier through a React HoC alias", () => {
    expectPass(
      `import { memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = memo(FeatureImpl);
       export { Feature };`,
    );
  });

  it("traces a typed component through a default React HoC export specifier", () => {
    expectPass(
      `import { memo, type FC } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = memo(FeatureImpl satisfies FC);
       export { Feature as default };`,
    );
  });

  it("does not trace a mutable React HoC export specifier alias", () => {
    expectFail(
      `import { memo } from "react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       let Feature = memo(FeatureImpl);
       Feature = 42;
       export { Feature as default };`,
    );
  });

  it("does not trace a non-React HoC export specifier alias", () => {
    expectFail(
      `import { memo } from "./not-react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       const Feature = memo(FeatureImpl);
       export { Feature };`,
    );
  });

  it("traces directly composed React HoCs to the terminal component", () => {
    expectPass(
      `import { forwardRef, memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       export default memo(forwardRef(FeatureImpl));`,
    );
  });

  it("traces composed React HoCs through read-only const aliases", () => {
    expectPass(
      `import { forwardRef, memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Forwarded = forwardRef(FeatureImpl);
       const Feature = memo(Forwarded);
       export default Feature;`,
    );
  });

  it("traces a typed composed React HoC through an export specifier", () => {
    expectPass(
      `import { forwardRef, memo, type FC } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Forwarded = forwardRef(FeatureImpl satisfies FC);
       const Feature = memo(Forwarded);
       export { Feature as default };`,
    );
  });

  it("does not trace a composed chain containing a non-React HoC", () => {
    expectFail(
      `import { memo } from "react";
       import { forwardRef } from "./not-react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       export default memo(forwardRef(FeatureImpl));`,
    );
  });

  it("does not trace a composed chain containing a shadowed HoC", () => {
    expectFail(
      `import { memo } from "react";
       const forwardRef = (value) => value;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       const Forwarded = forwardRef(FeatureImpl);
       const Feature = memo(Forwarded);
       export default Feature;`,
    );
  });

  it("traces a named inline component through a direct React HoC", () => {
    expectPass(
      `import { memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       export default memo(function FeatureImpl() {
         return <><PrivateHeader /><PrivateBody /></>;
       });`,
    );
  });

  it("traces a named inline component through composed React HoCs", () => {
    expectPass(
      `import { forwardRef, memo } from "react";
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       export default memo(forwardRef(function FeatureImpl() {
         return <><PrivateHeader /><PrivateBody /></>;
       }));`,
    );
  });

  it("recognizes an anonymous inline function in a default React HoC", () => {
    expectPass(
      `import { memo } from "react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Gamma() { return <div />; }
       export default memo(function () { return <div />; });`,
    );
  });

  it("recognizes an anonymous inline arrow in a default React HoC", () => {
    expectPass(
      `import { memo } from "react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Gamma() { return <div />; }
       export default memo(() => <div />);`,
    );
  });

  it("does not infer a public component from a non-HoC default call", () => {
    expectFail(
      `const wrap = (value) => value;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Gamma() { return <div />; }
       export default wrap(() => <div />);`,
    );
  });

  it("does not treat a shadowed memo function as a React export wrapper", () => {
    expectFail(
      `const memo = (_component) => 0;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function GridComponent() { return <div />; }
       export const Grid = memo(GridComponent);`,
    );
  });

  it("does not treat a non-React memo import as a React export wrapper", () => {
    expectFail(
      `import { memo } from "./not-react";
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function GridComponent() { return <div />; }
       export const Grid = memo(GridComponent);`,
    );
  });

  // React-compat runtimes (preact/compat, @wordpress/element) re-export
  // React's own memo/forwardRef — their HoC wrappers must behave exactly
  // like imports from "react" in both directions.
  it("traces a memo export wrapper imported from a React-compat runtime", () => {
    expectPass(
      `import { memo } from "preact/compat";
       function RowCard() { return <div />; }
       function HeaderCard() { return <div />; }
       function GridComponent() { return <div><RowCard /><HeaderCard /></div>; }
       export const Grid = memo(GridComponent);`,
    );
  });

  it("counts memo-wrapped components imported from a React-compat runtime", () => {
    expectFail(
      `import { memo } from "@wordpress/element";
       const Alpha = memo(() => <div />);
       const Beta = () => <div />;
       const Gamma = () => <div />;`,
    );
  });

  it("does not treat an alias of a shadowed memo function as a React export wrapper", () => {
    expectFail(
      `const memo = (_component) => 0;
       const wrap = memo;
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function GridComponent() { return <div />; }
       export const Grid = wrap(GridComponent);`,
    );
  });

  it("traces a namespace-imported React memo alias", () => {
    expectPass(
      `import * as React from "react";
       const wrap = React.memo;
       const RowCard = () => <div />;
       const HeaderCard = () => <div />;
       function GridComponent() { return <div><RowCard /><HeaderCard /></div>; }
       export const Grid = wrap(GridComponent);`,
    );
  });

  it("traces a renamed destructured React memo binding", () => {
    expectPass(
      `import * as React from "react";
       const { memo: wrap } = React;
       const RowCard = () => <div />;
       const HeaderCard = () => <div />;
       function GridComponent() { return <div><RowCard /><HeaderCard /></div>; }
       export const Grid = wrap(GridComponent);`,
    );
  });

  it("does not treat a shadowed React namespace as an export wrapper", () => {
    expectFail(
      `const React = { memo: (_component) => 0 };
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function GridComponent() { return <div />; }
       export const Grid = React.memo(GridComponent);`,
    );
  });

  it("detects components wrapped by destructured CommonJS React memo", () => {
    expectFail(
      `const { memo } = require("react");
       const Alpha = memo(() => <div />);
       const Beta = () => <div />;
       const Gamma = () => <div />;`,
    );
  });

  it("traces a CommonJS React memo binding", () => {
    expectPass(
      `const memo = require("react").memo;
       const RowCard = () => <div />;
       const HeaderCard = () => <div />;
       function GridComponent() { return <div><RowCard /><HeaderCard /></div>; }
       export const Grid = memo(GridComponent);`,
    );
  });

  it("traces a CommonJS React namespace", () => {
    expectPass(
      `const React = require("react");
       const RowCard = () => <div />;
       const HeaderCard = () => <div />;
       function GridComponent() { return <div><RowCard /><HeaderCard /></div>; }
       export const Grid = React.memo(GridComponent);`,
    );
  });

  it("traces a React HoC component through a CommonJS named export", () => {
    expectPass(
      `const { memo } = require("react");
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       exports.Feature = memo(FeatureImpl);`,
    );
  });

  it("traces a React HoC component through CommonJS default exports", () => {
    const sources = [
      `const { memo } = require("react");
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       module.exports = memo(FeatureImpl);`,
      `const { memo } = require("react");
       function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       module.exports = { Feature: memo(FeatureImpl) };`,
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       module.exports.Feature = FeatureImpl;`,
    ];
    for (const source of sources) expectPass(source);
  });

  it("traces component identity through read-only export aliases", () => {
    const sources = [
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = FeatureImpl;
       export default Feature;`,
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = FeatureImpl;
       export { Feature };`,
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       const Feature = FeatureImpl;
       module.exports = Feature;`,
    ];
    for (const source of sources) expectPass(source);
  });

  it("traces CommonJS object exports by component value identity", () => {
    for (const source of [
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       module.exports = { "Feature": FeatureImpl };`,
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       function FeatureImpl() { return <><PrivateHeader /><PrivateBody /></>; }
       module.exports = { ["Feature"]: FeatureImpl };`,
    ]) {
      expectPass(source);
    }
  });

  it("counts an inline CommonJS object method as the public feature surface", () => {
    expectPass(
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       module.exports = { "Feature"() { return <><PrivateHeader /><PrivateBody /></>; } };`,
    );
  });

  it("does not infer an exported component from an unrelated CommonJS property value", () => {
    const result = runRule(
      noMultiComp,
      `function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Feature() { return <div />; }
       module.exports = { Feature: 42 };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("counts a direct CommonJS component assignment as the public feature surface", () => {
    expectPass(
      `function PrivateHeader() { return <header />; }
       function PrivateBody() { return <main />; }
       exports.Feature = () => <><PrivateHeader /><PrivateBody /></>;`,
    );
  });

  it("does not count shadowed CommonJS namespace assignments as components", () => {
    const sources = [
      `const exports = {};
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Gamma() { return <div />; }
       exports.Feature = () => <main />;`,
      `const module = { exports: {} };
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function Gamma() { return <div />; }
       module.exports.Feature = () => <main />;`,
    ];
    for (const source of sources) {
      const result = runRule(noMultiComp, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    }
  });

  it("does not infer a public surface from a shadowed CommonJS namespace", () => {
    const sources = [
      `const { memo } = require("react");
       const exports = {};
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       exports.Feature = memo(FeatureImpl);`,
      `const { memo } = require("react");
       const module = { exports: {} };
       function Alpha() { return <div />; }
       function Beta() { return <div />; }
       function FeatureImpl() { return <div />; }
       module.exports = memo(FeatureImpl);`,
    ];
    for (const source of sources) expectFail(source);
  });

  it("detects components wrapped by a TypeScript import-equals React namespace", () => {
    expectFail(
      `import React = require("react");
       const Alpha = React.memo(() => <div />);
       const Beta = () => <div />;
       const Gamma = () => <div />;`,
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

  it("treats component member assignments as a compound component surface", () => {
    expectPass(
      `function Header({ children }) { return <header>{children}</header>; }
       Header.Search = function HeaderSearch() {
         const [query, setQuery] = useState("");
         return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
       };
       Header.Button = function HeaderButton({ to, children }) {
         const navigate = useNavigate();
         return <button onClick={() => navigate(to)}>{children}</button>;
       };
       export default Header;`,
    );
  });

  it("still counts components assigned to a non-component namespace", () => {
    expectFail(
      `const Header = {};
       Header.Search = function HeaderSearch() {
         const [query, setQuery] = useState("");
         return <input value={query} onChange={(event) => setQuery(event.target.value)} />;
       };
       Header.Button = function HeaderButton() {
         const navigate = useNavigate();
         return <button onClick={() => navigate("/")}>Go</button>;
       };
       Header.Menu = function HeaderMenu() {
         const location = useLocation();
         return <nav>{location.pathname}</nav>;
       };`,
    );
  });

  it("still flags 3+ private components with no exports at all", () => {
    expectFail(
      `function Foo() { return <div />; } function Bar() { return <div />; } function Baz() { return <div />; }`,
    );
  });
});
