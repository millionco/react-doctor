import { containsLocaleEnvironmentRead } from "../../utils/contains-locale-environment-read.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getCallbackStatements } from "../../utils/get-callback-statements.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isEventHandlerAttribute } from "../../utils/is-event-handler-attribute.js";
import { isHookCall } from "../../utils/is-hook-call.js";
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

const expressionReadsDerivedSymbol = (
  context: RuleContext,
  expression: EsTreeNode,
  stateDerivedSymbolIds: ReadonlySet<number>,
): boolean => {
  let readsDerivedSymbol = false;
  walkAst(expression, (node) => {
    if (readsDerivedSymbol) return false;
    if (node !== expression && isFunctionLike(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      stateDerivedSymbolIds.has(context.scopes.symbolFor(node)?.id ?? -1)
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
const argumentsReadRefCurrent = (callArguments: EsTreeNode[]): boolean =>
  callArguments.some((argument) => {
    let readsCurrent = false;
    walkAst(argument, (child) => {
      if (
        isNodeOfType(child, "MemberExpression") &&
        isNodeOfType(child.property, "Identifier") &&
        child.property.name === "current"
      ) {
        readsCurrent = true;
      }
    });
    return readsCurrent;
  });

const findPairedStateName = (setterCall: EsTreeNode, setterName: string): string | null => {
  let cursor: EsTreeNode | null | undefined = setterCall;
  while (cursor) {
    if (isNodeOfType(cursor, "BlockStatement") || isNodeOfType(cursor, "Program")) {
      for (const statement of cursor.body ?? []) {
        if (!isNodeOfType(statement, "VariableDeclaration")) continue;
        for (const declarator of statement.declarations ?? []) {
          if (!isNodeOfType(declarator.init, "CallExpression")) continue;
          if (!isHookCall(declarator.init, "useState")) continue;
          if (!isNodeOfType(declarator.id, "ArrayPattern")) continue;
          const elements = declarator.id.elements ?? [];
          const setterElement = elements[1];
          const stateElement = elements[0];
          if (
            isNodeOfType(setterElement, "Identifier") &&
            setterElement.name === setterName &&
            isNodeOfType(stateElement, "Identifier")
          ) {
            return stateElement.name;
          }
        }
      }
    }
    cursor = cursor.parent ?? null;
  }
  return null;
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

// State that only feeds `id` / `aria-*` attributes (generated description
// ids for aria wiring) changes nothing users can see — no flicker.
const isStateUsedOnlyInIdOrAriaAttributes = (
  setterCall: EsTreeNode,
  setterName: string,
): boolean => {
  const stateName = findPairedStateName(setterCall, setterName);
  if (!stateName) return false;
  const programRoot = findProgramRoot(setterCall);
  if (!programRoot) return false;
  let referenceCount = 0;
  let nonAriaReferenceFound = false;
  walkAst(programRoot, (node) => {
    if (!isNodeOfType(node, "Identifier") || node.name !== stateName) return;
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
  requires: ["ssr"],
  severity: "warn",
  recommendation:
    "Read the value with `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` inside a reusable hook, or add `suppressHydrationWarning` to the element",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      // useLayoutEffect runs synchronously BEFORE paint, so a mount-time
      // setState there never flashes — it's the canonical DOM-measurement
      // pattern (react.dev "you might not need an effect"). Only the
      // post-paint useEffect variant can flicker.
      if (!isHookCall(node, USE_EFFECT_ONLY) || (node.arguments?.length ?? 0) < 2) return;

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
          message:
            "This flashes for your users because useEffect(setState, []) runs after the first paint, so use useSyncExternalStore, or add suppressHydrationWarning",
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
        if (argumentsReadRefCurrent(expression.arguments ?? [])) return;
        if (isStateUsedOnlyInIdOrAriaAttributes(expression, expression.callee.name)) return;
        // A setter fed by a locale/timezone read is the SSR-safe adoption
        // pattern this rule's sibling (no-locale-format-in-render) tells
        // users to write — the value cannot be produced during render
        // without a hydration mismatch, so the post-mount flash is the
        // correct trade, not a bug.
        if ((expression.arguments ?? []).some(containsLocaleEnvironmentRead)) return;
        context.report({
          node,
          message:
            "This flashes for your users because useEffect(setState, []) runs after the first paint, so use useSyncExternalStore, or add suppressHydrationWarning",
        });
      }
    },
  }),
});
