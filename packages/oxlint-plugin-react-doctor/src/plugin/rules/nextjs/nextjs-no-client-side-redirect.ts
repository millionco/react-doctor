import { STORAGE_OBJECTS } from "../../constants/dom.js";
import { EFFECT_HOOK_NAMES } from "../../constants/react.js";
import {
  collectEffectInvokedFunctions,
  getPromiseChainCallForCallback,
  isPromiseChainCallee,
} from "../../utils/collect-effect-invoked-functions.js";
import { defineRule } from "../../utils/define-rule.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isHookCall } from "../../utils/is-hook-call.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { statementAlwaysExits } from "../../utils/statement-always-exits.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// A destination built from the current location (`router.pathname`,
// `currentUrl.pathname`, `router.asPath`) is same-page URL canonicalization —
// stripping consumed query params, normalizing a tab param — not a redirect
// that flashes the wrong page.
const CURRENT_LOCATION_PROPERTY_NAMES = new Set(["pathname", "asPath"]);

const readsCurrentLocationPath = (node: EsTreeNode): boolean => {
  let found = false;
  walkAst(node, (child) => {
    if (
      isNodeOfType(child, "MemberExpression") &&
      isNodeOfType(child.property, "Identifier") &&
      CURRENT_LOCATION_PROPERTY_NAMES.has(child.property.name)
    ) {
      found = true;
    }
  });
  return found;
};

const isSamePageDestination = (destination: EsTreeNode | undefined): boolean => {
  if (!destination) return false;
  if (isNodeOfType(destination, "ObjectExpression")) {
    const pathnameProperty = (destination.properties ?? []).find(
      (property) =>
        isNodeOfType(property, "Property") &&
        isNodeOfType(property.key, "Identifier") &&
        property.key.name === "pathname",
    );
    return Boolean(
      pathnameProperty &&
      isNodeOfType(pathnameProperty, "Property") &&
      readsCurrentLocationPath(pathnameProperty.value),
    );
  }
  if (readsCurrentLocationPath(destination)) return true;
  if (isNodeOfType(destination, "Identifier")) {
    const binding = findVariableInitializer(destination, destination.name);
    if (binding?.initializer && readsCurrentLocationPath(binding.initializer)) return true;
  }
  return false;
};

// Route groups `(main)` and parallel slots `@modal` never appear in the URL;
// locale-prefix params are filled by i18n middleware, so a locale-less
// literal still targets the same page.
const LOCALE_SEGMENT_PATTERN = /^\[(locale|lng|lang|language)\]$/i;

const derivePageRoutePath = (filename: string | undefined): string | null => {
  if (!filename) return null;
  const normalized = filename.replace(/\\/g, "/");
  const appMatch = normalized.match(/(?:^|\/)app\/(.+)\/page\.[jt]sx?$/);
  const pagesMatch = appMatch
    ? null
    : normalized.match(/(?:^|\/)pages\/(.+?)(?:\/index)?\.[jt]sx?$/);
  const routePart = appMatch?.[1] ?? pagesMatch?.[1];
  if (!routePart) return null;
  const segments = routePart
    .split("/")
    .filter(
      (segment) =>
        !(segment.startsWith("(") && segment.endsWith(")")) &&
        !segment.startsWith("@") &&
        !LOCALE_SEGMENT_PATTERN.test(segment),
    );
  return `/${segments.join("/")}`;
};

const isAuthCallbackRoute = (filename: string | undefined): boolean => {
  const segments = derivePageRoutePath(filename)?.toLowerCase().split("/").filter(Boolean);
  return Boolean(
    segments?.at(-1) === "callback" &&
    segments.some((segment) => segment === "auth" || segment === "oauth"),
  );
};

const isStorageRead = (node: EsTreeNode, context: RuleContext): boolean => {
  const call = stripParenExpression(node);
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "getItem") {
    return false;
  }
  const receiver = stripParenExpression(callee.object);
  return (
    isNodeOfType(receiver, "Identifier") &&
    STORAGE_OBJECTS.has(receiver.name) &&
    context.scopes.isGlobalReference(receiver)
  );
};

