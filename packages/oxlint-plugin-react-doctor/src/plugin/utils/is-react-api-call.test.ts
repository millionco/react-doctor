import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall, type ReactApiCallOptions } from "./is-react-api-call.js";
import { isReactHookCall } from "./is-react-hook-call.js";
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

const countReactHookCalls = (code: string): number => {
  const parsed = parseFixture(code);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  let matchingCallCount = 0;
  walkAst(parsed.program, (node: EsTreeNode) => {
    if (isNodeOfType(node, "CallExpression") && isReactHookCall(node, EFFECT_API_NAMES, scopes)) {
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
      name: "conditional aliases whose branches are React APIs",
      code: `import { useEffect, useLayoutEffect } from "react";
        const useIsomorphicLayoutEffect =
          typeof window !== "undefined" ? useLayoutEffect : useEffect;
        useIsomorphicLayoutEffect(() => {});`,
      options: { resolveConditionalAliases: true, resolveNamedAliases: true },
      expectedCount: 1,
    },
    {
      name: "conditional aliases with an opaque branch",
      code: `import { useEffect } from "react";
        const useMaybeEffect = Math.random() > 0.5 ? useEffect : useCustomEffect;
        useMaybeEffect(() => {});`,
      options: { resolveConditionalAliases: true, resolveNamedAliases: true },
      expectedCount: 0,
    },
    {
      name: "multi-hop aliases of conditional React APIs",
      code: `import * as ReactClient from "react";
        const useIsomorphicLayoutEffect =
          typeof window !== "undefined" ? ReactClient.useLayoutEffect : ReactClient.useEffect;
        const useAliasedEffect = useIsomorphicLayoutEffect;
        useAliasedEffect(() => {});`,
      options: { resolveConditionalAliases: true, resolveNamedAliases: true },
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

describe("isReactHookCall", () => {
  it.each([
    [
      "a named import alias",
      'import { useEffect as runEffect } from "react"; runEffect(() => {});',
      1,
    ],
    [
      "an immutable local alias",
      'import { useEffect } from "react"; const runEffect = useEffect; runEffect(() => {});',
      1,
    ],
    [
      "an isomorphic alias",
      `import * as React from "react";
      const runEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
      runEffect(() => {});`,
      1,
    ],
    ["an unbound fixture hook", "useEffect(() => {});", 1],
    [
      "a userland same-name function",
      "const useEffect = (callback) => callback(); useEffect(() => {});",
      0,
    ],
    [
      "a mutable alias",
      `import { useEffect } from "react";
      let runEffect = useEffect;
      runEffect = (callback) => callback();
      runEffect(() => {});`,
      0,
    ],
    [
      "a shadowed import",
      `import { useEffect } from "react";
      const run = (useEffect) => useEffect(() => {});
      run((callback) => callback());`,
      0,
    ],
  ])("classifies %s", (_name, code, expectedCount) => {
    expect(countReactHookCalls(code)).toBe(expectedCount);
  });
});
