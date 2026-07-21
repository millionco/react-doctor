import { containsLocaleEnvironmentRead } from "../../utils/contains-locale-environment-read.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { flattenJsxName } from "../../utils/flatten-jsx-name.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getSingleReturnExpression } from "../../utils/get-single-return-expression.js";
import { hasReactRefCurrentOrigin } from "../../utils/react-ref-origin.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isSetterCall } from "../../utils/is-setter-call.js";
import { isUseStateSetterInScope } from "../../utils/is-use-state-setter-in-scope.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { unwrapDiscardedExpression } from "../../utils/unwrap-discarded-expression.js";
import { unwrapReturnExpression } from "../../utils/unwrap-return-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const USE_EFFECT_ONLY = new Set(["useEffect"]);
const USE_CALLBACK_ONLY = new Set(["useCallback"]);
const USE_STATE_ONLY = new Set(["useState"]);
const REACT_API_CALL_OPTIONS = {
  allowGlobalReactNamespace: true,
  allowUnboundBareCalls: true,
  resolveNamedAliases: true,
};
const MOUNT_FLASH_MESSAGE =
  "`useEffect(setState, [])` runs after the first paint, so users can see the initial state flash. Initialize from a render-safe value or use `useSyncExternalStore` for external values.";

interface PairedStateBinding {
  componentFunction: EsTreeNode;
  initializer: EsTreeNode | null;
  stateIdentifier: EsTreeNodeOfType<"Identifier">;
  stateSymbolId: number;
}

const expressionReadsDerivedSymbol = (
  context: RuleContext,
  expression: EsTreeNode,
  stateDerivedSymbolIds: ReadonlySet<number>,
  shouldIncludeReference?: (identifier: EsTreeNodeOfType<"Identifier">) => boolean,
): boolean => {
  let readsDerivedSymbol = false;
  walkAst(expression, (node) => {
    if (readsDerivedSymbol) return false;
    if (node !== expression && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      stateDerivedSymbolIds.has(context.scopes.symbolFor(node)?.id ?? -1) &&
      (!shouldIncludeReference || shouldIncludeReference(node))
    ) {
      readsDerivedSymbol = true;
    }
  });
  return readsDerivedSymbol;
};

const getStaticObjectPropertyName = (property: EsTreeNode): string | null => {
  if (
    !isNodeOfType(property, "Property") ||
    property.computed ||
    property.method ||
    property.kind !== "init"
  ) {
    return null;
  }
  if (isNodeOfType(property.key, "Identifier")) return property.key.name;
  if (
    isNodeOfType(property.key, "Literal") &&
    (typeof property.key.value === "string" || typeof property.key.value === "number")
  ) {
    return String(property.key.value);
  }
  return null;
};

const isNonVisibleJsxSpreadProperty = (propertyName: string): boolean =>
  propertyName === "id" || propertyName.startsWith("aria-") || /^on[A-Z]/.test(propertyName);

const isTransparentAssignmentTarget = (identifier: EsTreeNode): boolean => {
  const expressionRoot = findTransparentExpressionRoot(identifier);
  const parent = expressionRoot.parent;
  return Boolean(
    (isNodeOfType(parent, "AssignmentExpression") && parent.left === expressionRoot) ||
    (isNodeOfType(parent, "UpdateExpression") && parent.argument === expressionRoot) ||
    (isNodeOfType(parent, "UnaryExpression") &&
      parent.operator === "delete" &&
      parent.argument === expressionRoot),
  );
};

// A setter fed by a `.current` read is the post-mount DOM-measurement
// pattern (header widths, element rects) — there is no pre-hydration value
// to render, so useSyncExternalStore is not an available alternative.
const argumentsReadReactRefCurrent = (context: RuleContext, callArguments: EsTreeNode[]): boolean =>
  callArguments.some((argument) => {
    let readsReactRefCurrent = false;
    walkAst(argument, (child) => {
      if (readsReactRefCurrent) return false;
      if (hasReactRefCurrentOrigin(child, context.scopes)) {
        readsReactRefCurrent = true;
      }
    });
    return readsReactRefCurrent;
  });