const isRequiredStorageValue = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  if (isStorageRead(expression, context)) return true;
  if (!isNodeOfType(expression, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(expression);
  const initializer = symbol && getDirectConstInitializer(symbol);
  return Boolean(initializer && isStorageRead(initializer, context));
};

const callHasRequiredStorageArgument = (node: EsTreeNode, context: RuleContext): boolean => {
  const call = stripParenExpression(node);
  return (
    isNodeOfType(call, "CallExpression") &&
    Boolean(call.arguments?.some((argument) => isRequiredStorageValue(argument, context)))
  );
};

const getOnlyWriteIdentifier = (
  identifier: EsTreeNode,
  context: RuleContext,
): EsTreeNode | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const writes = context.scopes
    .symbolFor(identifier)
    ?.references.filter((reference) => reference.flag !== "read");
  return writes?.length === 1 ? (writes[0]?.identifier ?? null) : null;
};

const CONDITIONAL_CONTROL_TYPES = new Set([
  "WhileStatement",
  "ForStatement",
  "ForInStatement",
  "ForOfStatement",
  "SwitchCase",
  "CatchClause",
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
]);

const isFalseInitializedStorageControl = (
  identifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(identifier);
  const initializer = symbol?.initializer && stripParenExpression(symbol.initializer);
  const writeIdentifier = getOnlyWriteIdentifier(identifier, context);
  const assignment = writeIdentifier?.parent;
  if (
    !symbol ||
    (symbol.kind !== "let" && symbol.kind !== "var") ||
    !initializer ||
    !isNodeOfType(initializer, "Literal") ||
    initializer.value !== false ||
    !writeIdentifier ||
    !assignment ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== writeIdentifier ||
    assignment.range[0] >= identifier.range[0] ||
    findEnclosingFunction(writeIdentifier) !== findEnclosingFunction(identifier)
  ) {
    return false;
  }
  let cursor = writeIdentifier.parent;
  const boundary = findEnclosingFunction(writeIdentifier);
  while (cursor && cursor !== boundary) {
    if (CONDITIONAL_CONTROL_TYPES.has(cursor.type)) return false;
    cursor = cursor.parent;
  }
  const value = stripParenExpression(assignment.right);
  if (!isNodeOfType(value, "BinaryExpression") || value.operator !== "===") return false;
  const left = stripParenExpression(value.left);
  const right = stripParenExpression(value.right);
  return (
    (isRequiredStorageValue(left, context) &&
      isNodeOfType(right, "Literal") &&
      typeof right.value === "string") ||
    (isRequiredStorageValue(right, context) &&
      isNodeOfType(left, "Literal") &&
      typeof left.value === "string")
  );
};

const isMatchingStorageRemoval = (
  statement: EsTreeNode,
  storageRead: EsTreeNode,
  context: RuleContext,
): boolean => {
  const readCall = stripParenExpression(storageRead);
  const removalCall = isNodeOfType(statement, "ExpressionStatement")
    ? stripParenExpression(statement.expression)
    : null;
  if (
    !isNodeOfType(readCall, "CallExpression") ||
    !isNodeOfType(readCall.callee, "MemberExpression") ||
    !isNodeOfType(removalCall, "CallExpression") ||
    !isNodeOfType(removalCall.callee, "MemberExpression") ||
    getStaticPropertyName(removalCall.callee) !== "removeItem"
  ) {
    return false;
  }
  const readReceiver = stripParenExpression(readCall.callee.object);
  const removalReceiver = stripParenExpression(removalCall.callee.object);
  const readKey = readCall.arguments?.[0] && stripParenExpression(readCall.arguments[0]);
  const removalKey = removalCall.arguments?.[0] && stripParenExpression(removalCall.arguments[0]);
  return Boolean(
    isNodeOfType(readReceiver, "Identifier") &&
    isNodeOfType(removalReceiver, "Identifier") &&
    readReceiver.name === removalReceiver.name &&
    context.scopes.isGlobalReference(removalReceiver) &&
    isNodeOfType(readKey, "Literal") &&
    isNodeOfType(removalKey, "Literal") &&
    readKey.value === removalKey.value,
  );
};

