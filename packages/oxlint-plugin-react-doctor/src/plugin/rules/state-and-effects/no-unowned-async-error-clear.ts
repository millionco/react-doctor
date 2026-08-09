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
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../utils/walk-own-function-scope.js";

const MESSAGE =
  "An older async response can clear error state owned by a newer request. Check that this request still owns the error before clearing it, keep ownership in the state update, or key the state owner by request ID.";

const COMPONENT_METADATA_PROPERTY_NAMES = new Set(["displayName", "propTypes"]);
const ASYNC_OWNER_IDENTITY_NAME_PATTERN =
  /(?:request(?:Id)?(?:Ref)?|active.*IdRef|(?:flight|generation|sequence|attempt|token|version)(?:Ref)?)$/i;

interface RequestOwnerState {
  componentFunction: EsTreeNode;
  ownerIdentityReferences: OwnerIdentityReference[];
  setterSymbol: SymbolDescriptor;
}

interface RequestScopedState {
  componentFunction: EsTreeNode;
  isBooleanActivityState: boolean;
  setterSymbol: SymbolDescriptor;
}

interface AsyncOwnerWrite {
  call: EsTreeNodeOfType<"CallExpression">;
  hasClear: boolean;
  hasRequestIdentity: boolean;
}

interface OwnerIdentityReference {
  propertyName: string | null;
  symbolId: number;
}

const isNullLiteral = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "Literal") && expression.value === null;
};

const isBooleanLiteral = (node: EsTreeNode | null | undefined, value: boolean): boolean => {
  if (!node) return false;
  const expression = stripParenExpression(node);
  return isNodeOfType(expression, "Literal") && expression.value === value;
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

const expressionContainsNonNullValue = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (isNullLiteral(expression)) return false;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      expressionContainsNonNullValue(expression.consequent) ||
      expressionContainsNonNullValue(expression.alternate)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      expressionContainsNonNullValue(expression.left) ||
      expressionContainsNonNullValue(expression.right)
    );
  }
  return true;
};

const nodeContainsRequestIdentity = (node: EsTreeNode): boolean => {
  let containsRequestIdentity = false;
  walkAst(node, (child) => {
    if (containsRequestIdentity) return false;
    if (
      (isNodeOfType(child, "Identifier") &&
        (ASYNC_OWNER_IDENTITY_NAME_PATTERN.test(child.name) ||
          /^(?:sentFor|targetId)$/i.test(child.name))) ||
      (isNodeOfType(child, "MemberExpression") &&
        /requestId$/i.test(getStaticPropertyName(child) ?? ""))
    ) {
      containsRequestIdentity = true;
      return false;
    }
  });
  return containsRequestIdentity;
};

const functionReceivesRequestIdentity = (functionNode: EsTreeNode): boolean =>
  isFunctionLike(functionNode) &&
  functionNode.params.some((parameter) => nodeContainsRequestIdentity(parameter));

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

const getOwnerIdentityReference = (
  node: EsTreeNode,
  context: RuleContext,
): OwnerIdentityReference | null => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    return symbol ? { propertyName: null, symbolId: symbol.id } : null;
  }
  if (!isNodeOfType(expression, "MemberExpression")) return null;
  const receiver = stripParenExpression(expression.object);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const receiverSymbol = context.scopes.symbolFor(receiver);
  const propertyName = getStaticPropertyName(expression);
  return receiverSymbol && propertyName ? { propertyName, symbolId: receiverSymbol.id } : null;
};

