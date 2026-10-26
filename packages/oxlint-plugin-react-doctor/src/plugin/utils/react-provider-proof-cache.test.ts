import { describe, expect, it, vi } from "vite-plus/test";
import {
  REACT_PROVIDER_PROOF_SMALL_CASE_COUNT,
  REACT_PROVIDER_PROOF_LARGE_CASE_COUNT,
  REACT_PROVIDER_PROOF_MAX_WORK_GROWTH_RATIO,
} from "../constants/thresholds.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type {
  ScopeAnalysis,
  ScopeDescriptor,
  ReferenceDescriptor,
} from "../semantic/scope-analysis.js";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import {
  hasPossibleStaticPropertyMutationOrEscape,
  hasPossibleStaticPropertyWrite,
  hasPossibleStaticPropertyWriteBefore,
} from "./has-static-property-write-before.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isReadonlyReactNamespaceJsxReference } from "./is-readonly-react-namespace-jsx-reference.js";
import { walkAst } from "./walk-ast.js";

interface ReactProviderTestContext {
  readonly scopes: ScopeAnalysis;
  readonly calls: readonly EsTreeNode[];
  readonly jsx: readonly EsTreeNode[];
}

interface ReactProviderWorkMeasurement {
  readonly work: number;
  readonly accepted: readonly boolean[];
}

interface StaticPropertyAliasFixture {
  readonly name: string;
  readonly source: string;
  readonly hasWrite: boolean;
  readonly before: readonly boolean[];
}

const createContext = (source: string): ReactProviderTestContext => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const scopes = analyzeScopes(parsed.program);
  const calls: EsTreeNode[] = [];
  const jsx: EsTreeNode[] = [];
  walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "CallExpression")) calls.push(node);
    if (
      isNodeOfType(node, "JSXIdentifier") &&
      isNodeOfType(node.parent, "JSXMemberExpression") &&
      node.parent.object === node
    )
      jsx.push(node);
  });
  return { scopes, calls, jsx };
};

const readonlySource =
  'import React from "react";export const Panel=()=>{React.useRef(null);return <React.StrictMode/>;};';

const measureProviderWork = (source: string): ReactProviderWorkMeasurement => {
  const context = createContext(source);
  let work = 0;
  const restoreMethods: (() => void)[] = [];
  const observeReferences = (scope: ScopeDescriptor): void => {
    for (const symbol of scope.symbols) {
      const references = symbol.references;
      const previousEvery = Object.getOwnPropertyDescriptor(references, "every");
      const previousSome = Object.getOwnPropertyDescriptor(references, "some");
      const previousIterator = Object.getOwnPropertyDescriptor(references, Symbol.iterator);
      Object.defineProperty(references, Symbol.iterator, {
        configurable: true,
        value: () => {
          const iterator = references.values();
          return {
            next: () => {
              const result = iterator.next();
              if (!result.done) work += 1;
              return result;
            },
          };
        },
      });
      Object.defineProperty(references, "every", {
        configurable: true,
        value: (
          predicate: (
            reference: ReferenceDescriptor,
            index: number,
            all: ReferenceDescriptor[],
          ) => unknown,
          receiver?: unknown,
        ): boolean =>
          Array.prototype.every.call(
            references,
            (reference: ReferenceDescriptor, index: number, all: ReferenceDescriptor[]) => {
              work += 1;
              return predicate.call(receiver, reference, index, all);
            },
          ),
      });
      Object.defineProperty(references, "some", {
        configurable: true,
        value: (
          predicate: (
            reference: ReferenceDescriptor,
            index: number,
            all: ReferenceDescriptor[],
          ) => unknown,
          receiver?: unknown,
        ): boolean =>
          Array.prototype.some.call(
            references,
            (reference: ReferenceDescriptor, index: number, all: ReferenceDescriptor[]) => {
              work += 1;
              return predicate.call(receiver, reference, index, all);
            },
          ),
      });
      restoreMethods.push(() => {
        if (previousEvery) Object.defineProperty(references, "every", previousEvery);
        else Reflect.deleteProperty(references, "every");
        if (previousSome) Object.defineProperty(references, "some", previousSome);
        else Reflect.deleteProperty(references, "some");
        if (previousIterator) Object.defineProperty(references, Symbol.iterator, previousIterator);
        else Reflect.deleteProperty(references, Symbol.iterator);
      });
    }
    for (const child of scope.children) observeReferences(child);
  };
  observeReferences(context.scopes.rootScope);
  const originalSymbolFor = context.scopes.symbolFor;
  const symbolSpy = vi.spyOn(context.scopes, "symbolFor").mockImplementation((identifier) => {
    work += 1;
    return originalSymbolFor(identifier);
  });
  try {
    const accepted = context.calls.map(
      (call) =>
        isProvenUnmodifiedReactApiCall(call, "useRef", context.scopes) &&
        !hasReactDefaultProviderMutation("useRef", context.scopes),
    );
    return { work, accepted };
  } finally {
    symbolSpy.mockRestore();
    for (const restore of restoreMethods) restore();
  }
};