const isSavedStorageOverride = (
  identifier: EsTreeNode,
  navigationNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const destinationSymbol = context.scopes.symbolFor(identifier);
  const writeIdentifier = getOnlyWriteIdentifier(identifier, context);
  const assignment = writeIdentifier?.parent;
  const savedIdentifier =
    assignment && isNodeOfType(assignment, "AssignmentExpression")
      ? stripParenExpression(assignment.right)
      : null;
  if (
    !destinationSymbol ||
    (destinationSymbol.kind !== "let" && destinationSymbol.kind !== "var") ||
    !writeIdentifier ||
    !assignment ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== writeIdentifier ||
    assignment.range[0] >= navigationNode.range[0] ||
    findEnclosingFunction(writeIdentifier) !== findEnclosingFunction(navigationNode) ||
    !savedIdentifier ||
    !isNodeOfType(savedIdentifier, "Identifier")
  ) {
    return false;
  }

  const savedSymbol = context.scopes.symbolFor(savedIdentifier);
  const savedInitializer = savedSymbol && getDirectConstInitializer(savedSymbol);
  const assignmentStatement = assignment.parent;
  let branch: EsTreeNode = assignmentStatement ?? assignment;
  while (branch.parent && !isNodeOfType(branch.parent, "IfStatement")) {
    branch = branch.parent;
  }
  const guard = branch.parent;
  const declaration = savedSymbol?.declarationNode.parent;
  const tryBlock = declaration?.parent;
  if (
    !savedSymbol ||
    !savedInitializer ||
    !isStorageRead(savedInitializer, context) ||
    !assignmentStatement ||
    !isNodeOfType(assignmentStatement, "ExpressionStatement") ||
    !guard ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations.length !== 1 ||
    declaration.declarations[0] !== savedSymbol.declarationNode ||
    !tryBlock ||
    !isNodeOfType(tryBlock, "BlockStatement") ||
    tryBlock.body[0] !== declaration ||
    !tryBlock.parent ||
    !isNodeOfType(tryBlock.parent, "TryStatement") ||
    tryBlock.parent.block !== tryBlock ||
    guard.parent !== tryBlock
  ) {
    return false;
  }
  const guardTest = stripParenExpression(guard.test);
  let precedingStatements: EsTreeNode[] | null = null;
  if (guard.consequent === assignmentStatement) {
    precedingStatements = [];
  } else if (isNodeOfType(guard.consequent, "BlockStatement")) {
    const assignmentIndex = guard.consequent.body.findIndex(
      (statement) => statement === assignmentStatement,
    );
    if (assignmentIndex >= 0) precedingStatements = guard.consequent.body.slice(0, assignmentIndex);
  }
  return (
    isNodeOfType(guardTest, "Identifier") &&
    context.scopes.symbolFor(guardTest)?.id === savedSymbol.id &&
    precedingStatements !== null &&
    precedingStatements.every((statement) =>
      isMatchingStorageRemoval(statement, savedInitializer, context),
    )
  );
};

const destinationHasSavedStorageOverride = (
  destination: EsTreeNode | undefined,
  navigationNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!destination) return false;
  const expression = stripParenExpression(destination);
  if (isNodeOfType(expression, "Identifier")) {
    return isSavedStorageOverride(expression, navigationNode, context);
  }
  if (
    !isNodeOfType(expression, "CallExpression") ||
    !isNodeOfType(expression.callee, "Identifier") ||
    expression.callee.name !== "toRouterPath" ||
    context.scopes.symbolFor(expression.callee)?.kind !== "import" ||
    expression.arguments?.length !== 1 ||
    !expression.arguments[0]
  ) {
    return false;
  }
  const importBinding = getImportBindingForName(expression.callee, expression.callee.name);
  if (
    importBinding?.source !== "@/lib/browser-navigation" ||
    importBinding.exportedName !== "toRouterPath"
  ) {
    return false;
  }
  return destinationHasSavedStorageOverride(expression.arguments[0], navigationNode, context);
};

