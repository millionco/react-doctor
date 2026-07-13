import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall, type ReactApiCallOptions } from "./is-react-api-call.js";
import { walkAst } from "./walk-ast.js";

interface ReactApiCallTestCase {
  code: string;
  expectedCount: number;
  name: string;
  options?: ReactApiCallOptions;
}

const EFFECT_API_NAMES = new Set(["useEffect", "useLayoutEffect"]);

const countReactApiCalls = (code: string, options?: ReactApiCallOptions): number => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  let matchingCallCount = 0;
  walkAst(parsed.program, (node: EsTreeNode) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isReactApiCall(node, EFFECT_API_NAMES, scopes, options)
    ) {
      matchingCallCount += 1;
    }
  });
  return matchingCallCount;
};

describe("isReactApiCall", () => {
  const testCases: ReactApiCallTestCase[] = [
    {
      name: "named React imports",
      code: 'import { useEffect } from "react"; useEffect(() => {});',
      expectedCount: 1,
    },
    {
      name: "renamed React imports",
      code: 'import { useLayoutEffect as useIsoEffect } from "react"; useIsoEffect(() => {});',
      expectedCount: 1,
    },
    {
      name: "immutable named React API aliases",
      code: `import { useEffect as runEffect } from "react";
        const invokeEffect = runEffect as typeof runEffect;
        invokeEffect(() => {});`,
      options: { resolveNamedAliases: true },
      expectedCount: 1,
    },
    {
      name: "default React receivers",
      code: 'import ReactClient from "react"; ReactClient.useEffect(() => {});',
      expectedCount: 1,
    },
    {
      name: "namespace React receivers",
      code: 'import * as ReactClient from "react"; ReactClient.useLayoutEffect(() => {});',
      expectedCount: 1,
    },
    {
      name: "immutable default and namespace React aliases",
      code: `import ReactDefault from "react";
        import * as ReactNamespace from "react";
        const ReactAlias = ReactDefault;
        const ChainedReactAlias = ReactAlias;
        const WrappedReactAlias = ReactNamespace as typeof ReactNamespace;
        ChainedReactAlias.useEffect(() => {});
        WrappedReactAlias.useLayoutEffect(() => {});`,
      expectedCount: 2,
    },
    {
      name: "mutable React aliases",
      code: `import * as ReactNamespace from "react";
        let ReactAlias = ReactNamespace;
        ReactAlias = { useEffect: (callback) => callback() };
        ReactAlias.useEffect(() => {});`,
      expectedCount: 0,
    },
    {
      name: "shadowed immutable React aliases",
      code: `import * as ReactNamespace from "react";
        const ReactAlias = ReactNamespace;
        const run = (ReactAlias) => ReactAlias.useEffect(() => {});
        run({ useEffect: (callback) => callback() });`,
      expectedCount: 0,
    },
    {
      name: "wrapped namespace React receivers",
      code: 'import * as ReactClient from "react"; (ReactClient as any).useEffect(() => {});',
      expectedCount: 1,
    },
    {
      name: "static computed React members",
      code: 'import * as ReactClient from "react"; ReactClient["useEffect"](() => {});',
      expectedCount: 1,
    },
    {
      name: "dynamic computed React members",
      code: 'import * as ReactClient from "react"; const method = "useEffect"; ReactClient[method](() => {});',
      expectedCount: 0,
    },
    {
      name: "named default React imports",
      code: 'import { default as ReactClient } from "react"; ReactClient.useEffect(() => {});',
      expectedCount: 1,
    },
    {
      name: "named default imports from another package",
      code: 'import { default as ReactClient } from "other"; ReactClient.useEffect(() => {});',
      expectedCount: 0,
    },
    {
      name: "destructured React namespace APIs with alias resolution",
      code: `import * as ReactClient from "react";
        const { useEffect } = ReactClient;
        const { useLayoutEffect: runLayoutEffect } = ReactClient;
        useEffect(() => {});
        runLayoutEffect(() => {});`,
      options: { resolveNamedAliases: true },
      expectedCount: 2,
    },
    {
      name: "destructured React namespace APIs by default",
      code: 'import * as ReactClient from "react"; const { useEffect } = ReactClient; useEffect(() => {});',
      expectedCount: 0,
    },
    {
      name: "mutable destructured React namespace APIs",
      code: 'import * as ReactClient from "react"; let { useEffect } = ReactClient; useEffect(() => {});',
      options: { resolveNamedAliases: true },
      expectedCount: 0,
    },
    {
      name: "destructured APIs from another package",
      code: 'import * as OtherClient from "other"; const { useEffect } = OtherClient; useEffect(() => {});',
      options: { resolveNamedAliases: true },
      expectedCount: 0,
    },
    {
      name: "destructured global React APIs when allowed",
      code: "const { useEffect } = React; useEffect(() => {});",
      options: { allowGlobalReactNamespace: true, resolveNamedAliases: true },
      expectedCount: 1,
    },
    {
      name: "destructured global React APIs by default",
      code: "const { useEffect } = React; useEffect(() => {});",
      options: { resolveNamedAliases: true },
      expectedCount: 0,
    },
    {
      name: "same-named imports from another package",
      code: 'import { useEffect } from "other"; useEffect(() => {});',
      expectedCount: 0,
    },
    {
      name: "shadowed named React imports",
      code: `import { useEffect } from "react";
        const run = () => {
          const useEffect = (callback) => callback();
          useEffect(() => {});
        };`,
      expectedCount: 0,
    },
    {
      name: "shadowed React receivers",
      code: `import ReactClient from "react";
        const run = (ReactClient) => ReactClient.useEffect(() => {});`,
      expectedCount: 0,
    },
    {
      name: "unbound bare calls by default",
      code: "useEffect(() => {});",
      expectedCount: 0,
    },
    {
      name: "allowed unbound bare calls",
      code: "useEffect(() => {});",
      options: { allowUnboundBareCalls: true },
      expectedCount: 1,
    },
    {
      name: "global React namespace by default",
      code: "React.useEffect(() => {});",
      expectedCount: 0,
    },
    {
      name: "allowed global React namespace",
      code: "React.useEffect(() => {});",
      options: { allowGlobalReactNamespace: true },
      expectedCount: 1,
    },
  ];

  for (const testCase of testCases) {
    it(testCase.name, () => {
      expect(countReactApiCalls(testCase.code, testCase.options)).toBe(testCase.expectedCount);
    });
  }
});
