import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { effectNeedsCleanup } from "../rules/state-and-effects/effect-needs-cleanup.js";
import { effectObserverNeedsDisconnect } from "../rules/state-and-effects/effect-observer-needs-disconnect.js";
import { runRule } from "../../test-utils/run-rule.js";
import { createStoredDisposerCleanupProof } from "./create-stored-disposer-cleanup-proof.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import type { Rule } from "./rule.js";
import * as astTraversal from "./walk-ast.js";

interface CleanupProofObservation {
  callback: EsTreeNode;
  cleanupDeclaration: EsTreeNode;
  declarations: ReadonlyArray<ReadonlySet<EsTreeNode> | null>;
}

const safeEffect = (extraSource = ""): string => `
  useEffect(() => {
    let release = () => {};
    const observe = () => () => {};
    release = observe();
    const cleanup = () => release();
    ${extraSource}
    return () => cleanup();
  }, []);
`;

const observeCleanupProofs = (source: string, repetitions: number) => {
  const observations: CleanupProofObservation[] = [];
  const rule: Rule = {
    id: "stored-disposer-eval-cache-probe",
    severity: "warn",
    create: (context) => ({
      CallExpression: (node) => {
        if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "useEffect") return;
        const callback = node.arguments[0];
        if (
          !callback ||
          !isFunctionLike(callback) ||
          !isNodeOfType(callback.body, "BlockStatement")
        )
          return;
        const assignmentStatement = callback.body.body.find(
          (statement) =>
            isNodeOfType(statement, "ExpressionStatement") &&
            isNodeOfType(statement.expression, "AssignmentExpression"),
        );
        const cleanupReturn = callback.body.body.find((statement) =>
          isNodeOfType(statement, "ReturnStatement"),
        );
        if (
          !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
          !isNodeOfType(assignmentStatement.expression, "AssignmentExpression") ||
          !isNodeOfType(cleanupReturn, "ReturnStatement") ||
          !cleanupReturn.argument ||
          !isFunctionLike(cleanupReturn.argument)
        )
          return;
        const cleanupDeclaration = callback.body.body
          .flatMap((statement) =>
            isNodeOfType(statement, "VariableDeclaration") ? statement.declarations : [],
          )
          .find(
            (declaration) =>
              isNodeOfType(declaration.id, "Identifier") && declaration.id.name === "cleanup",
          );
        if (!cleanupDeclaration) return;
        const storageAssignment = assignmentStatement.expression;
        const cleanupFunction = cleanupReturn.argument;
        const factories = Array.from({ length: repetitions }, () =>
          createStoredDisposerCleanupProof({
            context,
            effectCallback: callback,
            storageAssignment,
          }),
        );
        const declarations = factories.map(
          (proof) => proof?.(cleanupFunction, cleanupReturn) ?? null,
        );
        observations.push({ callback, cleanupDeclaration, declarations });
      },
    }),
  };
  const result = runRule(rule, source, {
    filename: "/app/src/observer.cjs",
    includeLocations: true,
  });
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toEqual([]);
  return observations;
};

afterEach(() => vi.restoreAllMocks());

describe("stored disposer callback eval cache", () => {
  it.each([16, 64, 256])(
    "walks one immutable callback once for %s resource proofs",
    (repetitions) => {
      const traversal = vi.spyOn(astTraversal, "walkAst");
      const observations = observeCleanupProofs(safeEffect(), repetitions);
      expect(observations).toHaveLength(1);
      const observation = observations[0];
      expect(observation).toBeDefined();
      if (!observation) return;
      expect(observation.declarations).toHaveLength(repetitions);
      expect(observation.declarations.every((declarations) => declarations !== null)).toBe(true);
      expect(new Set(observation.declarations).size).toBe(repetitions);
      for (const declarations of observation.declarations) {
        expect(declarations?.size).toBe(1);
        expect(declarations?.has(observation.cleanupDeclaration)).toBe(true);
      }
      expect(traversal.mock.calls.filter(([node]) => node === observation.callback)).toHaveLength(
        1,
      );
    },
  );

  it("isolates opposite eval results in separate callback owners", () => {
    const traversal = vi.spyOn(astTraversal, "walkAst");
    const observations = observeCleanupProofs(safeEffect() + safeEffect('eval("void 0");'), 3);
    expect(observations).toHaveLength(2);
    expect(observations[0]?.declarations.every((declarations) => declarations !== null)).toBe(true);
    expect(observations[1]?.declarations.every((declarations) => declarations === null)).toBe(true);
    for (const observation of observations)
      expect(traversal.mock.calls.filter(([node]) => node === observation.callback)).toHaveLength(
        1,
      );
  });

  it.each([
    'const inspectLater = () => eval("void 0");',
    'const inspectLater = (eval) => eval("void 0");',
    '(eval)("void 0");',
  ])("retains the conservative nested and local eval veto: %s", (extraSource) => {
    const observations = observeCleanupProofs(safeEffect(extraSource), 3);
    expect(observations).toHaveLength(1);
    expect(observations[0]?.declarations.every((declarations) => declarations === null)).toBe(true);
  });

  it.each(['globalThis.eval("void 0");', '(0, eval)("void 0");'])(
    "preserves the old helper predicate for %s",
    (extraSource) => {
      const observations = observeCleanupProofs(safeEffect(extraSource), 3);
      expect(observations).toHaveLength(1);
      expect(observations[0]?.declarations.every((declarations) => declarations !== null)).toBe(
        true,
      );
    },
  );

  it("isolates programs with the same callback source ranges", () => {
    const unsafe = observeCleanupProofs(safeEffect('eval("void 0");'), 2);
    const safe = observeCleanupProofs(safeEffect('void("void 0");'), 2);
    expect(unsafe[0]?.declarations.every((declarations) => declarations === null)).toBe(true);
    expect(safe[0]?.declarations.every((declarations) => declarations !== null)).toBe(true);
  });
});

const cleanupRules = [effectNeedsCleanup, effectObserverNeedsDisconnect];

describe.each(cleanupRules)("$id immutable eval-cache diagnostics", (rule) => {
  it.each([
    { name: "safe helper", extraSource: "", expectedCount: 0 },
    {
      name: "nested eval",
      extraSource: 'const inspectLater = () => eval("void 0");',
      expectedCount: 1,
    },
  ])("preserves $name", ({ extraSource, expectedCount }) => {
    const source = `
      import { useEffect } from "react";
      export const Observer = ({ element }) => {
        useEffect(() => {
          let release = () => {};
          const observe = () => {
            const observer = new IntersectionObserver(() => {});
            observer.observe(element);
            return () => observer.disconnect();
          };
          release = observe();
          const cleanup = () => release();
          ${extraSource}
          return () => cleanup();
        }, [element]);
        return null;
      };
    `;
    const result = runRule(rule, source, {
      filename: "/app/src/observer.tsx",
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
  });
});