const getResultTruthinessPolarity = (
  condition: EsTreeNode,
  resultSymbolId: number,
  context: RuleContext,
): boolean | null => {
  const expression = stripParenExpression(condition);
  if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
    const polarity = getResultTruthinessPolarity(expression.argument, resultSymbolId, context);
    return polarity === null ? null : !polarity;
  }
  const identifier = isNodeOfType(expression, "MemberExpression")
    ? stripParenExpression(expression.object)
    : expression;
  if (isNodeOfType(expression, "MemberExpression") && getStaticPropertyName(expression) !== "ok") {
    return null;
  }
  return isNodeOfType(identifier, "Identifier") &&
    context.scopes.symbolFor(identifier)?.id === resultSymbolId
    ? true
    : null;
};

const isNavigationResultGated = (
  navigationNode: EsTreeNode,
  functionNode: EsTreeNode,
  resultIdentifier: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isNodeOfType(resultIdentifier, "Identifier")) return false;
  const resultSymbol = context.scopes.symbolFor(resultIdentifier);
  if (
    !resultSymbol ||
    !resultSymbol.references.every((reference) => {
      if (reference.identifier.range[0] >= navigationNode.range[0]) return true;
      if (reference.flag !== "read") return false;
      let usage = reference.identifier;
      while (usage.parent && !isNodeOfType(usage.parent, "IfStatement")) {
        usage = usage.parent;
      }
      return Boolean(
        usage.parent &&
        isNodeOfType(usage.parent, "IfStatement") &&
        usage.parent.test === usage &&
        getResultTruthinessPolarity(usage, resultSymbol.id, context) !== null,
      );
    })
  ) {
    return false;
  }
  let cursor = navigationNode;
  while (cursor.parent && cursor.parent !== functionNode) {
    const parent = cursor.parent;
    if (
      isNodeOfType(parent, "IfStatement") &&
      parent.consequent === cursor &&
      getResultTruthinessPolarity(parent.test, resultSymbol.id, context) === true
    ) {
      return true;
    }
    cursor = parent;
  }
  let statement = navigationNode;
  while (statement.parent && !isNodeOfType(statement.parent, "BlockStatement")) {
    statement = statement.parent;
  }
  const block = statement.parent;
  if (!block || !isNodeOfType(block, "BlockStatement")) return false;
  const statementIndex = block.body.findIndex((candidate) => candidate === statement);
  return block.body
    .slice(0, statementIndex)
    .some(
      (previousStatement) =>
        isNodeOfType(previousStatement, "IfStatement") &&
        !previousStatement.alternate &&
        getResultTruthinessPolarity(previousStatement.test, resultSymbol.id, context) === false &&
        statementAlwaysExits(previousStatement.consequent),
    );
};

const hasStorageControlAncestor = (
  node: EsTreeNode,
  boundary: EsTreeNode,
  context: RuleContext,
): boolean => {
  let cursor = node;
  while (cursor.parent && cursor.parent !== boundary) {
    const parent = cursor.parent;
    if (isNodeOfType(parent, "IfStatement") && parent.consequent === cursor) {
      const condition = stripParenExpression(parent.test);
      if (
        isNodeOfType(condition, "LogicalExpression") &&
        condition.operator === "&&" &&
        (isFalseInitializedStorageControl(condition.left, context) ||
          isFalseInitializedStorageControl(condition.right, context))
      ) {
        return true;
      }
    }
    cursor = parent;
  }
  return false;
};

const isTransformedPromise = (node: EsTreeNode): boolean => {
  const call = stripParenExpression(node);
  return (
    isNodeOfType(call, "CallExpression") && isPromiseChainCallee(stripParenExpression(call.callee))
  );
};

