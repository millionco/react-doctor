import { describe, expect, it } from "vite-plus/test";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isReadonlyReactNamespaceJsxReference } from "./is-readonly-react-namespace-jsx-reference.js";
import { walkAst } from "./walk-ast.js";

const source = (
  declaration = 'import React from "react";',
  jsx = "<React.StrictMode><div /></React.StrictMode>",
  additions = "",
): string =>
  `${declaration} ${additions} export const Panel = () => { const timer = React.useRef(null); return ${jsx}; };`;

interface ReactJsxReferenceCase {
  readonly name: string;
  readonly code: string;
  readonly accepted: boolean;
}

const cases: ReadonlyArray<ReactJsxReferenceCase> = [
  { name: "default StrictMode", code: source(), accepted: true },
  {
    name: "default Fragment",
    code: source(undefined, "<React.Fragment><div /></React.Fragment>"),
    accepted: true,
  },
  { name: "namespace StrictMode", code: source('import * as React from "react";'), accepted: true },
  {
    name: "named default",
    code: source('import { default as React } from "react";'),
    accepted: true,
  },
  {
    name: "readonly JSX namespace alias",
    code: source(undefined, "<Alias.StrictMode><div /></Alias.StrictMode>", "const Alias = React;"),
    accepted: true,
  },
  {
    name: "unknown JSX property",
    code: source(undefined, "<React.Other><div /></React.Other>"),
    accepted: false,
  },
  {
    name: "nested JSX property",
    code: source(undefined, "<React.StrictMode.Other />"),
    accepted: false,
  },
  { name: "type-only namespace", code: source('import type React from "react";'), accepted: false },
  { name: "foreign provider", code: source('import React from "other";'), accepted: false },
  {
    name: "mutated hook",
    code: source(undefined, undefined, "React.useRef = () => ({ current: null });"),
    accepted: false,
  },
  {
    name: "replaced JSX provider",
    code: source(undefined, undefined, "React.StrictMode = () => null;"),
    accepted: false,
  },
  {
    name: "accessor provider",
    code: source(
      undefined,
      undefined,
      'React.__defineGetter__("useRef", () => () => ({ current: null }));',
    ),
    accepted: false,
  },
  {
    name: "provider argument escape",
    code: source(undefined, undefined, "configure(React);"),
    accepted: false,
  },
  {
    name: "provider alias write",
    code: source(
      undefined,
      undefined,
      "const Alias = React; Alias.useRef = () => ({ current: null });",
    ),
    accepted: false,
  },
  {
    name: "mutable namespace alias",
    code: source('import DefaultReact from "react"; let React = DefaultReact;'),
    accepted: false,
  },
];

describe("readonly React namespace JSX references", () => {
  it.each(cases)("$name", ({ code, accepted }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const verdicts: boolean[] = [];
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "MemberExpression") &&
        isNodeOfType(node.callee.property, "Identifier") &&
        node.callee.property.name === "useRef"
      ) {
        verdicts.push(
          isProvenUnmodifiedReactApiCall(node, "useRef", scopes) &&
            !hasReactDefaultProviderMutation("useRef", scopes),
        );
      }
    });
    expect(verdicts).toEqual([accepted]);
  });

  it("preserves generic escape refusal unless the exact readonly callback is supplied", () => {
    const parsed = parseFixture(source());
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let observations = 0;
    walkAst(parsed.program, (node) => {
      if (!isNodeOfType(node, "CallExpression")) return;
      const identifier = getRootIdentifier(node.callee);
      if (!identifier) return;
      expect(hasPossibleStaticPropertyMutationOrEscape(identifier, "useRef", scopes)).toBe(true);
      expect(
        hasPossibleStaticPropertyMutationOrEscape(identifier, "useRef", scopes, (reference) =>
          isReadonlyReactNamespaceJsxReference(reference, scopes),
        ),
      ).toBe(false);
      observations += 1;
    });
    expect(observations).toBe(1);
  });
});