const findPairedStateBinding = (
  context: RuleContext,
  setterCall: EsTreeNode,
  setterName: string,
): PairedStateBinding | null => {
  if (!isNodeOfType(setterCall, "CallExpression")) return null;
  if (!isNodeOfType(setterCall.callee, "Identifier") || setterCall.callee.name !== setterName) {
    return null;
  }
  const setterSymbol = context.scopes.symbolFor(setterCall.callee);
  if (!setterSymbol || !isNodeOfType(setterSymbol.declarationNode, "VariableDeclarator")) {
    return null;
  }
  const declarator = setterSymbol.declarationNode;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const stateIdentifier = declarator.id.elements?.[0];
  const setterIdentifier = declarator.id.elements?.[1];
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(setterIdentifier, "Identifier") ||
    setterIdentifier !== setterSymbol.bindingIdentifier ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, USE_STATE_ONLY, context.scopes, REACT_API_CALL_OPTIONS)
  ) {
    return null;
  }
  const stateSymbol = context.scopes.symbolFor(stateIdentifier);
  const componentFunction = findEnclosingFunction(declarator);
  if (!stateSymbol || !isFunctionLike(componentFunction)) return null;
  return {
    componentFunction,
    initializer: declarator.init.arguments?.[0] ?? null,
    stateIdentifier,
    stateSymbolId: stateSymbol.id,
  };
};

const isInsideIdOrAriaAttribute = (identifier: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      return (
        isNodeOfType(cursor.name, "JSXIdentifier") &&
        (cursor.name.name === "id" || cursor.name.name.startsWith("aria-"))
      );
    }
    if (isNodeOfType(cursor, "JSXElement") || isNodeOfType(cursor, "JSXFragment")) return false;
    cursor = cursor.parent ?? null;
  }
  return false;
};

const isStateUsedOnlyInIdOrAriaAttributes = (
  context: RuleContext,
  pairedState: PairedStateBinding,
): boolean => {
  let referenceCount = 0;
  let nonAriaReferenceFound = false;
  walkAst(pairedState.componentFunction, (node) => {
    if (
      !isNodeOfType(node, "Identifier") ||
      context.scopes.symbolFor(node)?.id !== pairedState.stateSymbolId ||
      node === pairedState.stateIdentifier
    ) {
      return;
    }
    const parent = node.parent;
    if (
      parent &&
      (isNodeOfType(parent, "ArrayPattern") ||
        (isNodeOfType(parent, "MemberExpression") && parent.property === node))
    ) {
      return;
    }
    referenceCount += 1;
    if (!isInsideIdOrAriaAttribute(node)) nonAriaReferenceFound = true;
  });
  return referenceCount > 0 && !nonAriaReferenceFound;
};

const isInsideNonVisibleMountAnimationProperty = (identifier: EsTreeNode): boolean => {
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      if (
        !isNodeOfType(cursor.name, "JSXIdentifier") ||
        (cursor.name.name !== "entering" && cursor.name.name !== "exiting") ||
        !isNodeOfType(cursor.parent, "JSXOpeningElement")
      ) {
        return false;
      }
      return flattenJsxName(cursor.parent.name)?.startsWith("Animated.") ?? false;
    }
    if (isNodeOfType(cursor, "Property")) {
      return getStaticObjectPropertyName(cursor) === "motionAppear";
    }
    if (isFunctionLike(cursor)) return false;
    cursor = cursor.parent;
  }
  return false;
};

