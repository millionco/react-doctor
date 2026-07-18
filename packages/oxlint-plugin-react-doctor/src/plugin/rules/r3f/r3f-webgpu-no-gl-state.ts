import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isApiCallFromModules } from "./utils/is-api-call-from-modules.js";
import { isR3fCallbackStateProperty } from "./utils/is-r3f-callback-state-property.js";
import { R3F_WEBGPU_MODULES } from "./utils/r3f-webgpu-modules.js";
import { resolveLocalReactCallback } from "./utils/resolve-local-react-callback.js";

const isWebgpuUseThreeResult = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const candidate = stripParenExpression(expression);
  if (
    isNodeOfType(candidate, "CallExpression") &&
    candidate.arguments.length === 0 &&
    isApiCallFromModules(candidate, "useThree", R3F_WEBGPU_MODULES, scopes)
  ) {
    return true;
  }
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
  return isWebgpuUseThreeResult(symbol.initializer, scopes, visitedSymbolIds);
};

const findGlPropertyInPattern = (pattern: EsTreeNode): EsTreeNodeOfType<"Property"> | null => {
  if (!isNodeOfType(pattern, "ObjectPattern")) return null;
  for (const property of pattern.properties) {
    if (
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "gl"
    ) {
      return property;
    }
  }
  return null;
};

const findCallbackGlRead = (callback: EsTreeNode, context: RuleContext): EsTreeNode | null => {
  if (!isFunctionLike(callback)) return null;
  const firstParameter = callback.params[0];
  const parameterPattern = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  const directProperty = parameterPattern ? findGlPropertyInPattern(parameterPattern) : null;
  if (directProperty) return directProperty;
  let glRead: EsTreeNode | null = null;
  walkAst(callback.body, (candidate) => {
    if (glRead) return false;
    if (candidate !== callback.body && isFunctionLike(candidate)) return false;
    if (
      isNodeOfType(candidate, "MemberExpression") &&
      getStaticPropertyName(candidate) === "gl" &&
      isR3fCallbackStateProperty(candidate, callback, "gl", context.scopes)
    ) {
      glRead = candidate;
      return false;
    }
    if (!isNodeOfType(candidate, "VariableDeclarator") || !candidate.init) return;
    const glProperty = findGlPropertyInPattern(candidate.id);
    if (
      !glProperty ||
      !isR3fCallbackStateProperty(glProperty.value, callback, "gl", context.scopes)
    ) {
      return;
    }
    glRead = glProperty;
    return false;
  });
  return glRead;
};

export const r3fWebgpuNoGlState = defineRule({
  id: "r3f-webgpu-no-gl-state",
  title: "WebGPU root reads deprecated gl state",
  category: "Correctness",
  requires: ["r3f:10"],
  severity: "warn",
  recommendation: "Read state.renderer from the R3F WebGPU root instead of state.gl",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const isUseThree = isApiCallFromModules(node, "useThree", R3F_WEBGPU_MODULES, context.scopes);
      const isUseFrame = isApiCallFromModules(node, "useFrame", R3F_WEBGPU_MODULES, context.scopes);
      if (!isUseThree && !isUseFrame) return;
      const callbackArgument = node.arguments[0];
      if (!callbackArgument || isNodeOfType(callbackArgument, "SpreadElement")) return;
      const callback = resolveLocalReactCallback(callbackArgument, context.scopes);
      if (!callback) return;
      const glRead = findCallbackGlRead(callback, context);
      if (!glRead) return;
      context.report({
        node: glRead,
        message:
          "The WebGPU root exposes state.gl only as a deprecated compatibility alias, which can be mistaken for a WebGLRenderer. Read state.renderer instead",
      });
    },
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      if (
        getStaticPropertyName(node) !== "gl" ||
        !isWebgpuUseThreeResult(node.object, context.scopes)
      ) {
        return;
      }
      context.report({
        node,
        message:
          "The WebGPU root exposes state.gl only as a deprecated compatibility alias, which can be mistaken for a WebGLRenderer. Read state.renderer instead",
      });
    },
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      if (!node.init || !isWebgpuUseThreeResult(node.init, context.scopes)) return;
      const glProperty = findGlPropertyInPattern(node.id);
      if (!glProperty) return;
      context.report({
        node: glProperty,
        message:
          "The WebGPU root exposes state.gl only as a deprecated compatibility alias, which can be mistaken for a WebGLRenderer. Destructure renderer instead",
      });
    },
  }),
});