const geometry = (family: string, count: number): string => {
  const readonlyJsx = Array.from({ length: count }, () => "<React.StrictMode/>").join("");
  if (family === "one-hook-many-jsx") {
    return `import React from "react";export const Panel=()=>{React.useRef(null);return <>${readonlyJsx}</>;};`;
  }
  if (family === "many-hooks-many-jsx" || family === "many-hooks-no-jsx") {
    const callers = Array.from(
      { length: count },
      (_, index) => `export const Panel${index}=()=>{React.useRef(null);return null;};`,
    ).join("");
    return `import React from "react";${callers}${family === "many-hooks-many-jsx" ? `export const Modes=()=> <>${readonlyJsx}</>;` : ""}`;
  }
  return Array.from(
    { length: count },
    (_, index) =>
      `import React${index} from "react";const Alias${index}=React${index};export const Panel${index}=()=>{React${index}.useRef(null);return <Alias${index}.StrictMode/>;};`,
  ).join("");
};

describe("React provider proof cache boundaries", () => {
  it("keeps JSX properties and per-reference shapes separate after warming", () => {
    const context = createContext(
      'import React from "react";React.StrictMode=replacement;export const Panel=()=> <><React.Fragment/><React.StrictMode/><React.Other/></>;',
    );
    const proof = (identifier: EsTreeNode): boolean =>
      isReadonlyReactNamespaceJsxReference(identifier, context.scopes);
    expect(context.jsx.map(proof)).toEqual([true, false, false]);
    expect([...context.jsx].reverse().map(proof)).toEqual([false, false, true]);
  });

  it("checks requested API modes before reusing a property proof", () => {
    const context = createContext(readonlySource);
    expect(isProvenUnmodifiedReactApiCall(context.calls[0], "useRef", context.scopes)).toBe(true);
    expect(isProvenUnmodifiedReactApiCall(context.calls[0], "useState", context.scopes)).toBe(
      false,
    );
    expect(
      isProvenUnmodifiedReactApiCall(
        context.calls[0],
        new Set(["useEffect", "useRef"]),
        context.scopes,
      ),
    ).toBe(true);
    expect(
      isProvenUnmodifiedReactApiCall(context.calls[0], new Set(["useEffect"]), context.scopes),
    ).toBe(false);
    const mutation = createContext(
      'import React from "react";React.useState=replacement;export const Panel=()=>{React.useRef(null);return <React.StrictMode/>;};',
    );
    expect(hasReactDefaultProviderMutation("useRef", mutation.scopes)).toBe(false);
    expect(hasReactDefaultProviderMutation("useState", mutation.scopes)).toBe(true);
    expect(hasReactDefaultProviderMutation("useRef", mutation.scopes)).toBe(false);
  });

  it("separates named-call and namespace-call proofs on the same import", () => {
    const context = createContext(
      'import {default as React} from "react";export const Panel=()=>{React();React.useRef(null);return null;};',
    );
    expect(isProvenUnmodifiedReactApiCall(context.calls[0], "default", context.scopes)).toBe(true);
    expect(isProvenUnmodifiedReactApiCall(context.calls[1], "useRef", context.scopes)).toBe(false);
    expect(isProvenUnmodifiedReactApiCall(context.calls[0], "default", context.scopes)).toBe(true);
  });

  it("separates equivalent symbol IDs in distinct scope analyses and Programs", () => {
    for (const source of [
      readonlySource,
      readonlySource.replace("export const", "React.useRef=replacement;export const"),
      readonlySource,
    ]) {
      const context = createContext(source);
      const expected = source === readonlySource;
      expect(isProvenUnmodifiedReactApiCall(context.calls[0], "useRef", context.scopes)).toBe(
        expected,
      );
      expect(hasReactDefaultProviderMutation("useRef", context.scopes)).toBe(!expected);
    }
  });

  it("never opts generic callers into the JSX readonly callback", () => {
    const context = createContext(readonlySource);
    const call = context.calls[0];
    const identifier = isNodeOfType(call, "CallExpression") ? getRootIdentifier(call.callee) : null;
    if (!identifier) throw new Error("Missing React provider identifier");
    expect(isProvenUnmodifiedReactApiCall(call, "useRef", context.scopes)).toBe(true);
    expect(hasPossibleStaticPropertyMutationOrEscape(identifier, "useRef", context.scopes)).toBe(
      true,
    );
    expect(
      hasPossibleStaticPropertyMutationOrEscape(identifier, "useRef", context.scopes, (reference) =>
        isReadonlyReactNamespaceJsxReference(reference, context.scopes),
      ),
    ).toBe(false);
    expect(hasPossibleStaticPropertyMutationOrEscape(identifier, "useRef", context.scopes)).toBe(
      true,
    );
  });
});

