import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { attachSourceLocations } from "../../test-utils/attach-source-locations.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { analyzeControlFlow } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import type { RuleContext } from "./rule-context.js";
import { attachParentReferences } from "./attach-parent-references.js";
import { walkAst } from "./walk-ast.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isCoveredByReadonlyMemberAlias } from "./is-covered-by-readonly-member-alias.js";
import {
  MEMBER_ALIAS_SMALL_COMPONENT_COUNT,
  MEMBER_ALIAS_LARGE_COMPONENT_COUNT,
} from "./constants.js";

interface MemberAliasWorkFixture {
  readonly context: RuleContext;
  readonly hooks: EsTreeNodeOfType<"CallExpression">[];
}

const work = vi.hoisted(() => ({
  providerChecks: 0,
  providerReferenceVisits: 0,
  defaultChecks: 0,
  defaultSymbolVisits: 0,
}));

vi.mock("./is-proven-unmodified-react-api-call.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./is-proven-unmodified-react-api-call.js")>();
  return {
    ...original,
    isProvenUnmodifiedReactApiCall: (
      ...args: Parameters<typeof original.isProvenUnmodifiedReactApiCall>
    ) => {
      work.providerChecks += 1;
      const [call, , scopes] = args;
      const provider = isNodeOfType(call, "CallExpression") ? scopes.symbolFor(call.callee) : null;
      if (!provider) throw new Error("Expected actual named provider");
      const originalSome = provider.references.some.bind(provider.references);
      const referenceScan = vi.spyOn(provider.references, "some").mockImplementation((predicate) =>
        originalSome((reference, index, references) => {
          work.providerReferenceVisits += 1;
          return predicate(reference, index, references);
        }),
      );
      try {
        return original.isProvenUnmodifiedReactApiCall(...args);
      } finally {
        referenceScan.mockRestore();
      }
    },
  };
});

vi.mock("./has-react-default-provider-mutation.js", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("./has-react-default-provider-mutation.js")>();
  return {
    ...original,
    hasReactDefaultProviderMutation: (
      ...args: Parameters<typeof original.hasReactDefaultProviderMutation>
    ) => {
      work.defaultChecks += 1;
      const symbols = args[1].rootScope.symbols;
      const originalSome = symbols.some.bind(symbols);
      const symbolScan = vi.spyOn(symbols, "some").mockImplementation((predicate) =>
        originalSome((symbol, index, entries) => {
          work.defaultSymbolVisits += 1;
          return predicate(symbol, index, entries);
        }),
      );
      try {
        return original.hasReactDefaultProviderMutation(...args);
      } finally {
        symbolScan.mockRestore();
      }
    },
  };
});

const buildFixture = (
  componentCount: number,
  providers = ["useMemo"],
  suffix = "",
): MemberAliasWorkFixture => {
  const source = `import { ${providers.map((provider) => `useMemo as ${provider}`).join(", ")} } from "react";
    ${Array.from(
      { length: componentCount },
      (_, index) => `
      const selectLabels${index} = source => source.labels;
      export const Panel${index} = ({ settings }) => {
        const snapshot = settings.labels;
        const result = ${providers[index % providers.length]}(() => selectLabels${index}(settings), [snapshot]);
        return null;
      };`,
    ).join("\n")}
    ${suffix}`;
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  attachSourceLocations(parsed.program, source);
  const scopes = analyzeScopes(parsed.program);
  const cfg = analyzeControlFlow(parsed.program);
  const hooks: EsTreeNodeOfType<"CallExpression">[] = [];
  walkAst(parsed.program, (node) => {
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      providers.includes(node.callee.name)
    )
      hooks.push(node);
  });
  expect(hooks).toHaveLength(componentCount);
  return { hooks, context: { scopes, cfg, report: () => {} } };
};

const evaluateFixture = (fixture: MemberAliasWorkFixture): boolean[] =>
  fixture.hooks.map((hookCall) => {
    const callback = hookCall.arguments[0];
    const dependencies = hookCall.arguments[1];
    if (
      !isNodeOfType(callback, "ArrowFunctionExpression") ||
      !isNodeOfType(callback.body, "CallExpression") ||
      !isNodeOfType(dependencies, "ArrayExpression")
    )
      throw new Error("Invalid invented Hook fixture");
    const argument = callback.body.arguments[0];
    if (!isNodeOfType(argument, "Identifier")) throw new Error("Invalid invented root");
    const rootReference = fixture.context.scopes.referenceFor(argument);
    if (!rootReference) throw new Error("Missing actual root reference");
    return isCoveredByReadonlyMemberAlias({
      hookCall,
      callback,
      dependencies,
      missingKey: "settings.labels",
      rootReference,
      admittedKeys: new Set(["settings.labels"]),
      context: fixture.context,
    });
  });

beforeEach(() => {
  work.providerChecks = 0;
  work.providerReferenceVisits = 0;
  work.defaultChecks = 0;
  work.defaultSymbolVisits = 0;
});

