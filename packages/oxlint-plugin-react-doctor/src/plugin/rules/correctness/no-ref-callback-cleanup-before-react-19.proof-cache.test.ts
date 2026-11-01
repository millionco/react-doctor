import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../../test-utils/attach-parent-references.js";
import { parseFixture } from "../../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import * as treeWalk from "../../utils/walk-ast.js";
import { getNativeRefCleanupHookCall } from "./utils/get-native-ref-cleanup-hook-call.js";
import { hasRefCleanupProviderHazard } from "./utils/has-ref-cleanup-provider-hazard.js";

interface ScopedCleanupFixture {
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly declarators: ReadonlyMap<string, EsTreeNodeOfType<"VariableDeclarator">>;
}

const parseScopedCleanupFixture = (source: string): ScopedCleanupFixture => {
  const parsed = parseFixture(source);
  expect(parsed.errors).toEqual([]);
  attachParentReferences(parsed.program);
  const declarators = new Map<string, EsTreeNodeOfType<"VariableDeclarator">>();
  treeWalk.walkAst(parsed.program, (node) => {
    if (isNodeOfType(node, "VariableDeclarator") && isNodeOfType(node.id, "Identifier")) {
      declarators.set(node.id.name, node);
    }
  });
  return { program: parsed.program, scopes: analyzeScopes(parsed.program), declarators };
};

const namedReactCallbacks = `
import { useCallback, useRef } from "react";
export const Component = () => {
  const first = useCallback(() => {}, []);
  const second = useCallback(() => {}, []);
  const saved = useRef(null);
  return [first, second, saved];
};
`;

const providerHazardCases = [
  { source: namedReactCallbacks, hazardous: false },
  { source: 'import React from "react";', hazardous: true },
  { source: 'import * as React from "react";', hazardous: true },
  { source: 'Function("return 1")();', hazardous: true },
  { source: 'Reflect.get(value, "key");', hazardous: true },
  { source: "Object.assign(target, source);", hazardous: true },
  { source: 'const promise = import("./provider");', hazardous: true },
  { source: "window.location;", hazardous: true },
  { source: "new ResizeObserver(() => {});", hazardous: true },
  { source: "new window.ResizeObserver(() => {});", hazardous: false },
  { source: "interface window {} new window.ResizeObserver(() => {});", hazardous: false },
];

const hookCases = [
  { name: "direct named import", source: namedReactCallbacks, callable: true },
  {
    name: "renamed named import",
    source:
      'import { useCallback as callback } from "react"; export const Component = () => { const first = callback(() => {}, []); return first; };',
    callable: true,
  },
  {
    name: "escaped import",
    source:
      'import { useCallback } from "react"; const escaped = useCallback; export const Component = () => { const first = useCallback(() => {}, []); return first; };',
    callable: false,
  },
  {
    name: "optional import call",
    source:
      'import { useCallback } from "react"; const optional = useCallback?.(() => {}, []); export const Component = () => { const first = useCallback(() => {}, []); return first; };',
    callable: false,
  },
  {
    name: "written import",
    source:
      'import { useCallback } from "react"; useCallback = replacement; export const Component = () => { const first = useCallback(() => {}, []); return first; };',
    callable: false,
  },
  {
    name: "written local result",
    source:
      'import { useCallback } from "react"; export const Component = () => { const first = useCallback(() => {}, []); first = replacement; return first; };',
    callable: false,
  },
  {
    name: "non React import",
    source:
      'import { useCallback } from "other"; export const Component = () => { const first = useCallback(() => {}, []); return first; };',
    callable: false,
  },
];

