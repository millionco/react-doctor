import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noReactDomDeprecatedApis } from "./no-react-dom-deprecated-apis.js";

describe("no-react-dom-deprecated-apis import boundaries", () => {
  it.each([
    {
      name: "CommonJS namespace",
      source: "const ReactDOM = require('react-dom'); ReactDOM.render(<div />, document.body);",
      expectedCount: 0,
    },
    {
      name: "TypeScript import equals",
      source: "import ReactDOM = require('react-dom'); ReactDOM.render(<div />, document.body);",
      expectedCount: 0,
    },
    {
      name: "named default import",
      source:
        "import { default as ReactDOM } from 'react-dom'; ReactDOM.render(<div />, document.body);",
      expectedCount: 0,
    },
    {
      name: "type-only default import",
      source: "import type ReactDOM from 'react-dom'; ReactDOM.render(<div />, document.body);",
      expectedCount: 0,
    },
    {
      name: "default import",
      source: "import ReactDOM from 'react-dom'; ReactDOM.render(<div />, document.body);",
      expectedCount: 1,
    },
    {
      name: "namespace const alias",
      source:
        "import * as ReactDOM from 'react-dom'; const DomAlias = ReactDOM; DomAlias.render(<div />, document.body);",
      expectedCount: 1,
    },
    {
      name: "removed named API import",
      source: "import { render } from 'react-dom'; render(<div />, document.body);",
      expectedCount: 1,
    },
    {
      name: "type-only test-utils import",
      source:
        "import type { act } from 'react-dom/test-utils'; export interface ActOptions { callback: typeof act }",
      expectedCount: 1,
    },
  ])("preserves the canonical contract for $name", ({ source, expectedCount }) => {
    const result = runRule(noReactDomDeprecatedApis, source, { filename: "src/component.tsx" });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
