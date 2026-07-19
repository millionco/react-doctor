import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";
import { isApiCallFromModules } from "./utils/is-api-call-from-modules.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { R3F_WEBGPU_MODULES } from "./utils/r3f-webgpu-modules.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";

const WEBGPU_GRAPH_HOOKS = new Set([
  "useLocalNodes",
  "useNodes",
  "usePostProcessing",
  "useRenderPipeline",
]);
const WEBGPU_TWO_CALLBACK_HOOKS: ReadonlySet<string> = new Set([
  "usePostProcessing",
  "useRenderPipeline",
]);
const TSL_UNIFORM_MODULES: ReadonlySet<string> = new Set(["three/tsl", "three/webgpu"]);

const resolvesToTslUniform = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (isApiCallFromModules(candidate, "uniform", TSL_UNIFORM_MODULES, scopes)) return true;
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = scopes.symbolFor(candidate);
  if (
    symbol?.kind !== "const" ||
    !symbol.initializer ||
    visitedSymbolIds.has(symbol.id) ||
    symbol.references.some((reference) => reference.flag !== "read")
  ) {
    return false;
  }
  visitedSymbolIds.add(symbol.id);
  return resolvesToTslUniform(symbol.initializer, scopes, visitedSymbolIds);
};

const isUniformValueMember = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    getStaticPropertyName(candidate) !== "value"
  ) {
    return false;
  }
  let current = stripParenExpression(candidate.object);
  if (resolvesToTslUniform(current, scopes)) return true;
  while (true) {
    if (isR3fCallbackStateProperty(current, callback, "uniforms", scopes)) return true;
    if (!isNodeOfType(current, "MemberExpression")) return false;
    current = stripParenExpression(current.object);
  }
};

const expressionReferencesUniformValue = (
  expression: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  let didFindUniformValue = false;
  walkAst(expression, (candidate) => {
    if (didFindUniformValue) return false;
    if (isUniformValueMember(candidate, callback, scopes)) {
      didFindUniformValue = true;
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
    if (expressionReferencesUniformValue(symbol.initializer, callback, scopes, visitedSymbolIds)) {
      didFindUniformValue = true;
      return false;
    }
  });
  return didFindUniformValue;
};

const getControlFlowTest = (node: EsTreeNode): EsTreeNode | null => {
  if (
    isNodeOfType(node, "IfStatement") ||
    isNodeOfType(node, "WhileStatement") ||
    isNodeOfType(node, "DoWhileStatement") ||
    isNodeOfType(node, "ConditionalExpression")
  ) {
    return node.test;
  }
  if (isNodeOfType(node, "SwitchStatement")) return node.discriminant;
  if (isNodeOfType(node, "ForStatement")) return node.test;
  if (isNodeOfType(node, "LogicalExpression")) return node.left;
  return null;
};

const getWebgpuGraphHookName = (node: EsTreeNode, context: RuleContext): string | null => {
  for (const hookName of WEBGPU_GRAPH_HOOKS) {
    if (isApiCallFromModules(node, hookName, R3F_WEBGPU_MODULES, context.scopes)) {
      return hookName;
    }
  }
  return null;
};

export const r3fWebgpuNoJsUniformBranch = defineRule({
  id: "r3f-webgpu-no-js-uniform-branch",
  title: "JavaScript branch reads a TSL uniform value",
  category: "Correctness",
  requires: ["r3f:10"],
  severity: "warn",
  recommendation:
    "Express uniform-dependent control flow with TSL If, select, or Loop nodes so it runs on the GPU",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const hookName = getWebgpuGraphHookName(node, context);
      if (!hookName) return;
      const callbackArguments = WEBGPU_TWO_CALLBACK_HOOKS.has(hookName)
        ? node.arguments.slice(0, 2)
        : [node.arguments[0]];
      for (const callbackArgument of callbackArguments) {
        if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) continue;
        const callback = resolveLocalReactCallback(callbackArgument, context.scopes);
        if (!isFunctionLike(callback)) continue;
        const reportedControlFlowTests = new Set<EsTreeNode>();
        walkFunctionExecution(callback, context.scopes, (candidate) => {
          const controlFlowTest = getControlFlowTest(candidate);
          if (
            !controlFlowTest ||
            !expressionReferencesUniformValue(controlFlowTest, callback, context.scopes)
          ) {
            return;
          }
          for (const reportedTest of reportedControlFlowTests) {
            if (isAstDescendant(controlFlowTest, reportedTest)) return;
          }
          reportedControlFlowTests.add(controlFlowTest);
          context.report({
            node: controlFlowTest,
            message:
              "This JavaScript branch reads a TSL uniform while the node graph is built, so later uniform changes cannot change the branch. Use TSL control flow",
          });
        });
      }
    },
  }),
});