describe("readonly member alias provider work", () => {
  it("amortizes actual provider reference and module scans across one and eight eligible components", () => {
    const small = buildFixture(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
    expect(evaluateFixture(small)).toEqual(small.hooks.map(() => true));
    const smallWork = { ...work };
    work.providerChecks = 0;
    work.providerReferenceVisits = 0;
    work.defaultChecks = 0;
    work.defaultSymbolVisits = 0;
    const large = buildFixture(MEMBER_ALIAS_LARGE_COMPONENT_COUNT);
    expect(evaluateFixture(large)).toEqual(large.hooks.map(() => true));
    expect(work.providerChecks).toBe(smallWork.providerChecks);
    expect(work.defaultChecks).toBe(smallWork.defaultChecks);
    expect(work.providerReferenceVisits).toBe(MEMBER_ALIAS_LARGE_COMPONENT_COUNT);
    expect(work.defaultSymbolVisits).toBe(large.context.scopes.rootScope.symbols.length);
    expect(smallWork.providerReferenceVisits).toBe(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
    expect(smallWork.defaultSymbolVisits).toBe(small.context.scopes.rootScope.symbols.length);
  });

  it("keeps separate provider bindings while sharing the module scan", () => {
    const providers = ["firstMemo", "secondMemo"];
    const fixture = buildFixture(MEMBER_ALIAS_LARGE_COMPONENT_COUNT, providers);
    expect(evaluateFixture(fixture)).toEqual(fixture.hooks.map(() => true));
    expect(work.providerChecks).toBe(providers.length);
    expect(work.providerReferenceVisits).toBe(MEMBER_ALIAS_LARGE_COMPONENT_COUNT);
    expect(work.defaultChecks).toBe(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
  });

  it("caches a false named-provider proof", () => {
    const fixture = buildFixture(
      MEMBER_ALIAS_LARGE_COMPONENT_COUNT,
      ["useMemo"],
      "sendAway(useMemo);",
    );
    expect(evaluateFixture(fixture)).toEqual(fixture.hooks.map(() => false));
    expect(work.providerChecks).toBe(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
    expect(work.defaultChecks).toBe(0);
  });

  it("caches a true default-provider mutation", () => {
    const fixture = buildFixture(
      MEMBER_ALIAS_LARGE_COMPONENT_COUNT,
      ["useMemo"],
      'import React from "react"; React.useMemo = replacement;',
    );
    expect(evaluateFixture(fixture)).toEqual(fixture.hooks.map(() => false));
    expect(work.providerChecks).toBe(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
    expect(work.defaultChecks).toBe(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
  });

  it("does not let a false binding poison a second provider", () => {
    const providers = ["firstMemo", "secondMemo"];
    const fixture = buildFixture(
      MEMBER_ALIAS_LARGE_COMPONENT_COUNT,
      providers,
      "sendAway(firstMemo);",
    );
    expect(evaluateFixture(fixture)).toEqual(
      fixture.hooks.map((_, index) => index % providers.length !== 0),
    );
    expect(work.providerChecks).toBe(providers.length);
    expect(work.defaultChecks).toBe(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
  });

  it("isolates a fresh scopes analysis for the same Program", () => {
    const fixture = buildFixture(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
    expect(evaluateFixture(fixture)).toEqual([true]);
    const scopes = analyzeScopes(fixture.context.scopes.rootScope.node);
    expect(
      evaluateFixture({ hooks: fixture.hooks, context: { ...fixture.context, scopes } }),
    ).toEqual([true]);
    expect(work.providerChecks).toBe(
      MEMBER_ALIAS_SMALL_COMPONENT_COUNT + MEMBER_ALIAS_SMALL_COMPONENT_COUNT,
    );
    expect(work.defaultChecks).toBe(
      MEMBER_ALIAS_SMALL_COMPONENT_COUNT + MEMBER_ALIAS_SMALL_COMPONENT_COUNT,
    );
  });

  it("isolates a new Program behind the same scopes facade", () => {
    const clean = buildFixture(MEMBER_ALIAS_SMALL_COMPONENT_COUNT);
    const changed = buildFixture(
      MEMBER_ALIAS_SMALL_COMPONENT_COUNT,
      ["useMemo"],
      'import React from "react"; React.useMemo = replacement;',
    );
    let current = clean.context.scopes;
    const scopes: ScopeAnalysis = {
      get rootScope() {
        return current.rootScope;
      },
      scopeFor: (node) => current.scopeFor(node),
      ownScopeFor: (node) => current.ownScopeFor(node),
      symbolFor: (node) => current.symbolFor(node),
      referenceFor: (node) => current.referenceFor(node),
      isGlobalReference: (node) => current.isGlobalReference(node),
    };
    expect(evaluateFixture({ hooks: clean.hooks, context: { ...clean.context, scopes } })).toEqual([
      true,
    ]);
    current = changed.context.scopes;
    expect(
      evaluateFixture({ hooks: changed.hooks, context: { ...changed.context, scopes } }),
    ).toEqual([false]);
    expect(work.providerChecks).toBe(
      MEMBER_ALIAS_SMALL_COMPONENT_COUNT + MEMBER_ALIAS_SMALL_COMPONENT_COUNT,
    );
    expect(work.defaultChecks).toBe(
      MEMBER_ALIAS_SMALL_COMPONENT_COUNT + MEMBER_ALIAS_SMALL_COMPONENT_COUNT,
    );
  });
});
