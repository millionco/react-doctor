import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { forwardRefUsesRef } from "./forward-ref-uses-ref.js";

const expectDiagnosticCount = (code: string, expectedCount: number): void => {
  const result = runRule(forwardRefUsesRef, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(expectedCount);
};

describe("react-builtins/forward-ref-uses-ref binding provenance", () => {
  it("ignores unrelated local functions named forwardRef", () => {
    expectDiagnosticCount(
      `const forwardRef = (transform: (value: string) => string): string => transform("hello");
       forwardRef((value) => value.toUpperCase());`,
      0,
    );
  });

  it("reports renamed React forwardRef imports with unary callbacks", () => {
    expectDiagnosticCount(
      `import { forwardRef as wrapRef } from "react";
       wrapRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("reports direct React forwardRef imports with unary callbacks", () => {
    expectDiagnosticCount(
      `import { forwardRef } from "react";
       forwardRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("ignores direct and renamed React forwardRef callbacks that accept ref", () => {
    expectDiagnosticCount(
      `import { forwardRef, forwardRef as wrapRef } from "react";
       forwardRef((props, ref) => <button ref={ref}>{props.label}</button>);
       wrapRef((props, ref) => <button ref={ref}>{props.label}</button>);`,
      0,
    );
  });

  it("reports default and namespace React imports", () => {
    expectDiagnosticCount(
      `import ReactDefault from "react";
       import * as ReactNamespace from "react";
       ReactDefault.forwardRef((props) => <button>{props.label}</button>);
       ReactNamespace.forwardRef((props) => <button>{props.label}</button>);`,
      2,
    );
  });

  it("reports immutable named and namespace aliases", () => {
    expectDiagnosticCount(
      `import ReactNamespace, { forwardRef as importedForwardRef } from "react";
       const firstForwardRef = importedForwardRef;
       const wrappedForwardRef = firstForwardRef as typeof firstForwardRef;
       const firstReactAlias = ReactNamespace;
       const secondReactAlias = firstReactAlias;
       wrappedForwardRef((props) => <button>{props.label}</button>);
       secondReactAlias.forwardRef((props) => <button>{props.label}</button>);`,
      2,
    );
  });

  it("ignores mutable aliases and lexical shadows", () => {
    expectDiagnosticCount(
      `import ReactNamespace, { forwardRef as importedForwardRef } from "react";
       let mutableForwardRef = importedForwardRef;
       mutableForwardRef = (callback) => callback("local");
       let MutableReact = ReactNamespace;
       MutableReact = { forwardRef: (callback) => callback("local") };
       const run = (importedForwardRef, ReactNamespace) => {
         importedForwardRef((value) => value.toUpperCase());
         ReactNamespace.forwardRef((value) => value.toUpperCase());
       };
       mutableForwardRef((value) => value.toUpperCase());
       MutableReact.forwardRef((value) => value.toUpperCase());
       void run;`,
      0,
    );
  });

  it("ignores same-shaped imports from other packages", () => {
    expectDiagnosticCount(
      `import OtherReact, { forwardRef, forwardRef as wrapRef } from "other-react";
       forwardRef((value) => value.toUpperCase());
       wrapRef((value) => value.toUpperCase());
       OtherReact.forwardRef((value) => value.toUpperCase());`,
      0,
    );
  });

  it("reports static computed, optional, and TypeScript-wrapped React calls", () => {
    expectDiagnosticCount(
      `import ReactNamespace, { forwardRef } from "react";
       ReactNamespace["forwardRef"]((props) => <button>{props.label}</button>);
       ReactNamespace?.forwardRef((props) => <button>{props.label}</button>);
       (forwardRef as typeof forwardRef)((props) => <button>{props.label}</button>);
       (ReactNamespace as typeof ReactNamespace).forwardRef((props) => <button>{props.label}</button>);`,
      4,
    );
  });

  it("only reports inline callbacks with exactly one non-rest parameter", () => {
    expectDiagnosticCount(
      `import { forwardRef } from "react";
       const renderButton = (props) => <button>{props.label}</button>;
       forwardRef(() => <button />);
       forwardRef((props) => <button>{props.label}</button>);
       forwardRef((props, ref) => <button ref={ref}>{props.label}</button>);
       forwardRef((...argumentsList) => <button>{argumentsList.length}</button>);
       forwardRef(renderButton);`,
      1,
    );
  });

  it("reports unbound global React namespace calls", () => {
    expectDiagnosticCount(
      `React.forwardRef((props) => <button>{props.label}</button>);
       SomeOtherGlobal.forwardRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("reports named default React imports", () => {
    expectDiagnosticCount(
      `import { default as ReactDefault } from "react";
       ReactDefault.forwardRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("reports destructured forwardRef from React namespace imports", () => {
    expectDiagnosticCount(
      `import * as ReactNamespace from "react";
       const { forwardRef } = ReactNamespace;
       const { forwardRef: renamedForwardRef } = ReactNamespace;
       forwardRef((props) => <button>{props.label}</button>);
       renamedForwardRef((props) => <button>{props.label}</button>);`,
      2,
    );
  });

  it("reports destructured forwardRef from the global React namespace", () => {
    expectDiagnosticCount(
      `const { forwardRef } = React;
       forwardRef((props) => <button>{props.label}</button>);`,
      1,
    );
  });

  it("keeps destructured lookalikes conservative", () => {
    expectDiagnosticCount(
      `import * as ReactNamespace from "react";
       import * as OtherNamespace from "other-react";
       const { forwardRef: otherForwardRef } = OtherNamespace;
       let { forwardRef: mutableForwardRef } = ReactNamespace;
       const { ["forwardRef"]: computedForwardRef } = ReactNamespace;
       otherForwardRef((value) => value.toUpperCase());
       mutableForwardRef((value) => value.toUpperCase());
       computedForwardRef((value) => value.toUpperCase());`,
      0,
    );
  });

  it("ignores hoisted local forwardRef function declarations", () => {
    expectDiagnosticCount(
      `forwardRef((value) => value.toUpperCase());
       function forwardRef(transform: (value: string) => string): string {
         return transform("hello");
       }`,
      0,
    );
  });

  it("reports the inner forwardRef nested inside memo", () => {
    expectDiagnosticCount(
      `import { memo, forwardRef } from "react";
       memo(forwardRef((props) => <button>{props.label}</button>));`,
      1,
    );
  });

  it("ignores spread-argument forwardRef calls", () => {
    expectDiagnosticCount(
      `import { forwardRef } from "react";
       const renderCallbacks = [(props) => <button>{props.label}</button>];
       forwardRef(...renderCallbacks);`,
      0,
    );
  });

  it("keeps CommonJS, dynamic, and unbound calls conservative", () => {
    expectDiagnosticCount(
      `const ReactCommonJs = require("react");
       const propertyName = "forwardRef";
       ReactCommonJs.forwardRef((props) => <button>{props.label}</button>);
       ReactCommonJs[propertyName]((props) => <button>{props.label}</button>);
       forwardRef((props) => <button>{props.label}</button>);`,
      0,
    );
  });
});
