import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getControlFlowTest } from "./utils/get-control-flow-test.js";
import { isApiCallFromModules } from "./utils/is-api-call-from-modules.js";
import { resolvesToTslUniform } from "./utils/resolves-to-tsl-uniform.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const TSL_MODULES: ReadonlySet<string> = new Set(["three/tsl", "three/webgpu"]);

const expressionReferencesTslUniformValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  let referencesUniformValue = false;
  walkAst(expression, (candidate) => {
    if (referencesUniformValue) return false;
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      getStaticPropertyName(candidate) === "value" &&
      resolvesToTslUniform(candidate.object, scopes)
    ) {
      referencesUniformValue = true;
      return false;
    }
    if (!isNodeOfType(candidate, "Identifier")) return;
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      symbol.references.some((reference) => reference.flag !== "read")
    ) {
      return;
    }
    visitedSymbolIds.add(symbol.id);
    if (expressionReferencesTslUniformValue(symbol.initializer, scopes, visitedSymbolIds)) {
      referencesUniformValue = true;
      return false;
    }
  });
  return referencesUniformValue;
};

export const threeTslNoJsUniformBranch = defineRule({
  id: "three-tsl-no-js-uniform-branch",
  title: "JavaScript branch reads a TSL uniform value",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Express uniform-dependent shader control flow with TSL If, select, or Loop nodes so it runs on the GPU",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isApiCallFromModules(node, "Fn", TSL_MODULES, context.scopes)) return;
      const callbackArgument = node.arguments[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
      const callback = resolveExactLocalFunction(callbackArgument, context.scopes);
      if (!isFunctionLike(callback)) return;
      const reportedTests = new Set<EsTreeNode>();
      walkFunctionExecution(callback, context.scopes, (candidate) => {
        const controlFlowTest = getControlFlowTest(candidate);
        if (
          !controlFlowTest ||
          !expressionReferencesTslUniformValue(controlFlowTest, context.scopes)
        ) {
          return;
        }
        for (const reportedTest of reportedTests) {
          if (isAstDescendant(controlFlowTest, reportedTest)) return;
        }
        reportedTests.add(controlFlowTest);
        context.report({
          node: controlFlowTest,
          message:
            "This JavaScript branch reads a TSL uniform while the shader graph is built, so later uniform changes cannot change the branch. Use TSL control flow",
        });
      });
    },
  }),
});