const isAuthCallbackCompletionNavigation = (
  navigationNode: EsTreeNode,
  destination: EsTreeNode | undefined,
  effectCallback: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isAuthCallbackRoute(context.filename)) return false;
  const functionNode = findEnclosingFunction(navigationNode);
  if (!functionNode || !isFunctionLike(functionNode)) return false;

  const promiseCall = getPromiseChainCallForCallback(functionNode);
  if (promiseCall && isNodeOfType(promiseCall, "CallExpression")) {
    const thenCallee = stripParenExpression(promiseCall.callee);
    const source =
      isNodeOfType(thenCallee, "MemberExpression") && getStaticPropertyName(thenCallee) === "then"
        ? stripParenExpression(thenCallee.object)
        : null;
    const resultIdentifier = functionNode.params[0];
    if (
      stripParenExpression(promiseCall.arguments?.[0]) !== functionNode ||
      !source ||
      !isNodeOfType(source, "CallExpression") ||
      isTransformedPromise(source) ||
      !resultIdentifier
    ) {
      return false;
    }
    return (
      isNavigationResultGated(navigationNode, functionNode, resultIdentifier, context) &&
      (callHasRequiredStorageArgument(source, context) ||
        destinationHasSavedStorageOverride(destination, navigationNode, context))
    );
  }

  let didMatchCompletionNavigation = false;
  walkAst(functionNode.body, (child) => {
    if (didMatchCompletionNavigation || (child !== functionNode.body && isFunctionLike(child))) {
      return false;
    }
    if (
      !isNodeOfType(child, "VariableDeclarator") ||
      !isNodeOfType(child.id, "Identifier") ||
      !child.init
    ) {
      return;
    }
    const initializer = stripParenExpression(child.init);
    if (
      isNodeOfType(initializer, "AwaitExpression") &&
      !isTransformedPromise(initializer.argument) &&
      isNavigationResultGated(navigationNode, functionNode, child.id, context)
    ) {
      let immediatelyInvokedFunction: EsTreeNode = functionNode;
      while (
        immediatelyInvokedFunction.parent &&
        immediatelyInvokedFunction.parent.type.startsWith("TS")
      ) {
        immediatelyInvokedFunction = immediatelyInvokedFunction.parent;
      }
      didMatchCompletionNavigation = Boolean(
        immediatelyInvokedFunction.parent &&
        isNodeOfType(immediatelyInvokedFunction.parent, "CallExpression") &&
        immediatelyInvokedFunction.parent.callee === immediatelyInvokedFunction &&
        hasStorageControlAncestor(immediatelyInvokedFunction.parent, effectCallback, context),
      );
    }
  });
  return didMatchCompletionNavigation;
};

const getNavigationDestination = (node: EsTreeNode): EsTreeNode | undefined => {
  if (isNodeOfType(node, "CallExpression")) return node.arguments?.[0];
  if (isNodeOfType(node, "AssignmentExpression")) return node.right;
  return undefined;
};

const isRedirectToOwnRoute = (
  destination: EsTreeNode | undefined,
  filename: string | undefined,
): boolean => {
  if (!destination || !isNodeOfType(destination, "Literal")) return false;
  if (typeof destination.value !== "string") return false;
  const ownRoute = derivePageRoutePath(filename);
  if (!ownRoute) return false;
  const destinationPath = destination.value.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  return destinationPath === ownRoute;
};

// A navigation inside a function the effect re-schedules with
// setTimeout/setInterval is an async polling subscription (payment status,
// job progress) reacting to a later external event — the doc's explicit
// no-event-handler-equivalent carve-out — not a mount-time redirect.
const collectTimerScheduledFunctionNames = (effectCallback: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(effectCallback, (child) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    if (!isNodeOfType(child.callee, "Identifier")) return;
    if (child.callee.name !== "setTimeout" && child.callee.name !== "setInterval") return;
    const scheduled = child.arguments?.[0];
    if (isNodeOfType(scheduled, "Identifier")) names.add(scheduled.name);
  });
  return names;
};

const getFunctionBindingName = (functionNode: EsTreeNode): string | null => {
  if (isNodeOfType(functionNode, "FunctionDeclaration") && functionNode.id) {
    return functionNode.id.name;
  }
  const parent = functionNode.parent;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }
  return null;
};