const collectOwnerIdentityReferences = (
  stateSymbol: SymbolDescriptor,
  componentFunction: EsTreeNode,
  context: RuleContext,
): OwnerIdentityReference[] =>
  stateSymbol.references.flatMap((reference) => {
    const referenceRoot = findTransparentExpressionRoot(reference.identifier);
    const comparison = referenceRoot.parent;
    if (
      !isNodeOfType(comparison, "BinaryExpression") ||
      !["==", "===", "!=", "!=="].includes(comparison.operator) ||
      !isAstDescendant(comparison, componentFunction)
    ) {
      return [];
    }
    const counterpart = comparison.left === referenceRoot ? comparison.right : comparison.left;
    const identityReference = getOwnerIdentityReference(counterpart, context);
    return identityReference ? [identityReference] : [];
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
  if (!stateSymbol || !setterSymbol || !componentFunction) {
    return null;
  }
  const ownerIdentityReferences = collectOwnerIdentityReferences(
    stateSymbol,
    componentFunction,
    context,
  );
  return ownerIdentityReferences.length > 0
    ? { componentFunction, ownerIdentityReferences, setterSymbol }
    : null;
};

const getRequestScopedState = (
  declarator: EsTreeNodeOfType<"VariableDeclarator">,
  context: RuleContext,
): RequestScopedState | null => {
  if (
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, "useState", context.scopes, {
      allowGlobalReactNamespace: true,
      resolveNamedAliases: true,
    })
  ) {
    return null;
  }
  const stateIdentifier = declarator.id.elements[0];
  const setterIdentifier = declarator.id.elements[1];
  const setterSymbol = isNodeOfType(setterIdentifier, "Identifier")
    ? context.scopes.symbolFor(setterIdentifier)
    : null;
  const componentFunction = findEnclosingFunction(declarator);
  const isBooleanActivityState =
    isBooleanLiteral(declarator.init.arguments[0], false) &&
    Boolean(
      isNodeOfType(stateIdentifier, "Identifier") &&
      /pending|loading|delivering/i.test(stateIdentifier.name),
    );
  if (!isNullLiteral(declarator.init.arguments[0]) && !isBooleanActivityState) return null;
  if (!setterSymbol || !componentFunction || !functionReceivesRequestIdentity(componentFunction)) {
    return null;
  }
  return { componentFunction, isBooleanActivityState, setterSymbol };
};

const openingElementHasKey = (openingElement: EsTreeNodeOfType<"JSXOpeningElement">): boolean =>
  openingElement.attributes.some(
    (attribute) =>
      isNodeOfType(attribute, "JSXAttribute") &&
      isNodeOfType(attribute.name, "JSXIdentifier") &&
      attribute.name.name === "key",
  );

const getComponentOpeningElement = (
  identifier: EsTreeNode,
): EsTreeNodeOfType<"JSXOpeningElement"> | null => {
  const openingElement = identifier.parent;
  return isNodeOfType(openingElement, "JSXOpeningElement") && openingElement.name === identifier
    ? openingElement
    : null;
};

const isComponentClosingElementReference = (identifier: EsTreeNode): boolean => {
  const closingElement = identifier.parent;
  return isNodeOfType(closingElement, "JSXClosingElement") && closingElement.name === identifier;
};

const isComponentMetadataReference = (identifier: EsTreeNode): boolean => {
  const referenceRoot = findTransparentExpressionRoot(identifier);
  const member = referenceRoot.parent;
  return (
    isNodeOfType(member, "MemberExpression") &&
    member.object === referenceRoot &&
    COMPONENT_METADATA_PROPERTY_NAMES.has(getStaticPropertyName(member) ?? "")
  );
};

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
  const openingElements: EsTreeNodeOfType<"JSXOpeningElement">[] = [];
  for (const reference of componentSymbol.references) {
    const openingElement = getComponentOpeningElement(reference.identifier);
    if (openingElement) {
      openingElements.push(openingElement);
      continue;
    }
    if (
      !isComponentClosingElementReference(reference.identifier) &&
      !isComponentMetadataReference(reference.identifier)
    ) {
      return false;
    }
  }
  return openingElements.length > 0 && openingElements.every(openingElementHasKey);
};

const conditionHasRequestIdentityEquality = (
  condition: EsTreeNode,
  asyncFunction: EsTreeNode,
  ownerIdentityReferences: OwnerIdentityReference[],
  context: RuleContext,
): boolean => {
  let hasRequestIdentityEquality = false;
  walkAst(condition, (child) => {
    if (
      hasRequestIdentityEquality ||
      !isNodeOfType(child, "BinaryExpression") ||
      !["==", "==="].includes(child.operator)
    ) {
      return;
    }
    const requestIdentity = getRequestIdentityMember(child.left, asyncFunction, context);
    const counterpart = requestIdentity
      ? child.right
      : getRequestIdentityMember(child.right, asyncFunction, context)
        ? child.left
        : null;
    const ownerIdentity = counterpart ? getOwnerIdentityReference(counterpart, context) : null;
    if (
      ownerIdentity &&
      ownerIdentityReferences.some(
        (candidate) =>
          candidate.symbolId === ownerIdentity.symbolId &&
          candidate.propertyName === ownerIdentity.propertyName,
      )
    ) {
      hasRequestIdentityEquality = true;
      return false;
    }
  });
  return hasRequestIdentityEquality;
};