const isSameMountStateValue = (
  context: RuleContext,
  pairedState: PairedStateBinding,
  setterCall: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  if (setterCall.arguments?.length !== 1) return false;
  const didOmitInitializer = pairedState.initializer === null;
  const unwrappedInitializer = pairedState.initializer
    ? stripParenExpression(pairedState.initializer)
    : null;
  const initializer =
    unwrappedInitializer && isFunctionLike(unwrappedInitializer)
      ? getSingleReturnExpression(unwrappedInitializer)
      : unwrappedInitializer;
  if (unwrappedInitializer && isFunctionLike(unwrappedInitializer) && !initializer) return false;
  const nextValue = stripParenExpression(setterCall.arguments[0]);
  const unwrappedInitialValue = initializer ? stripParenExpression(initializer) : null;
  if (
    unwrappedInitialValue &&
    isNodeOfType(unwrappedInitialValue, "Literal") &&
    isNodeOfType(nextValue, "Literal")
  ) {
    return Object.is(unwrappedInitialValue.value, nextValue.value);
  }
  const initialValueIsUndefined =
    didOmitInitializer ||
    (isNodeOfType(unwrappedInitialValue, "Identifier") &&
      unwrappedInitialValue.name === "undefined" &&
      context.scopes.isGlobalReference(unwrappedInitialValue)) ||
    (isNodeOfType(unwrappedInitialValue, "UnaryExpression") &&
      unwrappedInitialValue.operator === "void");
  const nextValueIsUndefined =
    (isNodeOfType(nextValue, "Identifier") &&
      nextValue.name === "undefined" &&
      context.scopes.isGlobalReference(nextValue)) ||
    (isNodeOfType(nextValue, "UnaryExpression") && nextValue.operator === "void");
  return initialValueIsUndefined && nextValueIsUndefined;
};

const functionBodyReturns = (node: EsTreeNode): boolean => {
  let hasReturn = false;
  walkAst(node, (child) => {
    if (hasReturn) return false;
    if (child !== node && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) hasReturn = true;
  });
  return hasReturn;
};

const isStateUsedInFirstPaintOutput = (
  context: RuleContext,
  pairedState: PairedStateBinding,
): boolean => {
  const componentFunction = pairedState.componentFunction;
  if (
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(componentFunction.body, "BlockStatement")
  ) {
    return false;
  }
  const componentBody = componentFunction.body;
  const outputDerivedSymbolIds = new Set([pairedState.stateSymbolId]);
  let didAddDerivedSymbol = true;
  while (didAddDerivedSymbol) {
    didAddDerivedSymbol = false;
    walkAst(componentBody, (node) => {
      let bindingIdentifier: EsTreeNodeOfType<"Identifier"> | null = null;
      let derivedExpression: EsTreeNode | null = null;
      if (
        isNodeOfType(node, "VariableDeclarator") &&
        isNodeOfType(node.id, "Identifier") &&
        node.init
      ) {
        bindingIdentifier = node.id;
        derivedExpression = node.init;
      } else if (isNodeOfType(node, "FunctionDeclaration") && node.id) {
        bindingIdentifier = node.id;
        derivedExpression = node;
      }
      if (
        !bindingIdentifier ||
        !derivedExpression ||
        !expressionReadsDerivedSymbol(
          context,
          derivedExpression,
          outputDerivedSymbolIds,
          (identifier) => !isInsideNonVisibleMountAnimationProperty(identifier),
        )
      ) {
        return;
      }
      const symbol = context.scopes.symbolFor(bindingIdentifier);
      if (
        symbol &&
        (symbol.kind === "const" || symbol.kind === "function") &&
        symbol.references.every(
          (reference) =>
            reference.flag === "read" && !isTransparentAssignmentTarget(reference.identifier),
        ) &&
        !outputDerivedSymbolIds.has(symbol.id)
      ) {
        outputDerivedSymbolIds.add(symbol.id);
        didAddDerivedSymbol = true;
      }
    });
  }

  let hasRenderedReference = false;
  walkAst(componentBody, (node) => {
    if (hasRenderedReference) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      !outputDerivedSymbolIds.has(context.scopes.symbolFor(node)?.id ?? -1) ||
      node === pairedState.stateIdentifier
    ) {
      return;
    }
    if (isInsideNonVisibleMountAnimationProperty(node)) return;
    if (isInsideIdOrAriaAttribute(node)) return;
    let descendantNode: EsTreeNode = node;
    let cursor: EsTreeNode | null | undefined = node.parent;
    while (cursor && cursor !== componentBody) {
      if (isNodeOfType(cursor, "JSXAttribute") && isEventHandlerAttribute(cursor)) return;
      if (
        isNodeOfType(cursor, "ReturnStatement") &&
        findEnclosingFunction(cursor) === componentFunction
      ) {
        hasRenderedReference = true;
        return false;
      }
      if (
        isNodeOfType(cursor, "IfStatement") &&
        cursor.test === descendantNode &&
        findEnclosingFunction(cursor) === componentFunction &&
        (functionBodyReturns(cursor.consequent) ||
          (cursor.alternate ? functionBodyReturns(cursor.alternate) : false))
      ) {
        hasRenderedReference = true;
        return false;
      }
      descendantNode = cursor;
      cursor = cursor.parent;
    }
  });
  return hasRenderedReference;
};

