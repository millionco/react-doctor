import type { ScopeDescriptor, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../utils/get-function-binding-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const MESSAGE =
  "An older async response can clear error state owned by a newer request. Check that this request still owns the error before clearing it, keep ownership in the state update, or key the state owner by request ID.";

interface RequestOwnerState {
  componentFunction: EsTreeNode;
  setterSymbol: SymbolDescriptor;
  stateSymbol: SymbolDescriptor;
}

interface AsyncOwnerWrite {
  call: EsTreeNodeOfType<"CallExpression">;
  hasClear: boolean;
  hasRequestIdentity: boolean;
}

const isNullLiteral = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "Literal") && expression.value === null;
};

const expressionContainsNull = (node: EsTreeNode): boolean => {
  let hasNull = false;
  walkAst(node, (child) => {
    if (hasNull) return false;
    if (child !== node && isFunctionLike(child)) return false;
    if (!isNullLiteral(child)) return;
    hasNull = true;
    return false;
  });
  return hasNull;
};

const getRequestIdentityMember = (
  node: EsTreeNode,
  asyncFunction: EsTreeNode,
  context: RuleContext,
): EsTreeNodeOfType<"MemberExpression"> | null => {
  const expression = stripParenExpression(node);
  if (!isFunctionLike(asyncFunction) || !isNodeOfType(expression, "MemberExpression")) {
    return null;
  }
  const propertyName = getStaticPropertyName(expression);
  const receiver = stripParenExpression(expression.object);
  if (!propertyName?.endsWith("Id") || !isNodeOfType(receiver, "Identifier")) return null;
  const receiverSymbol = context.scopes.symbolFor(receiver);
  if (!receiverSymbol) return null;
  return asyncFunction.params.some((parameter) => {
    const unwrappedParameter = stripParenExpression(parameter);
    return (
      isNodeOfType(unwrappedParameter, "Identifier") &&
      context.scopes.symbolFor(unwrappedParameter)?.id === receiverSymbol.id
    );
  })
    ? expression
    : null;
};

const expressionContainsRequestIdentity = (
  node: EsTreeNode,
  asyncFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let hasRequestIdentity = false;
  walkAst(node, (child) => {
    if (hasRequestIdentity) return false;
    if (child !== node && isFunctionLike(child)) return false;
    if (!getRequestIdentityMember(child, asyncFunction, context)) return;
    hasRequestIdentity = true;
    return false;
  });
  return hasRequestIdentity;
};

const stateHasIdentityComparison = (
  stateSymbol: SymbolDescriptor,
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean =>
  stateSymbol.references.some((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const comparison = referenceRoot.parent;
    if (
      !isNodeOfType(comparison, "BinaryExpression") ||
      !["==", "===", "!=", "!=="].includes(comparison.operator) ||
      !isAstDescendant(comparison, componentFunction)
    ) {
      return false;
    }
    const counterpart = comparison.left === referenceRoot ? comparison.right : comparison.left;
    return counterpart !== referenceRoot && !isNullLiteral(counterpart);
  });

const getRequestOwnerState = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): RequestOwnerState | null => {
  if (
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, "useState", context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    }) ||
    declarator.init.arguments.length !== 1 ||
    !isNullLiteral(declarator.init.arguments[0])
  ) {
    return null;
  }
  const stateIdentifier = declarator.id.elements[0];
  const setterIdentifier = declarator.id.elements[1];
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(setterIdentifier, "Identifier")
  ) {
    return null;
  }
  const stateSymbol = context.scopes.symbolFor(stateIdentifier);
  const setterSymbol = context.scopes.symbolFor(setterIdentifier);
  const componentFunction = findEnclosingFunction(declarator);
  if (
    !stateSymbol ||
    !setterSymbol ||
    !componentFunction ||
    !stateHasIdentityComparison(stateSymbol, componentFunction, context)
  ) {
    return null;
  }
  return { componentFunction, setterSymbol, stateSymbol };
};

const openingElementHasKey = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  openingElement.attributes.some(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "key",
  );