const callHasRequestOwnershipGuard = (
  call: EsTreeNodeOfType<"CallExpression">,
  asyncFunction: EsTreeNode,
  ownerIdentityReferences: OwnerIdentityReference[],
  context: RuleContext,
): boolean => {
  let ancestor = call.parent;
  while (ancestor && ancestor !== asyncFunction) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      isAstDescendant(call, ancestor.consequent) &&
      conditionHasRequestIdentityEquality(
        ancestor.test,
        asyncFunction,
        ownerIdentityReferences,
        context,
      )
    ) {
      return true;
    }
    ancestor = ancestor.parent;
  }
  return false;
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
    if (writes.some((write) => write.hasRequestIdentity)) {
      unsafeClear =
        writes.find(
          (write) =>
            write.hasClear &&
            !callHasRequestOwnershipGuard(
              write.call,
              child,
              state.ownerIdentityReferences,
              context,
            ),
        )?.call ?? null;
    }
    return false;
  });
  return unsafeClear;
};

const conditionProvesRequestOwnership = (condition: EsTreeNode, whenTruthy: boolean): boolean => {
  const expression = stripParenExpression(condition);
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    return conditionProvesRequestOwnership(expression.argument, !whenTruthy);
  }
  if (isNodeOfType(expression, "BinaryExpression")) {
    const isRequestIdentityComparison =
      nodeContainsRequestIdentity(expression.left) && nodeContainsRequestIdentity(expression.right);
    if (!isRequestIdentityComparison) return false;
    if (["==", "==="].includes(expression.operator)) return whenTruthy;
    if (["!=", "!=="].includes(expression.operator)) return !whenTruthy;
    return false;
  }
  if (!isNodeOfType(expression, "LogicalExpression")) return false;
  const leftProvesOwnership = conditionProvesRequestOwnership(expression.left, whenTruthy);
  const rightProvesOwnership = conditionProvesRequestOwnership(expression.right, whenTruthy);
  if (expression.operator === "&&") {
    return whenTruthy
      ? leftProvesOwnership || rightProvesOwnership
      : leftProvesOwnership && rightProvesOwnership;
  }
  if (expression.operator === "||") {
    return whenTruthy
      ? leftProvesOwnership && rightProvesOwnership
      : leftProvesOwnership || rightProvesOwnership;
  }
  return false;
};

