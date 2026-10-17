import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import { closureCaptures } from "../../../semantic/closure-captures.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getEffectCallback } from "../../../utils/get-effect-callback.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { isClosedReactCommandHookCall } from "./is-closed-react-command-hook-call.js";

interface ClosedLocalMemoGraphInput {
  readonly identifier: EsTreeNode;
  readonly componentBody: EsTreeNode;
  readonly effectCall: EsTreeNode;
  readonly scopes: ScopeAnalysis;
  readonly isStableDependency: (dependency: EsTreeNode) => boolean;
  readonly stableHookNames: ReadonlySet<string>;
}

interface LocalMemoGraphNode {
  readonly symbol: SymbolDescriptor;
  readonly callback: EsTreeNode;
  readonly dependencies: EsTreeNode;
}

export const isClosedLocalMemoGraph = ({
  identifier,
  componentBody,
  effectCall,
  scopes,
  isStableDependency,
  stableHookNames,
}: ClosedLocalMemoGraphInput): boolean => {
  const selectedSymbol = scopes.symbolFor(identifier);
  const effectCallback = getEffectCallback(effectCall);
  if (
    !selectedSymbol ||
    !isNodeOfType(effectCall, "CallExpression") ||
    !effectCallback ||
    !effectCall.arguments?.[0] ||
    stripParenExpression(effectCall.arguments[0]) !== effectCallback ||
    !Array.from(EFFECT_HOOK_NAMES).some((hookName) =>
      isClosedReactCommandHookCall(effectCall, hookName, scopes),
    )
  )
    return false;

  const graph = new Map<number, LocalMemoGraphNode>();
  const visiting = new Set<number>();
  const isReadonly = (symbol: SymbolDescriptor): boolean =>
    symbol.kind === "const" &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );

  const hasClosedStableHookOrigin = (dependency: EsTreeNode): boolean => {
    if (!isStableDependency(dependency)) return false;
    const visited = new Set<number>();
    let symbol = scopes.symbolFor(dependency);
    while (symbol && !visited.has(symbol.id)) {
      if (!isReadonly(symbol)) return false;
      visited.add(symbol.id);
      let declarator: EsTreeNode | null | undefined = symbol.declarationNode;
      while (declarator && !isNodeOfType(declarator, "VariableDeclarator")) {
        declarator = declarator.parent;
      }
      if (!declarator?.init) return false;
      const initializer = stripParenExpression(declarator.init);
      if (isNodeOfType(initializer, "Identifier") && isReadonly(symbol)) {
        symbol = scopes.symbolFor(initializer);
        continue;
      }
      return Array.from(stableHookNames).some((hookName) =>
        isClosedReactCommandHookCall(initializer, hookName, scopes),
      );
    }
    return false;
  };

  const visit = (symbol: SymbolDescriptor): boolean => {
    if (visiting.has(symbol.id)) return false;
    if (graph.has(symbol.id)) return true;
    const declarator = symbol.declarationNode;
    const declaration = declarator.parent;
    if (
      !isReadonly(symbol) ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.id !== symbol.bindingIdentifier ||
      !isNodeOfType(declarator.id, "Identifier") ||
      !declarator.init ||
      !isNodeOfType(declaration, "VariableDeclaration") ||
      declaration.kind !== "const" ||
      declaration.parent !== componentBody
    )
      return false;
    const call = stripParenExpression(declarator.init);
    if (
      !isNodeOfType(call, "CallExpression") ||
      !isClosedReactCommandHookCall(call, "useCallback", scopes) ||
      call.arguments?.length !== 2
    )
      return false;
    const callback = stripParenExpression(call.arguments[0]);
    const dependencies = stripParenExpression(call.arguments[1]);
    if (
      (!isNodeOfType(callback, "ArrowFunctionExpression") &&
        !isNodeOfType(callback, "FunctionExpression")) ||
      callback.async ||
      callback.generator ||
      !isNodeOfType(dependencies, "ArrayExpression")
    )
      return false;

    visiting.add(symbol.id);
    const dependencySymbols = new Set<number>();
    for (const dependency of dependencies.elements ?? []) {
      if (!isNodeOfType(dependency, "Identifier")) return false;
      const dependencySymbol = scopes.symbolFor(dependency);
      if (!dependencySymbol) return false;
      dependencySymbols.add(dependencySymbol.id);
      if (!hasClosedStableHookOrigin(dependency) && !visit(dependencySymbol)) return false;
    }
    if (
      closureCaptures(callback, scopes).some(
        (reference) =>
          !isTypeScriptTypePosition(reference.identifier) &&
          (reference.flag !== "read" ||
            isWithinAssignmentTarget(reference.identifier) ||
            !reference.resolvedSymbol ||
            !dependencySymbols.has(reference.resolvedSymbol.id)),
      )
    )
      return false;
    visiting.delete(symbol.id);
    graph.set(symbol.id, { symbol, callback, dependencies });
    return true;
  };
  if (!visit(selectedSymbol)) return false;

  const dependencyArrays = new Set(Array.from(graph.values(), (node) => node.dependencies));
  const memoCallbacks = new Set(Array.from(graph.values(), (node) => node.callback));
  for (const node of graph.values()) {
    for (const reference of node.symbol.references) {
      if (isTypeScriptTypePosition(reference.identifier)) continue;
      const target = findTransparentExpressionRoot(reference.identifier);
      const parent = target.parent;
      if (
        isNodeOfType(parent, "ArrayExpression") &&
        (dependencyArrays.has(parent) ||
          (node.symbol === selectedSymbol && effectCall.arguments?.[1] === parent))
      )
        continue;
      if (
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== target ||
        parent.optional ||
        parent.arguments?.some((argument: EsTreeNode) => isNodeOfType(argument, "SpreadElement"))
      )
        return false;
      let enclosingNode: EsTreeNode | null | undefined = parent;
      while (
        enclosingNode &&
        enclosingNode !== componentBody &&
        !memoCallbacks.has(enclosingNode)
      ) {
        enclosingNode = enclosingNode.parent;
      }
      if (enclosingNode && memoCallbacks.has(enclosingNode)) continue;
      if (node.symbol === selectedSymbol && isAstDescendant(parent, effectCallback)) continue;
      return false;
    }
  }
  return true;
};