describe("ref cleanup immutable proof caches", () => {
  for (const testCase of providerHazardCases) {
    it(`preserves provider hazard verdict for ${testCase.source}`, () => {
      const fixture = parseScopedCleanupFixture(testCase.source);
      expect(hasRefCleanupProviderHazard(fixture.scopes)).toBe(testCase.hazardous);
      expect(hasRefCleanupProviderHazard(fixture.scopes)).toBe(testCase.hazardous);
    });
  }

  for (const hazardous of [false, true]) {
    it(`walks an immutable program once for cached ${hazardous} hazard verdicts`, () => {
      const fixture = parseScopedCleanupFixture(
        hazardous ? 'import React from "react";' : namedReactCallbacks,
      );
      const traversal = vi.spyOn(treeWalk, "walkAst");
      try {
        expect(hasRefCleanupProviderHazard(fixture.scopes)).toBe(hazardous);
        expect(hasRefCleanupProviderHazard(fixture.scopes)).toBe(hazardous);
        expect(traversal.mock.calls.filter(([root]) => root === fixture.program)).toHaveLength(1);
      } finally {
        traversal.mockRestore();
      }
    });
  }

  it("isolates hazard computations for separate analyses of the same immutable AST", () => {
    const fixture = parseScopedCleanupFixture(namedReactCallbacks);
    const separateScopes = analyzeScopes(fixture.program);
    const traversal = vi.spyOn(treeWalk, "walkAst");
    try {
      expect(hasRefCleanupProviderHazard(fixture.scopes)).toBe(false);
      expect(hasRefCleanupProviderHazard(separateScopes)).toBe(false);
      expect(traversal.mock.calls.filter(([root]) => root === fixture.program)).toHaveLength(2);
    } finally {
      traversal.mockRestore();
    }
  });

  for (const testCase of hookCases) {
    it(`preserves the hook proof for ${testCase.name}`, () => {
      const fixture = parseScopedCleanupFixture(testCase.source);
      const declaration = fixture.declarators.get("first");
      const ownerBody = declaration?.parent?.parent;
      if (!declaration || !ownerBody) throw new Error("Missing hook fixture declaration");
      expect(
        Boolean(
          getNativeRefCleanupHookCall(declaration.id, "useCallback", ownerBody, fixture.scopes),
        ),
      ).toBe(testCase.callable);
      expect(
        Boolean(
          getNativeRefCleanupHookCall(declaration.id, "useCallback", ownerBody, fixture.scopes),
        ),
      ).toBe(testCase.callable);
    });
  }

  for (const escaped of [false, true]) {
    it(`checks shared imported reference shapes once for cached ${!escaped} proofs`, () => {
      const fixture = parseScopedCleanupFixture(
        namedReactCallbacks + (escaped ? "\nconst escaped = useCallback;\n" : ""),
      );
      const declaration = fixture.declarators.get("first");
      const secondDeclaration = fixture.declarators.get("second");
      const ownerBody = declaration?.parent?.parent;
      const call = declaration?.init;
      if (!declaration || !secondDeclaration || !ownerBody || !isNodeOfType(call, "CallExpression"))
        throw new Error("Missing hook fixture call");
      const imported = fixture.scopes.symbolFor(call.callee);
      if (!imported) throw new Error("Missing React import fixture binding");
      const referenceQueries = vi.spyOn(imported.references, "some");
      try {
        expect(
          Boolean(
            getNativeRefCleanupHookCall(declaration.id, "useCallback", ownerBody, fixture.scopes),
          ),
        ).toBe(!escaped);
        expect(
          Boolean(
            getNativeRefCleanupHookCall(
              secondDeclaration.id,
              "useCallback",
              ownerBody,
              fixture.scopes,
            ),
          ),
        ).toBe(!escaped);
        expect(referenceQueries).toHaveBeenCalledTimes(1);
        expect(
          getNativeRefCleanupHookCall(declaration.id, "useRef", ownerBody, fixture.scopes),
        ).toBeNull();
        expect(
          getNativeRefCleanupHookCall(
            declaration.id,
            "useCallback",
            fixture.program,
            fixture.scopes,
          ),
        ).toBeNull();
        expect(
          Boolean(
            getNativeRefCleanupHookCall(declaration.id, "useCallback", ownerBody, fixture.scopes),
          ),
        ).toBe(!escaped);
        expect(referenceQueries).toHaveBeenCalledTimes(1);
      } finally {
        referenceQueries.mockRestore();
      }
    });
  }

  it("keeps imported safety independent across analyses and symbol IDs", () => {
    const accepted = parseScopedCleanupFixture(namedReactCallbacks);
    const rejected = parseScopedCleanupFixture(
      namedReactCallbacks + "\nconst escaped = useCallback;\n",
    );
    const firstAccepted = accepted.declarators.get("first");
    const firstRejected = rejected.declarators.get("first");
    const acceptedOwner = firstAccepted?.parent?.parent;
    const rejectedOwner = firstRejected?.parent?.parent;
    if (!firstAccepted || !firstRejected || !acceptedOwner || !rejectedOwner)
      throw new Error("Missing isolated fixture declarations");
    expect(
      Boolean(
        getNativeRefCleanupHookCall(
          firstAccepted.id,
          "useCallback",
          acceptedOwner,
          accepted.scopes,
        ),
      ),
    ).toBe(true);
    expect(
      getNativeRefCleanupHookCall(firstRejected.id, "useCallback", rejectedOwner, rejected.scopes),
    ).toBeNull();
    expect(
      Boolean(
        getNativeRefCleanupHookCall(
          firstAccepted.id,
          "useCallback",
          acceptedOwner,
          accepted.scopes,
        ),
      ),
    ).toBe(true);
  });
});