const staticPropertyAliasFixtures: readonly StaticPropertyAliasFixture[] = [
  {
    name: "reverse assignment chains",
    source:
      "const origin={};let third;let second;third=second;second=origin;before(origin);third.value=1;after(origin);",
    hasWrite: true,
    before: [false, true],
  },
  {
    name: "cyclic aliases",
    source:
      "const origin={};let first=origin;let second=first;first=second;before(origin);second.value=1;",
    hasWrite: true,
    before: [false],
  },
  {
    name: "unrelated shadow bindings",
    source:
      "const origin={};const unrelated={};let alias=origin;{let alias=unrelated;alias.value=1;}after(origin);",
    hasWrite: false,
    before: [false],
  },
  {
    name: "unknown computed property writes",
    source: "const origin={};let alias;alias=(origin);alias[key]=1;after(origin);",
    hasWrite: true,
    before: [true],
  },
  {
    name: "multiple assignment sources",
    source:
      "const first={};const second={};let alias;alias=first;alias=second;alias.value=1;after(first);after(second);",
    hasWrite: true,
    before: [true, true],
  },
  {
    name: "unrelated property writes through const aliases",
    source: "const origin={};const second=origin;const third=second;third.other=1;after(origin);",
    hasWrite: false,
    before: [false],
  },
];

describe("static property alias index boundaries", () => {
  it.each(staticPropertyAliasFixtures)("preserves $name and live temporal gates", (fixture) => {
    const context = createContext(fixture.source);
    expect(context.calls).toHaveLength(fixture.before.length);
    for (const [index, call] of context.calls.entries()) {
      if (!isNodeOfType(call, "CallExpression")) throw new Error("Missing marker call");
      const argument = call.arguments[0];
      const identifier = argument ? getRootIdentifier(argument) : null;
      if (!identifier) throw new Error("Missing marker provider");
      expect(hasPossibleStaticPropertyWriteBefore(identifier, "value", call, context.scopes)).toBe(
        fixture.before[index],
      );
      expect(hasPossibleStaticPropertyWrite(identifier, "value", context.scopes)).toBe(
        fixture.hasWrite,
      );
      expect(hasPossibleStaticPropertyMutationOrEscape(identifier, "value", context.scopes)).toBe(
        true,
      );
      expect(
        hasPossibleStaticPropertyMutationOrEscape(identifier, "value", context.scopes, () => true),
      ).toBe(fixture.hasWrite);
      expect(hasPossibleStaticPropertyWriteBefore(identifier, "value", call, context.scopes)).toBe(
        fixture.before[index],
      );
    }
  });
});

describe("React provider proof work growth", () => {
  it.each([
    "one-hook-many-jsx",
    "many-hooks-many-jsx",
    "many-hooks-no-jsx",
    "many-distinct-providers",
  ])("bounds repeated proof work for %s", (family) => {
    const small = measureProviderWork(geometry(family, REACT_PROVIDER_PROOF_SMALL_CASE_COUNT));
    const large = measureProviderWork(geometry(family, REACT_PROVIDER_PROOF_LARGE_CASE_COUNT));
    const expectedSmall =
      family === "one-hook-many-jsx" ? 1 : REACT_PROVIDER_PROOF_SMALL_CASE_COUNT;
    const expectedLarge =
      family === "one-hook-many-jsx" ? 1 : REACT_PROVIDER_PROOF_LARGE_CASE_COUNT;
    expect(small.accepted).toEqual(Array.from({ length: expectedSmall }, () => true));
    expect(large.accepted).toEqual(Array.from({ length: expectedLarge }, () => true));
    expect(small.work).toBeGreaterThan(0);
    expect(large.work).toBeLessThanOrEqual(small.work * REACT_PROVIDER_PROOF_MAX_WORK_GROWTH_RATIO);
  });
});