const isGlobalWindowMember = (
  context: RuleContext,
  node: EsTreeNode,
  propertyName: string,
): boolean => {
  const member = stripParenExpression(node);
  if (!isNodeOfType(member, "MemberExpression") || member.computed) return false;
  const receiver = stripParenExpression(member.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "window" &&
    context.scopes.isGlobalReference(receiver) &&
    isNodeOfType(member.property, "Identifier") &&
    member.property.name === propertyName
  );
};

const getDirectWindowWidthSetter = (
  context: RuleContext,
  statement: EsTreeNode,
): EsTreeNodeOfType<"CallExpression"> | null => {
  const call = unwrapDiscardedExpression(statement);
  if (!isNodeOfType(call, "CallExpression") || call.arguments?.length !== 1) return null;
  if (!isNodeOfType(call.callee, "Identifier") || !isSetterCall(call)) return null;
  const argument = call.arguments[0];
  return isGlobalWindowMember(context, argument, "innerWidth") ? call : null;
};

const getResizeListenerHandler = (
  context: RuleContext,
  statement: EsTreeNode,
  methodName: "addEventListener" | "removeEventListener",
): EsTreeNodeOfType<"Identifier"> | null => {
  const call = unwrapDiscardedExpression(statement);
  if (!isNodeOfType(call, "CallExpression") || call.arguments?.length !== 2) return null;
  if (!isGlobalWindowMember(context, call.callee, methodName)) return null;
  const eventName = call.arguments[0];
  const handler = call.arguments[1];
  if (!isNodeOfType(eventName, "Literal") || eventName.value !== "resize") return null;
  return isNodeOfType(handler, "Identifier") ? handler : null;
};

const getCleanupResizeHandler = (
  context: RuleContext,
  statement: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  if (!isNodeOfType(statement, "ReturnStatement") || !isFunctionLike(statement.argument)) {
    return null;
  }
  const cleanupStatements = getCallbackStatements(statement.argument);
  if (cleanupStatements.length !== 1) return null;
  return getResizeListenerHandler(
    context,
    unwrapReturnExpression(cleanupStatements[0]),
    "removeEventListener",
  );
};