const componentIsKeyedAtEveryLocalUse = (
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const bindingIdentifier = getFunctionBindingIdentifier(componentFunction);
  if (!bindingIdentifier) return false;
  let bindingScope: ScopeDescriptor | null = context.scopes.scopeFor(componentFunction);
  let componentSymbol: SymbolDescriptor | null = null;
  while (bindingScope && !componentSymbol) {
    componentSymbol =
      bindingScope.symbols.find((symbol) => symbol.bindingIdentifier === bindingIdentifier) ?? null;
    bindingScope = bindingScope.parent;
  }
  if (!componentSymbol || componentSymbol.references.length === 0) return false;
  return componentSymbol.references.every((reference) => {
    const openingElement = reference.identifier.parent;
    return (
      isNodeOfType(openingElement, "JSXOpeningElement") &&
      openingElement.name === reference.identifier &&
      openingElementHasKey(openingElement)
    );
  });
};

const functionHasRequestOwnershipGuard = (
  asyncFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  let hasOwnershipGuard = false;
  walkOwnFunctionScope(asyncFunction, (child) => {
    if (
      hasOwnershipGuard ||
      !isNodeOfType(child, "BinaryExpression") ||
      !["==", "===", "!=", "!=="].includes(child.operator)
    ) {
      return;
    }
    if (
      getRequestIdentityMember(child.left, asyncFunction, context) ||
      getRequestIdentityMember(child.right, asyncFunction, context)
    ) {
      hasOwnershipGuard = true;
      return false;
    }
  });
  return hasOwnershipGuard;
};

const collectAsyncOwnerWrites = (
  asyncFunction: EsTreeNode,
  setterSymbol: SymbolDescriptor,
  context: RuleContext,
): AsyncOwnerWrite[] => {
  if (!isFunctionLike(asyncFunction) || !asyncFunction.async) return [];
  let firstAwaitEnd: number | null = null;
  const writes: AsyncOwnerWrite[] = [];
  walkOwnFunctionScope(asyncFunction, (child) => {
    if (isNodeOfType(child, "AwaitExpression")) {
      const awaitEnd = child.range[1];
      firstAwaitEnd = firstAwaitEnd === null ? awaitEnd : Math.min(firstAwaitEnd, awaitEnd);
      return;
    }
    if (
      firstAwaitEnd === null ||
      !isNodeOfType(child, "CallExpression") ||
      child.range[0] < firstAwaitEnd ||
      !isNodeOfType(child.callee, "Identifier") ||
      context.scopes.symbolFor(child.callee)?.id !== setterSymbol.id
    ) {
      return;
    }
    const nextOwner = child.arguments[0];
    if (!nextOwner || isFunctionLike(stripParenExpression(nextOwner))) return;
    writes.push({
      call: child,
      hasClear: expressionContainsNull(nextOwner),
      hasRequestIdentity: expressionContainsRequestIdentity(nextOwner, asyncFunction, context),
    });
  });
  return writes;
};

const findUnsafeOwnerClear = (
  state: RequestOwnerState,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (componentIsKeyedAtEveryLocalUse(state.componentFunction, context)) return null;
  let unsafeClear: EsTreeNodeOfType<"CallExpression"> | null = null;
  walkAst(state.componentFunction, (child) => {
    if (unsafeClear) return false;
    if (child === state.componentFunction || !isFunctionLike(child)) return;
    const writes = collectAsyncOwnerWrites(child, state.setterSymbol, context);
    if (
      writes.some((write) => write.hasClear) &&
      writes.some((write) => write.hasRequestIdentity) &&
      !functionHasRequestOwnershipGuard(child, context)
    ) {
      unsafeClear = writes.find((write) => write.hasClear)?.call ?? null;
    }
    return false;
  });
  return unsafeClear;
};

export const noUnownedAsyncErrorClear = defineRule({
  id: "no-unowned-async-error-clear",
  title: "Stale async response clears newer request state",
  severity: "warn",
  tags: ["react-jsx-only"],
  defaultEnabled: false,
  recommendation:
    "Guard async completion by request identity, perform an ownership-aware functional state update, or key the state-owning component by request ID.",
  create: (context: RuleContext) => ({
    VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
      const state = getRequestOwnerState(node, context);
      if (!state) return;
      const unsafeClear = findUnsafeOwnerClear(state, context);
      if (unsafeClear) context.report({ node: unsafeClear, message: MESSAGE });
    },
  }),
});