const isInsidePollingLoop = (
  navigationNode: EsTreeNode,
  effectCallback: EsTreeNode,
  timerScheduledNames: Set<string>,
): boolean => {
  if (timerScheduledNames.size === 0) return false;
  let cursor: EsTreeNode | null | undefined = navigationNode.parent;
  while (cursor && cursor !== effectCallback) {
    if (isFunctionLike(cursor)) {
      const bindingName = getFunctionBindingName(cursor);
      if (bindingName && timerScheduledNames.has(bindingName)) return true;
    }
    cursor = cursor.parent ?? null;
  }
  return false;
};

const describeClientSideNavigation = (node: EsTreeNode): string | null => {
  if (isNodeOfType(node, "CallExpression") && isNodeOfType(node.callee, "MemberExpression")) {
    const receiver = stripParenExpression(node.callee.object);
    const objectName = isNodeOfType(receiver, "Identifier") ? receiver.name : null;
    const methodName = isNodeOfType(node.callee.property, "Identifier")
      ? node.callee.property.name
      : null;
    if (objectName === "router" && (methodName === "push" || methodName === "replace")) {
      return `router.${methodName}() in useEffect flashes the wrong page before redirecting.`;
    }
  }

  if (isNodeOfType(node, "AssignmentExpression") && isNodeOfType(node.left, "MemberExpression")) {
    const objectName = isNodeOfType(node.left.object, "Identifier") ? node.left.object.name : null;
    const propertyName = isNodeOfType(node.left.property, "Identifier")
      ? node.left.property.name
      : null;
    if (objectName === "window" && propertyName === "location") {
      return `window.location assignment in useEffect flashes the wrong page before redirecting.`;
    }
    if (objectName === "location" && propertyName === "href") {
      return `location.href assignment in useEffect flashes the wrong page before redirecting.`;
    }
  }

  return null;
};

// Under `output: "export"` there is no request-time server, so the default
// "use middleware / getServerSideProps" advice is impossible. Keep the
// still-valid client-side + render-time fixes and drop the server-only clause.
const STATIC_EXPORT_RECOMMENDATION =
  'Avoid redirects inside useEffect — they flash the wrong page first. Use an event handler (e.g. onClick), or call redirect() from next/navigation during render (it prerenders a client-side redirect under output: "export"). Middleware and getServerSideProps redirects aren\'t available in a static export.';

export const nextjsNoClientSideRedirect = defineRule({
  id: "nextjs-no-client-side-redirect",
  title: "Client-side redirect for navigation",
  tags: ["test-noise"],
  requires: ["nextjs"],
  severity: "warn",
  recommendation:
    "Avoid redirects inside useEffect. Use an event handler, middleware, or server-side redirect (App Router: redirect() from next/navigation; Pages Router: getServerSideProps redirect)",
  recommendationFor: (hasCapability) =>
    hasCapability("nextjs:static-export") ? STATIC_EXPORT_RECOMMENDATION : undefined,
  create: (context: RuleContext) => {
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isHookCall(node, EFFECT_HOOK_NAMES)) return;
        const callback = getEffectCallback(node);
        if (!callback) return;

        const effectInvokedFunctions = collectEffectInvokedFunctions(callback);
        const timerScheduledNames = collectTimerScheduledFunctionNames(callback);
        walkAst(callback, (child: EsTreeNode) => {
          // Stop at non-invoked nested function boundaries: a navigation inside
          // an event handler registered in the effect runs on a later user
          // interaction, not as part of the mount-time effect, so it must not
          // be flagged — but IIFEs, called local functions, and promise-chain
          // callbacks of effect-body calls do run on mount.
          if (child !== callback && isFunctionLike(child) && !effectInvokedFunctions.has(child)) {
            return false;
          }

          const navigationDescription = describeClientSideNavigation(child);
          if (navigationDescription) {
            const destination = getNavigationDestination(child);
            if (isNodeOfType(child, "CallExpression")) {
              if (isSamePageDestination(destination)) return;
              if (isRedirectToOwnRoute(destination, context.filename)) return;
            }
            if (isInsidePollingLoop(child, callback, timerScheduledNames)) return;
            if (isAuthCallbackCompletionNavigation(child, destination, callback, context)) return;
            context.report({
              node: child,
              message: navigationDescription,
            });
          }
        });
      },
    };
  },
});