const callIsInOwnershipProvenBranch = (
  call: EsTreeNodeOfType<"CallExpression">,
  asyncBoundary: EsTreeNode,
): boolean => {
  let ancestor = call.parent;
  while (ancestor && ancestor !== asyncBoundary) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (
        isAstDescendant(call, ancestor.consequent) &&
        conditionProvesRequestOwnership(ancestor.test, true)
      ) {
        return true;
      }
      if (
        ancestor.alternate &&
        isAstDescendant(call, ancestor.alternate) &&
        conditionProvesRequestOwnership(ancestor.test, false)
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const callFollowsOwnershipExitGuard = (
  call: EsTreeNodeOfType<"CallExpression">,
  asyncBoundary: EsTreeNode,
): boolean => {
  let ancestor = call.parent;
  while (ancestor && ancestor !== asyncBoundary) {
    if (isNodeOfType(ancestor, "BlockStatement")) {
      for (const statement of ancestor.body) {
        if (isAstDescendant(call, statement)) break;
        if (!isNodeOfType(statement, "IfStatement")) continue;
        if (
          statementAlwaysExits(statement.consequent) &&
          conditionProvesRequestOwnership(statement.test, false)
        ) {
          return true;
        }
        if (
          statement.alternate &&
          statementAlwaysExits(statement.alternate) &&
          conditionProvesRequestOwnership(statement.test, true)
        ) {
          return true;
        }
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const callIsOwnershipGuarded = (
  call: EsTreeNodeOfType<"CallExpression">,
  asyncBoundary: EsTreeNode,
): boolean =>
  callIsInOwnershipProvenBranch(call, asyncBoundary) ||
  callFollowsOwnershipExitGuard(call, asyncBoundary);

const collectSetterCalls = (
  functionNode: EsTreeNode,
  setterSymbol: SymbolDescriptor,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression">[] => {
  const calls: EsTreeNodeOfType<"CallExpression">[] = [];
  walkOwnFunctionScope(functionNode, (child) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "Identifier") &&
      context.scopes.symbolFor(child.callee)?.id === setterSymbol.id
    ) {
      calls.push(child);
    }
  });
  return calls;
};

const findUnsafeRequestScopedClear = (
  state: RequestScopedState,
  context: RuleContext,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (componentIsKeyedAtEveryLocalUse(state.componentFunction, context)) return null;
  let unsafeClear: EsTreeNodeOfType<"CallExpression"> | null = null;
  walkAst(state.componentFunction, (child) => {
    if (unsafeClear) return false;
    if (child === state.componentFunction || !isFunctionLike(child)) return;
    let completionCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    let activityStartCalls: EsTreeNodeOfType<"CallExpression">[] = [];
    if (child.async) {
      let firstAwaitEnd: number | null = null;
      walkOwnFunctionScope(child, (functionChild) => {
        if (isNodeOfType(functionChild, "AwaitExpression")) {
          firstAwaitEnd =
            firstAwaitEnd === null
              ? functionChild.range[1]
              : Math.min(firstAwaitEnd, functionChild.range[1]);
        }
      });
      if (firstAwaitEnd !== null) {
        const awaitBoundaryEnd = firstAwaitEnd;
        const setterCalls = collectSetterCalls(child, state.setterSymbol, context);
        completionCalls = setterCalls.filter((call) => call.range[0] >= awaitBoundaryEnd);
        activityStartCalls = setterCalls.filter((call) => call.range[0] < awaitBoundaryEnd);
      }
    } else {
      const callExpression = child.parent;
      if (
        callExpression &&
        isNodeOfType(callExpression, "CallExpression") &&
        callExpression.arguments.some((argument) => argument === child) &&
        isNodeOfType(callExpression.callee, "MemberExpression") &&
        getStaticPropertyName(callExpression.callee) === "then"
      ) {
        completionCalls = collectSetterCalls(child, state.setterSymbol, context);
      }
    }
    if (completionCalls.length === 0) return false;
    if (state.isBooleanActivityState) {
      const startsActivity = activityStartCalls.some((call) =>
        isBooleanLiteral(call.arguments[0], true),
      );
      unsafeClear = startsActivity
        ? (completionCalls.find(
            (call) =>
              isBooleanLiteral(call.arguments[0], false) && !callIsOwnershipGuarded(call, child),
          ) ?? null)
        : null;
      return unsafeClear ? false : undefined;
    }
    if (!nodeContainsRequestIdentity(child)) return false;
    const hasClear = completionCalls.some((call) => {
      const argument = call.arguments[0];
      return Boolean(argument && expressionContainsNull(argument));
    });
    const hasFailure = completionCalls.some((call) => {
      const argument = call.arguments[0];
      return Boolean(argument && expressionContainsNonNullValue(argument));
    });
    if (!hasClear || !hasFailure) return false;
    unsafeClear =
      completionCalls.find((call) => {
        const argument = call.arguments[0];
        return Boolean(
          argument &&
          !isFunctionLike(stripParenExpression(argument)) &&
          expressionContainsNull(argument) &&
          !callIsOwnershipGuarded(call, child),
        );
      }) ?? null;
    return unsafeClear ? false : undefined;
  });
  return unsafeClear;
};

export const noUnownedAsyncErrorClear = defineRule({
  id: "no-unowned-async-error-clear",
  title: "Stale async response clears newer request state",
  severity: "warn",
  tags: ["react-jsx-only"],
  recommendation:
    "Guard async completion by request identity, perform an ownership-aware functional state update, or key the state-owning component by request ID.",
  create: (context: RuleContext) => {
    const reportedComponentFunctions = new Set<EsTreeNode>();
    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        const state = getRequestOwnerState(node, context);
        const requestScopedState = state ? null : getRequestScopedState(node, context);
        const componentFunction = state?.componentFunction ?? requestScopedState?.componentFunction;
        if (
          (!state && !requestScopedState) ||
          !componentFunction ||
          reportedComponentFunctions.has(componentFunction)
        ) {
          return;
        }
        let unsafeClear: EsTreeNodeOfType<"CallExpression"> | null = null;
        if (state) unsafeClear = findUnsafeOwnerClear(state, context);
        if (requestScopedState) {
          unsafeClear = findUnsafeRequestScopedClear(requestScopedState, context);
        }
        if (!unsafeClear) return;
        reportedComponentFunctions.add(componentFunction);
        context.report({ node: unsafeClear, message: MESSAGE });
      },
    };
  },
});
