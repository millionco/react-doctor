import { describe, expect, it, vi } from "vite-plus/test";
import { attachParentReferences } from "../../test-utils/attach-parent-references.js";
import {
  PROVIDER_PROOF_LARGE_COMPONENT_COUNT,
  PROVIDER_PROOF_SMALL_COMPONENT_COUNT,
} from "../../test-utils/constants.js";
import { parseFixture } from "../../test-utils/parse-fixture.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { hasGlobalIdentifierWriteBefore } from "./has-global-identifier-write-before.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { walkAst } from "./walk-ast.js";

describe("global identifier write-before proof", () => {
  it.each([
    { code: "clearInterval(handle);", name: "clearInterval", expected: [false] },
    {
      code: "interface clearInterval {} clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "type clearInterval = unknown; clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "const replacement = () => {}; clearInterval = replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "interface clearInterval {} const replacement = () => {}; clearInterval = replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "type clearInterval = unknown; clearInterval = replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "({ cancel: clearInterval } = replacement); clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "[clearInterval] = replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "clearInterval++; clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "clearInterval += replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "function unrelated(clearInterval) { clearInterval = replacement; } clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "{ let clearInterval; clearInterval = replacement; } clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "{ let clearInterval; interface clearInterval {} clearInterval = replacement; } clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "clearInterval.extra = replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "clearTimeout = replacement; clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "function unrelated() { clearInterval = replacement; } clearInterval(handle);",
      name: "clearInterval",
      expected: [false],
    },
    {
      code: "function rewrite() { clearInterval = replacement; } rewrite(); clearInterval(handle);",
      name: "clearInterval",
      expected: [true],
    },
    {
      code: "clearTimeout = replacement; clearTimeout(handle);",
      name: "clearTimeout",
      expected: [true],
    },
    {
      code: "cancelAnimationFrame = replacement; cancelAnimationFrame(handle);",
      name: "cancelAnimationFrame",
      expected: [true],
    },
    {
      code: "clearInterval(before); clearInterval = replacement; clearInterval(after);",
      name: "clearInterval",
      expected: [false, true],
    },
  ])("keeps binding and execution proof fresh for $code", ({ code, name, expected }) => {
    const parsed = parseFixture(code);
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    const references: EsTreeNode[] = [];
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === name
      )
        references.push(node.callee);
    });
    expect(references.length).toBe(expected.length);
    expect(
      references.map((reference) => hasGlobalIdentifierWriteBefore(name, reference, scopes)),
    ).toEqual(expected);
    expect(
      [...references]
        .reverse()
        .map((reference) => hasGlobalIdentifierWriteBefore(name, reference, scopes)),
    ).toEqual([...expected].reverse());
  });

  it.each([0, PROVIDER_PROOF_SMALL_COMPONENT_COUNT, PROVIDER_PROOF_LARGE_COMPONENT_COUNT])(
    "builds one reference census for %s untouched cleanup references",
    (readCount) => {
      const code = Array.from(
        { length: readCount },
        (_, readIndex) => `clearInterval(handle${readIndex});`,
      ).join("\n");
      const parsed = parseFixture(code);
      expect(parsed.errors).toEqual([]);
      attachParentReferences(parsed.program);
      const scopes = analyzeScopes(parsed.program);
      const references: EsTreeNode[] = [];
      walkAst(parsed.program, (node) => {
        if (
          isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "clearInterval"
        )
          references.push(node.callee);
      });
      const censusReads = vi.spyOn(scopes.rootScope.references, Symbol.iterator);
      const firstReference = references.at(0) ?? parsed.program;
      expect(hasGlobalIdentifierWriteBefore("clearInterval", firstReference, scopes)).toBe(false);
      expect(censusReads).toHaveBeenCalledTimes(1);
      censusReads.mockClear();
      expect(
        references.map((reference) =>
          hasGlobalIdentifierWriteBefore("clearInterval", reference, scopes),
        ),
      ).toEqual(references.map(() => false));
      expect(censusReads).not.toHaveBeenCalled();
      const freshScopes = analyzeScopes(parsed.program);
      const freshCensusReads = vi.spyOn(freshScopes.rootScope.references, Symbol.iterator);
      expect(hasGlobalIdentifierWriteBefore("clearInterval", firstReference, freshScopes)).toBe(
        false,
      );
      expect(freshCensusReads).toHaveBeenCalledTimes(1);
      censusReads.mockRestore();
      freshCensusReads.mockRestore();
    },
  );

  it("does not memo provider or execution answers after the census is warm", () => {
    const parsed = parseFixture(
      "interface clearInterval {} clearInterval = replacement; clearInterval(handle);",
    );
    expect(parsed.errors).toEqual([]);
    attachParentReferences(parsed.program);
    const scopes = analyzeScopes(parsed.program);
    let referenceNode: EsTreeNode | undefined;
    walkAst(parsed.program, (node) => {
      if (
        isNodeOfType(node, "CallExpression") &&
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "clearInterval"
      )
        referenceNode = node.callee;
    });
    expect(referenceNode).toBeDefined();
    if (!referenceNode) throw new Error("Missing native cleanup reference");
    expect(hasGlobalIdentifierWriteBefore("clearInterval", referenceNode, scopes)).toBe(true);
    const nativeEligibility = vi.spyOn(scopes, "isGlobalReference");
    const bindingLookup = vi.spyOn(scopes, "symbolFor");
    expect(hasGlobalIdentifierWriteBefore("clearInterval", referenceNode, scopes)).toBe(true);
    expect(nativeEligibility).toHaveBeenCalled();
    expect(bindingLookup).toHaveBeenCalled();
    nativeEligibility.mockRestore();
    bindingLookup.mockRestore();
  });

  it("keys census lifetime by actual analysis, root scope and Program", () => {
    const clean = parseFixture("clearInterval(handle);");
    const written = parseFixture("clearInterval = replacement; clearInterval(handle);");
    expect(clean.errors).toEqual([]);
    expect(written.errors).toEqual([]);
    attachParentReferences(clean.program);
    attachParentReferences(written.program);
    const cleanScopes = analyzeScopes(clean.program);
    const writtenScopes = analyzeScopes(written.program);
    let activeScopes = cleanScopes;
    const borrowedScopes: ScopeAnalysis = {
      get rootScope() {
        return activeScopes.rootScope;
      },
      scopeFor: (node) => activeScopes.scopeFor(node),
      ownScopeFor: (node) => activeScopes.ownScopeFor(node),
      symbolFor: (node) => activeScopes.symbolFor(node),
      referenceFor: (node) => activeScopes.referenceFor(node),
      isGlobalReference: (node) => activeScopes.isGlobalReference(node),
    };
    if (!isNodeOfType(clean.program, "Program") || !isNodeOfType(written.program, "Program"))
      throw new Error("Expected fixture Program roots");
    const cleanCall = clean.program.body.find((node) => isNodeOfType(node, "ExpressionStatement"));
    const writtenCall = written.program.body.findLast((node) =>
      isNodeOfType(node, "ExpressionStatement"),
    );
    if (!cleanCall || !writtenCall) throw new Error("Missing provider call fixture");
    expect(hasGlobalIdentifierWriteBefore("clearInterval", cleanCall, borrowedScopes)).toBe(false);
    activeScopes = analyzeScopes(clean.program);
    const sameProgramFreshRootReads = vi.spyOn(activeScopes.rootScope.references, Symbol.iterator);
    expect(hasGlobalIdentifierWriteBefore("clearInterval", cleanCall, borrowedScopes)).toBe(false);
    expect(sameProgramFreshRootReads).toHaveBeenCalledTimes(1);
    sameProgramFreshRootReads.mockRestore();
    activeScopes = writtenScopes;
    expect(hasGlobalIdentifierWriteBefore("clearInterval", writtenCall, borrowedScopes)).toBe(true);
    activeScopes = cleanScopes;
    expect(hasGlobalIdentifierWriteBefore("clearInterval", cleanCall, borrowedScopes)).toBe(false);
  });
});
