import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { iframeMissingSandbox } from "./iframe-missing-sandbox.js";

describe("iframe missing sandbox createElement receivers", () => {
  const testCases = [
    {
      name: "named-react-import",
      code: 'import { createElement } from "react"; createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "renamed-react-import",
      code: 'import { createElement as makeFrame } from "react"; makeFrame("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "default-react-import",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "namespace-react-import",
      code: 'import * as ReactClient from "react"; ReactClient.createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "computed-static-member",
      code: 'import * as ReactClient from "react"; ReactClient["createElement"]("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "transparent-callee",
      code: 'import ReactClient from "react"; (ReactClient as any).createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "readonly-namespace-alias",
      code: 'import ReactClient from "react"; const Runtime = ReactClient; Runtime.createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "global-react-legacy",
      code: 'React.createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "bare-create-element-legacy",
      code: 'createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "owner-document",
      code: 'const makeFrame=(ownerDoc: Document)=>ownerDoc.createElement("iframe");',
      diagnostics: [],
    },
    {
      name: "document-alias",
      code: 'const ownerDoc=document; ownerDoc.createElement("iframe");',
      diagnostics: [],
    },
    {
      name: "owner-document-property",
      code: 'const makeFrame=(element: Element)=>element.ownerDocument.createElement("iframe");',
      diagnostics: [],
    },
    {
      name: "opaque-receiver",
      code: 'const makeFrame=(runtime)=>runtime.createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "same-name-user-object",
      code: 'const runtime={createElement:(tag)=>({tag})}; runtime.createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "shadowed-react",
      code: 'const makeFrame=(React)=>React.createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "shadowed-bare",
      code: 'const createElement=(tag)=>({tag}); createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "shadowed-import",
      code: 'import ReactClient from "react"; const makeFrame=(ReactClient)=>ReactClient.createElement("iframe",null);',
      diagnostics: [],
    },
    {
      name: "nonreact-import",
      code: 'import {createElement} from "other-runtime"; createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "mutable-namespace-alias",
      code: 'import ReactClient from "react"; let Runtime=ReactClient; Runtime={createElement:(tag)=>({tag})}; Runtime.createElement("iframe",null);',
      diagnostics: [],
    },
    {
      name: "dynamic-member",
      code: 'import ReactClient from "react"; const method="createElement"; ReactClient[method]("iframe",null);',
      diagnostics: [],
    },
    {
      name: "react-valid-sandbox",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe",{sandbox:""});',
      diagnostics: [],
    },
    {
      name: "react-invalid-sandbox",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe",{sandbox:"not-a-token"});',
      diagnostics: [
        {
          message:
            "`not-a-token` isn't a valid `sandbox` token, so the browser ignores it & leaves your iframe exposed.",
          nodeType: "Literal",
        },
      ],
    },
    {
      name: "react-invalid-combination",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe",{sandbox:"allow-scripts allow-same-origin"});',
      diagnostics: [
        {
          message:
            "Combining `allow-scripts` & `allow-same-origin` lets the iframe remove its own sandbox, defeating the protection.",
          nodeType: "Literal",
        },
      ],
    },
    {
      name: "react-opaque-props",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe",props);',
      diagnostics: [],
    },
    {
      name: "react-spread-props",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe",{...props});',
      diagnostics: [],
    },
    {
      name: "react-spread-explicit-src",
      code: 'import ReactClient from "react"; ReactClient.createElement("iframe",{...props,src:"https://example.invalid"});',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "ObjectExpression",
        },
      ],
    },
    {
      name: "compat-module-policy",
      code: 'import {createElement} from "preact/compat"; createElement("iframe",null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "dom-extracted-bare",
      code: 'const createElement=document.createElement.bind(document); createElement("iframe");',
      diagnostics: [],
    },
    {
      name: "erased-global-react-interface",
      code: 'interface React { note: string }; React.createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "erased-bare-create-element-alias",
      code: 'type createElement = string; createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "erased-react-import-companion",
      code: 'import { createElement } from "react"; interface createElement { note: string }; createElement("iframe", null);',
      diagnostics: [
        {
          message:
            "An `<iframe>` with no `sandbox` is a security hole: the embedded page gets full access to your site.",
          nodeType: "CallExpression",
        },
      ],
    },
    {
      name: "erased-interface-with-runtime-class-companion",
      code: 'interface React { note: string }; class React { static createElement() { return document.createElement("iframe"); } }; React.createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "erased-outer-global-name-with-runtime-parameter",
      code: 'type React = string; const build = (React) => React.createElement("iframe", null);',
      diagnostics: [],
    },
    {
      name: "erased-bare-name-with-runtime-function-companion",
      code: 'type createElement = string; function createElement() { return document.createElement("iframe"); } createElement("iframe", null);',
      diagnostics: [],
    },
  ];

  for (const testCase of testCases) {
    it(testCase.name, () => {
      expect(runRule(iframeMissingSandbox, testCase.code)).toEqual({
        diagnostics: testCase.diagnostics,
        parseErrors: [],
      });
    });
  }
});

it("preserves outer ambient value contracts", () => {
  expect(
    runRule(
      iframeMissingSandbox,
      'declare const React: {createElement:unknown}; { interface React { note:string }; React.createElement("iframe",null); }',
    ).diagnostics,
  ).toHaveLength(0);
});

it("preserves ambient function contract 0", () => {
  expect(
    runRule(
      iframeMissingSandbox,
      'declare function React(): unknown; React.createElement("iframe",null);',
    ).diagnostics,
  ).toHaveLength(0);
});

it("preserves ambient function contract 1", () => {
  expect(
    runRule(
      iframeMissingSandbox,
      'interface React {}; function owner(){ declare function React(): unknown; React.createElement("iframe",null); }',
    ).diagnostics,
  ).toHaveLength(0);
});