const findExactViewportState = (
  context: RuleContext,
  componentFunction: EsTreeNode,
  setterCall: EsTreeNodeOfType<"CallExpression">,
): string | null => {
  if (
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(componentFunction.body, "BlockStatement")
  ) {
    return null;
  }
  const componentBody = componentFunction.body;
  if (!isNodeOfType(setterCall.callee, "Identifier")) return null;
  const setterSymbol = context.scopes.symbolFor(setterCall.callee);
  if (
    !setterSymbol ||
    setterSymbol.kind !== "const" ||
    !isNodeOfType(setterSymbol.declarationNode, "VariableDeclarator")
  ) {
    return null;
  }
  const declarator = setterSymbol.declarationNode;
  if (!isNodeOfType(declarator.id, "ArrayPattern")) return null;
  const stateIdentifier = declarator.id.elements?.[0];
  const setterIdentifier = declarator.id.elements?.[1];
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(setterIdentifier, "Identifier") ||
    setterIdentifier !== setterSymbol.bindingIdentifier ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !isReactApiCall(declarator.init, USE_STATE_ONLY, context.scopes, REACT_API_CALL_OPTIONS)
  ) {
    return null;
  }
  const initializer = declarator.init.arguments?.[0];
  if (!isNodeOfType(initializer, "Literal") || initializer.value !== 0) return null;
  const stateSymbol = context.scopes.symbolFor(stateIdentifier);
  if (!stateSymbol) return null;
  const stateDerivedSymbolIds = new Set([stateSymbol.id]);
  let didAddDerivedSymbol = true;
  while (didAddDerivedSymbol) {
    didAddDerivedSymbol = false;
    for (const statement of componentBody.body ?? []) {
      if (!isNodeOfType(statement, "VariableDeclaration")) continue;
      for (const candidateDeclarator of statement.declarations ?? []) {
        if (!isNodeOfType(candidateDeclarator.id, "Identifier") || !candidateDeclarator.init) {
          continue;
        }
        const candidateInitializer = stripParenExpression(candidateDeclarator.init);
        if (
          isFunctionLike(candidateInitializer) ||
          (isNodeOfType(candidateInitializer, "CallExpression") &&
            isReactApiCall(
              candidateInitializer,
              USE_CALLBACK_ONLY,
              context.scopes,
              REACT_API_CALL_OPTIONS,
            ))
        ) {
          continue;
        }
        if (!expressionReadsDerivedSymbol(context, candidateInitializer, stateDerivedSymbolIds)) {
          continue;
        }
        const candidateSymbol = context.scopes.symbolFor(candidateDeclarator.id);
        if (
          candidateSymbol?.kind === "const" &&
          candidateSymbol.references.every(
            (reference) =>
              reference.flag === "read" && !isTransparentAssignmentTarget(reference.identifier),
          ) &&
          !stateDerivedSymbolIds.has(candidateSymbol.id)
        ) {
          stateDerivedSymbolIds.add(candidateSymbol.id);
          didAddDerivedSymbol = true;
        }
      }
    }
  }
  const staticSpreadVisibilityBySymbolId = new Map<number, "visible" | "non-visible" | "unknown">();
  const hasOnlyStaticObjectReferences = (
    identifier: EsTreeNodeOfType<"Identifier">,
    visitedSymbolIds: ReadonlySet<number> = new Set(),
  ): boolean => {
    const symbol = context.scopes.symbolFor(identifier);
    if (!symbol) return false;
    if (visitedSymbolIds.has(symbol.id)) return true;
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    let hasUnknownReference = false;
    walkAst(componentBody, (node) => {
      if (
        hasUnknownReference ||
        !isNodeOfType(node, "Identifier") ||
        context.scopes.symbolFor(node)?.id !== symbol.id ||
        node === symbol.bindingIdentifier
      ) {
        return;
      }
      const referenceRoot = findTransparentExpressionRoot(node);
      const parent = referenceRoot.parent;
      if (isNodeOfType(parent, "JSXSpreadAttribute") && parent.argument === referenceRoot) {
        return;
      }
      if (
        isNodeOfType(parent, "VariableDeclarator") &&
        parent.init === referenceRoot &&
        isNodeOfType(parent.id, "Identifier") &&
        isNodeOfType(parent.parent, "VariableDeclaration") &&
        parent.parent.kind === "const" &&
        hasOnlyStaticObjectReferences(parent.id, nextVisitedSymbolIds)
      ) {
        return;
      }
      hasUnknownReference = true;
      return false;
    });
    return !hasUnknownReference;
  };
  const classifyStaticSpreadObject = (
    identifier: EsTreeNodeOfType<"Identifier">,
    visitedSymbolIds: ReadonlySet<number> = new Set(),
  ): "visible" | "non-visible" | "unknown" => {
    const symbol = context.scopes.symbolFor(identifier);
    if (!symbol || visitedSymbolIds.has(symbol.id)) return "unknown";
    const cachedVisibility = staticSpreadVisibilityBySymbolId.get(symbol.id);
    if (cachedVisibility) return cachedVisibility;
    if (
      symbol.kind !== "const" ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      !isNodeOfType(symbol.declarationNode.id, "Identifier") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier ||
      !symbol.declarationNode.init
    ) {
      return "unknown";
    }
    if (!hasOnlyStaticObjectReferences(identifier)) return "unknown";
    const initializer = stripParenExpression(symbol.declarationNode.init);
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    if (isNodeOfType(initializer, "Identifier")) {
      const visibility = classifyStaticSpreadObject(initializer, nextVisitedSymbolIds);
      staticSpreadVisibilityBySymbolId.set(symbol.id, visibility);
      return visibility;
    }
    if (!isNodeOfType(initializer, "ObjectExpression")) return "unknown";
    let visibility: "visible" | "non-visible" | "unknown" = "non-visible";
    for (const property of initializer.properties ?? []) {
      const propertyName = getStaticObjectPropertyName(property);
      if (!isNodeOfType(property, "Property") || !propertyName) {
        visibility = "unknown";
        break;
      }
      if (
        expressionReadsDerivedSymbol(context, property.value, stateDerivedSymbolIds) &&
        !isNonVisibleJsxSpreadProperty(propertyName)
      ) {
        visibility = "visible";
      }
    }
    staticSpreadVisibilityBySymbolId.set(symbol.id, visibility);
    return visibility;
  };
  let hasNonAriaReference = false;
  walkAst(componentBody, (node) => {
    if (hasNonAriaReference) return false;
    if (
      !isNodeOfType(node, "Identifier") ||
      !stateDerivedSymbolIds.has(context.scopes.symbolFor(node)?.id ?? -1)
    ) {
      return;
    }
    if (findEnclosingFunction(node) !== componentFunction) return;
    const parent = node.parent;
    if (
      parent &&
      ((isNodeOfType(parent, "MemberExpression") && parent.property === node && !parent.computed) ||
        (isNodeOfType(parent, "Property") && parent.key === node && !parent.computed))
    ) {
      return;
    }
    let cursor: EsTreeNode | null | undefined = parent;
    while (cursor && cursor !== componentBody) {
      if (isFunctionLike(cursor)) return;
      if (isNodeOfType(cursor, "JSXSpreadAttribute")) {
        if (isNodeOfType(node, "Identifier") && classifyStaticSpreadObject(node) === "visible") {
          hasNonAriaReference = true;
        }
        return;
      }
      if (isNodeOfType(cursor, "JSXAttribute")) {
        if (isEventHandlerAttribute(cursor)) return;
        if (!isInsideIdOrAriaAttribute(node)) hasNonAriaReference = true;
        return;
      }
      if (isNodeOfType(cursor, "ReturnStatement")) {
        hasNonAriaReference = true;
        return;
      }
      cursor = cursor.parent;
    }
  });
  return hasNonAriaReference ? stateIdentifier.name : null;
};

