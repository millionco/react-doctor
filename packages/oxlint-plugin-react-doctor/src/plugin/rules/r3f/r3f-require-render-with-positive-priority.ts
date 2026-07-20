import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getImportDeclarationForSymbol } from "../../utils/get-import-declaration-for-symbol.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { getApiReferenceProvenance } from "./utils/get-api-reference-provenance.js";
import { getModuleNamespaceSource } from "./utils/get-module-namespace-source.js";
import { getStaticNumber } from "./utils/get-static-number.js";
import { isR3fApiCall } from "./utils/is-r3f-api-call.js";
import { resolveR3fCallback } from "./utils/resolve-r3f-callback.js";
import { THREE_RENDER_METHOD_NAMES } from "./utils/three-render-method-names.js";
import { walkFunctionExecution } from "./utils/walk-function-execution.js";

const EXTERNAL_RENDER_OWNER_MODULES = new Set(["@react-three/postprocessing"]);
const NON_RENDERER_RENDER_MODULES = new Set([
  "ejs",
  "handlebars",
  "markdown-it",
  "marked",
  "mermaid",
  "mustache",
]);

interface PositivePrioritySubscriptionGroup {
  calls: EsTreeNodeOfType<"CallExpression">[];
  hasRenderSink: boolean;
  hasUnresolvedCallback: boolean;
}

const getImportedReceiverModuleSource = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): string | null => {
  const candidate = stripParenExpression(expression);
  const namespaceSource = getModuleNamespaceSource(candidate, scopes);
  if (namespaceSource) return namespaceSource;
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = scopes.symbolFor(candidate);
  if (!symbol || visitedSymbolIds.has(symbol.id)) return null;
  visitedSymbolIds.add(symbol.id);
  const importDeclaration = getImportDeclarationForSymbol(symbol);
  if (importDeclaration && typeof importDeclaration.source.value === "string") {
    return importDeclaration.source.value;
  }
  if (
    symbol.kind !== "const" ||
    !symbol.initializer ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
    symbol.declarationNode.id !== symbol.bindingIdentifier
  ) {
    return null;
  }
  return getImportedReceiverModuleSource(symbol.initializer, scopes, visitedSymbolIds);
};

const isProvenNonRendererRenderCall = (
  callee: EsTreeNodeOfType<"MemberExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const moduleSource = getImportedReceiverModuleSource(callee.object, scopes);
  return Boolean(moduleSource && NON_RENDERER_RENDER_MODULES.has(moduleSource));
};

const isExplicitNullNoopCallback = (callback: EsTreeNode): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  const body = stripParenExpression(callback.body);
  if (!isNodeOfType(body, "BlockStatement")) {
    return isNodeOfType(body, "Literal") && body.value === null;
  }
  if (body.body.length !== 1) return false;
  const statement = body.body[0];
  if (!isNodeOfType(statement, "ReturnStatement") || !statement.argument) return false;
  const returnedExpression = stripParenExpression(statement.argument);
  return isNodeOfType(returnedExpression, "Literal") && returnedExpression.value === null;
};

const callbackHasRenderSink = (callback: EsTreeNode, context: RuleContext): boolean => {
  let hasRenderSink = false;
  walkFunctionExecution(callback, context.scopes, (candidate) => {
    if (hasRenderSink || !isNodeOfType(candidate, "CallExpression")) return;
    const callee = stripParenExpression(candidate.callee);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      !THREE_RENDER_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "")
    )
      return;
    if (isProvenNonRendererRenderCall(callee, context.scopes)) return;
    hasRenderSink = true;
  });
  return hasRenderSink;
};

export const r3fRequireRenderWithPositivePriority = defineRule({
  id: "r3f-require-render-with-positive-priority",
  title: "Positive useFrame priority without a render",
  category: "Correctness",
  severity: "warn",
  recommendation:
    "Render the scene or composer from the positive-priority useFrame subscription, or use a non-positive priority to keep automatic rendering enabled",
  create: (context: RuleContext) => {
    const moduleSubscriptions: PositivePrioritySubscriptionGroup = {
      calls: [],
      hasRenderSink: false,
      hasUnresolvedCallback: false,
    };
    let hasExternalRenderOwner = false;
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isR3fApiCall(node, "useFrame", context.scopes)) return;
        const priorityArgument = node.arguments[1];
        if (
          !priorityArgument ||
          isNodeOfType(priorityArgument, "SpreadElement") ||
          (getStaticNumber(priorityArgument, context.scopes) ?? 0) <= 0
        ) {
          return;
        }
        const callback = resolveR3fCallback(node, "useFrame", context.scopes);
        if (!callback) {
          moduleSubscriptions.hasUnresolvedCallback = true;
          return;
        }
        if (isExplicitNullNoopCallback(callback)) return;
        moduleSubscriptions.calls.push(node);
        if (callbackHasRenderSink(callback, context)) moduleSubscriptions.hasRenderSink = true;
      },
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const provenance = getApiReferenceProvenance(node.name, context.scopes);
        if (
          provenance?.apiName === "EffectComposer" &&
          EXTERNAL_RENDER_OWNER_MODULES.has(provenance.moduleSource)
        ) {
          hasExternalRenderOwner = true;
        }
      },
      "Program:exit"() {
        if (
          moduleSubscriptions.hasRenderSink ||
          moduleSubscriptions.hasUnresolvedCallback ||
          hasExternalRenderOwner
        ) {
          return;
        }
        for (const call of moduleSubscriptions.calls) {
          context.report({
            node: call,
            message:
              "A positive useFrame priority disables R3F's automatic render. No gl.render, renderer.render, or composer.render call is visible in this module's positive-priority subscriptions",
          });
        }
      },
    };
  },
});
