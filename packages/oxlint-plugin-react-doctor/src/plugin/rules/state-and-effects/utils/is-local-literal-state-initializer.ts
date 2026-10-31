import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import { isReadonlyNamedReactStateHook } from "./is-readonly-named-react-state-hook.js";

interface LocalLiteralStateAnalysis {
  bindingsByCall: Map<EsTreeNode, UseStateBinding>;
  initializerResults: WeakMap<SymbolDescriptor, boolean>;
}

const localLiteralStateAnalyses = new WeakMap<
  ReadonlyArray<UseStateBinding>,
  LocalLiteralStateAnalysis
>();

export const isLocalLiteralStateInitializer = (
  initializerArgument: EsTreeNode | undefined,
  componentBody: EsTreeNode,
  bindings: ReadonlyArray<UseStateBinding>,
  scopes: ScopeAnalysis,
): boolean => {
  if (!initializerArgument) return false;
  const initializerRoot = findTransparentExpressionRoot(initializerArgument);
  let analysis = localLiteralStateAnalyses.get(bindings);
  if (!analysis) {
    const bindingsByCall = new Map<EsTreeNode, UseStateBinding>();
    for (const binding of bindings) {
      if (binding.declarator.init) bindingsByCall.set(binding.declarator.init, binding);
    }
    analysis = { bindingsByCall, initializerResults: new WeakMap() };
    localLiteralStateAnalyses.set(bindings, analysis);
  }
  const { bindingsByCall, initializerResults } = analysis;
  const stateBinding = initializerRoot.parent && bindingsByCall.get(initializerRoot.parent);
  if (
    !stateBinding ||
    !isNodeOfType(stateBinding.declarator.parent, "VariableDeclaration") ||
    stateBinding.declarator.parent.kind !== "const"
  )
    return false;
  const identifier = stripParenExpression(initializerArgument);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  const initializer = symbol && getDirectConstInitializer(symbol);
  if (!symbol || !initializer) return false;
  const declaration = symbol.declarationNode;
  if (
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.parent !== componentBody ||
    declaration.range[1] > identifier.range[0]
  )
    return false;
  const cached = initializerResults.get(symbol);
  if (cached !== undefined) return cached;
  initializerResults.set(symbol, false);
  const literal = stripParenExpression(initializer);
  if (!isNodeOfType(literal, "ObjectExpression")) {
    return false;
  }
  let isLiteralData = true;
  walkAst(literal, (node) => {
    if (!isLiteralData) return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "ObjectExpression") || isNodeOfType(node, "ArrayExpression")) return;
    if (isNodeOfType(node, "Property")) {
      const propertyName = getStaticPropertyKeyName(node);
      isLiteralData =
        node.kind === "init" &&
        !node.method &&
        !node.computed &&
        propertyName !== null &&
        propertyName !== "__proto__";
      return;
    }
    if (
      isNodeOfType(node, "Identifier") &&
      isNodeOfType(node.parent, "Property") &&
      node.parent.key === node &&
      !node.parent.shorthand
    )
      return;
    if (stripParenExpression(node) !== node) return;
    isLiteralData =
      isNodeOfType(node, "Literal") &&
      (node.value === null ||
        typeof node.value === "string" ||
        typeof node.value === "number" ||
        typeof node.value === "boolean");
  });
  if (!isLiteralData) return false;
  for (const reference of symbol.references) {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const consumer = referenceRoot.parent;
    if (
      !isNodeOfType(consumer, "CallExpression") ||
      consumer.optional ||
      consumer.arguments.length !== 1 ||
      consumer.arguments[0] !== referenceRoot ||
      !bindingsByCall.has(consumer) ||
      !isReadonlyNamedReactStateHook(consumer, scopes)
    )
      return false;
  }
  initializerResults.set(symbol, true);
  return true;
};
