import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { jsxFragments } from "./jsx-fragments.js";
import { jsxNoUselessFragment } from "./jsx-no-useless-fragment.js";

const fragmentRules: ReadonlyArray<Rule> = [jsxFragments, jsxNoUselessFragment];

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  for (const rule of fragmentRules) {
    const result = runRule(rule, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  }
};

describe("React Fragment binding provenance", () => {
  it("recognizes named imports and immutable aliases", () => {
    expectDiagnosticCount(
      `import { Fragment } from "react";
       const Wrapper = Fragment;
       const View = () => <Wrapper><span /></Wrapper>;`,
      1,
    );
  });

  it("recognizes renamed, default, and namespace React imports", () => {
    expectDiagnosticCount(
      `import ReactDefault, { Fragment as ReactFragment } from "react";
       import * as ReactNamespace from "react";
       const NamespaceAlias = ReactNamespace;
       const View = () => (
         <main>
           <ReactFragment><span /></ReactFragment>
           <ReactDefault.Fragment><span /></ReactDefault.Fragment>
           <NamespaceAlias.Fragment><span /></NamespaceAlias.Fragment>
         </main>
       );`,
      3,
    );
  });

  it("ignores an unrelated local component named Fragment", () => {
    expectDiagnosticCount(
      `const Fragment = ({ children }) => <section>{children}</section>;
       const View = () => <Fragment><span /></Fragment>;`,
      0,
    );
  });

  it("honors lexical shadows of a real Fragment import", () => {
    expectDiagnosticCount(
      `import { Fragment } from "react";
       const View = () => {
         const Fragment = ({ children }) => <section>{children}</section>;
         return <Fragment><span /></Fragment>;
       };`,
      0,
    );
  });

  it("ignores same-shaped bindings from unrelated modules and objects", () => {
    expectDiagnosticCount(
      `import { Fragment as LibraryFragment } from "./ui";
       const React = { Fragment: LibraryFragment };
       const View = () => (
         <main>
           <LibraryFragment><span /></LibraryFragment>
           <React.Fragment><span /></React.Fragment>
         </main>
       );`,
      0,
    );
  });

  it("keeps keyed real Fragments exempt", () => {
    expectDiagnosticCount(
      `import { Fragment } from "react";
       const View = () => <Fragment key="stable"><span /></Fragment>;`,
      0,
    );
  });
});