const isExactViewportSubscriptionEffect = (
  context: RuleContext,
  effectCall: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
): boolean => {
  if (!isReactApiCall(effectCall, USE_EFFECT_ONLY, context.scopes, REACT_API_CALL_OPTIONS)) {
    return false;
  }
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    !isNodeOfType(callback.body, "BlockStatement")
  ) {
    return false;
  }
  const statements = getCallbackStatements(callback);
  if (statements.length !== 4) return false;
  const handlerDeclaration = statements[0];
  if (
    !isNodeOfType(handlerDeclaration, "VariableDeclaration") ||
    handlerDeclaration.kind !== "const" ||
    handlerDeclaration.declarations?.length !== 1
  ) {
    return false;
  }
  const handlerDeclarator = handlerDeclaration.declarations[0];
  if (
    !isNodeOfType(handlerDeclarator.id, "Identifier") ||
    !isFunctionLike(handlerDeclarator.init)
  ) {
    return false;
  }
  const handlerStatements = getCallbackStatements(handlerDeclarator.init);
  if (handlerStatements.length !== 1) return false;
  const handlerSetter = getDirectWindowWidthSetter(
    context,
    unwrapReturnExpression(handlerStatements[0]),
  );
  const subscribedHandler = getResizeListenerHandler(context, statements[1], "addEventListener");
  const immediateSetter = getDirectWindowWidthSetter(context, statements[2]);
  const cleanupHandler = getCleanupResizeHandler(context, statements[3]);
  if (!handlerSetter || !subscribedHandler || !immediateSetter || !cleanupHandler) return false;
  const handlerSymbol = context.scopes.symbolFor(handlerDeclarator.id);
  if (
    !handlerSymbol ||
    context.scopes.symbolFor(subscribedHandler) !== handlerSymbol ||
    context.scopes.symbolFor(cleanupHandler) !== handlerSymbol
  ) {
    return false;
  }
  if (
    !isNodeOfType(handlerSetter.callee, "Identifier") ||
    !isNodeOfType(immediateSetter.callee, "Identifier") ||
    context.scopes.symbolFor(handlerSetter.callee) !==
      context.scopes.symbolFor(immediateSetter.callee)
  ) {
    return false;
  }
  const componentFunction = findEnclosingFunction(effectCall);
  if (
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(componentFunction.body, "BlockStatement")
  ) {
    return false;
  }
  const stateName = findExactViewportState(context, componentFunction, immediateSetter);
  return stateName !== null;
};

