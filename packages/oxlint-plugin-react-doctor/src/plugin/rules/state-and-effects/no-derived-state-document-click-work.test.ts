import { describe, expect, it, vi } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { defineRule } from "../../utils/define-rule.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import * as astWalker from "../../utils/walk-ast.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { hasFiniteDocumentListenerProvider } from "./utils/has-finite-document-listener-provider.js";
import { hasUserInputSetterWriter } from "./utils/has-user-input-setter-writer.js";
import fixtures from "./no-derived-state-document-click-fixtures.json";

const REPEATED_WITNESS_CHECK_COUNT = 100;
const source = fixtures[0].source;

it("indexes binding scopes once across repeated native witness checks", () => {
  let scopeReads = 0;
  let writerChecks = 0;
  let hookReferenceReads = 0;
  const rule = defineRule({
    id: "document-writer-work-check",
    title: "Document writer work check",
    severity: "warn",
    recommendation: "Test scope indexing.",
    create: (context) => ({
      Program(program) {
        const analysis = getProgramAnalysis(program);
        if (!analysis) throw new Error("Missing program analysis");
        const scopes = analysis.scopeManager.scopes;
        const hookVariable = scopes
          .flatMap((scope) => scope.variables)
          .find((variable) => variable.name === "useEffect");
        if (!hookVariable) throw new Error("Missing hook variable");
        const hookReferences = hookVariable.references;
        Object.defineProperty(hookVariable, "references", {
          get: () => {
            hookReferenceReads += 1;
            return hookReferences;
          },
        });
        Object.defineProperty(analysis.scopeManager, "scopes", {
          get: () => {
            scopeReads += 1;
            return scopes;
          },
        });
      },
      CallExpression(call) {
        if (!isNodeOfType(call.callee, "Identifier") || call.callee.name !== "useEffect") return;
        const setup = call.arguments[0];
        if (!isNodeOfType(setup, "ArrowFunctionExpression")) return;
        const setterCall = setup.body;
        if (!isNodeOfType(setterCall, "CallExpression")) return;
        const analysis = getProgramAnalysis(call);
        const setterReference = analysis?.referenceByIdentifier.get(setterCall.callee);
        if (!analysis || !setterReference) throw new Error("Missing setter reference");
        for (let checkIndex = 0; checkIndex < REPEATED_WITNESS_CHECK_COUNT; checkIndex += 1) {
          expect(hasUserInputSetterWriter(analysis, context, setterReference, call, true)).toBe(
            true,
          );
          expect(hasUserInputSetterWriter(analysis, context, setterReference, call, false)).toBe(
            false,
          );
          writerChecks += 1;
        }
      },
    }),
  });
  expect(runRule(rule, source).parseErrors).toEqual([]);
  expect(writerChecks).toBe(REPEATED_WITNESS_CHECK_COUNT);
  expect(scopeReads).toBe(1);
  expect(hookReferenceReads).toBe(1);
});

describe("document provider cache", () => {
  it("visits the program once and isolates accepted and rejected programs", () => {
    const originalWalk = astWalker.walkAst;
    let visitedNodes = 0;
    const walker = vi.spyOn(astWalker, "walkAst").mockImplementation((node, visit) => {
      originalWalk(node, (child) => {
        visitedNodes += 1;
        return visit(child);
      });
    });
    const rule = defineRule({
      id: "document-provider-work-check",
      title: "Document provider work check",
      severity: "warn",
      recommendation: "Test provider caching.",
      create: (context) => ({
        Program(program) {
          const analysis = getProgramAnalysis(program);
          if (!analysis) throw new Error("Missing program analysis");
          const accepted = hasFiniteDocumentListenerProvider(analysis, context);
          const initialVisitedNodes = visitedNodes;
          for (let checkIndex = 0; checkIndex < REPEATED_WITNESS_CHECK_COUNT; checkIndex += 1) {
            expect(hasFiniteDocumentListenerProvider(analysis, context)).toBe(accepted);
          }
          expect(visitedNodes).toBe(initialVisitedNodes);
          expect(accepted).toBe(!sourceWithGlobalRoot.has(program));
        },
      }),
    });
    const sourceWithGlobalRoot = new WeakSet<object>();
    const rejectingRule = defineRule({
      ...rule,
      create: (context) => {
        const visitors = rule.create(context);
        return {
          ...visitors,
          Program(program) {
            sourceWithGlobalRoot.add(program);
            const visitor = visitors.Program;
            if (typeof visitor === "function") visitor(program);
          },
        };
      },
    });
    try {
      expect(runRule(rule, source).parseErrors).toEqual([]);
      expect(walker).toHaveBeenCalledTimes(1);
      expect(visitedNodes).toBeGreaterThan(0);
      expect(runRule(rejectingRule, source + "\nconst root = globalThis;").parseErrors).toEqual([]);
      expect(walker).toHaveBeenCalledTimes(2);
      expect(runRule(rule, source).parseErrors).toEqual([]);
      expect(walker).toHaveBeenCalledTimes(3);
    } finally {
      walker.mockRestore();
    }
  });
});