export const renderingHydrationNoFlicker = defineRule({
  id: "rendering-hydration-no-flicker",
  title: "useEffect setState flashes on mount",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Initialize state from a render-safe value before the first paint, or read external mutable values with `useSyncExternalStore`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      // useLayoutEffect runs synchronously BEFORE paint, so a mount-time
      // setState there never flashes — it's the canonical DOM-measurement
      // pattern (react.dev "you might not need an effect"). Only the
      // post-paint useEffect variant can flicker.
      if (
        !isReactApiCall(node, USE_EFFECT_ONLY, context.scopes, REACT_API_CALL_OPTIONS) ||
        (node.arguments?.length ?? 0) < 2
      ) {
        return;
      }

      const depsNode = node.arguments[1];
      if (!isNodeOfType(depsNode, "ArrayExpression") || depsNode.elements?.length !== 0) return;

      const callback = getEffectCallback(node);
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      )
        return;

      if (isExactViewportSubscriptionEffect(context, node, callback)) {
        context.report({
          node,
          message: MOUNT_FLASH_MESSAGE,
        });
        return;
      }

      const bodyStatements = getCallbackStatements(callback);
      if (bodyStatements.length !== 1) return;

      const soleStatement = bodyStatements[0];
      if (!isNodeOfType(soleStatement, "ExpressionStatement")) return;
      const expression = soleStatement.expression;
      if (
        isSetterCall(expression) &&
        isNodeOfType(expression, "CallExpression") &&
        isNodeOfType(expression.callee, "Identifier") &&
        isUseStateSetterInScope(expression, expression.callee.name)
      ) {
        const pairedState = findPairedStateBinding(context, expression, expression.callee.name);
        if (!pairedState) return;
        if (isSameMountStateValue(context, pairedState, expression)) return;
        if (!isStateUsedInFirstPaintOutput(context, pairedState)) return;
        if (argumentsReadReactRefCurrent(context, expression.arguments ?? [])) return;
        if (isStateUsedOnlyInIdOrAriaAttributes(context, pairedState)) return;
        // A setter fed by a locale/timezone read is the SSR-safe adoption
        // pattern this rule's sibling (no-locale-format-in-render) tells
        // users to write — the value cannot be produced during render
        // without a hydration mismatch, so the post-mount flash is the
        // correct trade, not a bug.
        if ((expression.arguments ?? []).some(containsLocaleEnvironmentRead)) return;
        context.report({
          node,
          message: MOUNT_FLASH_MESSAGE,
        });
      }
    },
  }),
});
