import {
  TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  TIMER_CLEANUP_CALLEE_NAMES,
} from "../../../constants/dom.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findRenderPhaseComponentOrHook } from "../../../utils/find-render-phase-component-or-hook.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getRangeStart } from "../../../utils/get-range-start.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getSymbolMutationInspector } from "../../../utils/get-symbol-mutation-inspector.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { resolveImportedApiReference } from "../../../utils/resolve-imported-api-reference.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const isDirectTimerRefCurrent = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"MemberExpression"> =>
  isNodeOfType(node, "MemberExpression") &&
  !node.optional &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "current";

const TIMER_CALLBACK_REF_RUNTIME_APIS = new Set([
  ...TIMER_CALLEE_NAMES_REQUIRING_CLEANUP,
  ...TIMER_CLEANUP_CALLEE_NAMES,
  "useCallback",
  "useEffect",
  "useRef",
  "useState",
]);

const TIMER_CALLBACK_REF_OPAQUE_GLOBALS = new Set([
  "eval",
  "Function",
  "Reflect",
  "require",
  "module",
  "process",
  "globalThis",
  "global",
  "window",
  "self",
  "parent",
  "top",
  "frames",
  "opener",
]);

const TIMER_CALLBACK_REF_OPAQUE_MEMBERS = new Set([
  "constructor",
  "__proto__",
  "eval",
  "Function",
  "__defineGetter__",
  "__defineSetter__",
  "defaultView",
  "contentWindow",
  "view",
]);

const callbackRefOpaqueAccessByContext = new WeakMap<RuleContext, boolean>();

const isNumberLiteral = (node: EsTreeNode | null | undefined): boolean =>
  isNodeOfType(node, "Literal") && typeof node.value === "number";

const isProvenFunctionFormTimer = (callee: EsTreeNode, context: RuleContext): boolean => {
  const calleeRoot = findTransparentExpressionRoot(callee);
  const call = calleeRoot.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.callee !== calleeRoot) {
    return false;
  }
  const [handler, delay] = call.arguments;
  return Boolean(
    call.arguments.length === 2 &&
    handler &&
    isNumberLiteral(delay) &&
    hasClosedTimerHandler(handler, context),
  );
};

const hasOpaqueReactCallbackRefAccess = (context: RuleContext): boolean => {
  const cached = callbackRefOpaqueAccessByContext.get(context);
  if (cached !== undefined) return cached;
  const scopes = context.scopes;
  let hasOpaqueAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasOpaqueAccess) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, scopes);
      if (
        property !== null &&
        TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(property) &&
        (!isNodeOfType(node, "MemberExpression") || !isProvenFunctionFormTimer(node, context))
      ) {
        hasOpaqueAccess = true;
      } else if (
        (property !== null && TIMER_CALLBACK_REF_OPAQUE_MEMBERS.has(property)) ||
        (node.computed && property === null)
      ) {
        hasOpaqueAccess = true;
      } else if (
        property &&
        TIMER_CALLBACK_REF_RUNTIME_APIS.has(property) &&
        isNodeOfType(node, "MemberExpression") &&
        isWithinAssignmentTarget(node)
      ) {
        const receiver = stripParenExpression(node.object);
        const symbol = isNodeOfType(receiver, "Identifier") ? scopes.symbolFor(receiver) : null;
        const initializer = symbol && getDirectConstInitializer(symbol);
        hasOpaqueAccess =
          !isNodeOfType(initializer, "ObjectExpression") ||
          initializer.properties.some(
            (entry) =>
              !isNodeOfType(entry, "Property") ||
              entry.computed ||
              entry.kind !== "init" ||
              getStaticPropertyKeyName(entry) === "__proto__",
          );
      }
    } else if (isNodeOfType(node, "Identifier") && scopes.isGlobalReference(node)) {
      const parent = node.parent;
      if (isNodeOfType(parent, "TSTypeQuery") && parent.exprName === node) return;
      if (
        TIMER_CALLBACK_REF_OPAQUE_GLOBALS.has(node.name) ||
        (TIMER_CALLEE_NAMES_REQUIRING_CLEANUP.has(node.name) &&
          !isProvenFunctionFormTimer(node, context)) ||
        (TIMER_CALLBACK_REF_RUNTIME_APIS.has(node.name) &&
          scopes.referenceFor(node)?.flag !== "read")
      ) {
        hasOpaqueAccess = true;
      } else if (node.name === "Object") {
        const member = node.parent;
        const call = member?.parent;
        if (isNodeOfType(member, "MemberExpression") && member.object === node) {
          const property = getResolvedStaticPropertyName(member, scopes);
          if (property === "prototype") return;
          if (
            !member.computed &&
            property !== "setPrototypeOf" &&
            isNodeOfType(call, "CallExpression") &&
            call.callee === member
          ) {
            const target = call.arguments[0];
            if (!target) return;
            const properties = getSymbolMutationInspector(scopes).getMutationPropertyNames(target);
            hasOpaqueAccess =
              properties === null ||
              (properties !== undefined &&
                [...properties].some((property) => TIMER_CALLBACK_REF_RUNTIME_APIS.has(property)));
            return;
          }
        }
        hasOpaqueAccess = true;
      }
    } else if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      (isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        (node.source.value === "module" ||
          node.source.value === "node:module" ||
          (node.source.value === "react" &&
            node.specifiers.some(
              (specifier) =>
                !isNodeOfType(specifier, "ImportSpecifier") ||
                (specifier.importKind !== "type" && getImportedName(specifier) === "default"),
            ))))
    ) {
      hasOpaqueAccess = true;
    }
  });
  callbackRefOpaqueAccessByContext.set(context, hasOpaqueAccess);
  return hasOpaqueAccess;
};

const isNamedReactCallbackRefHook = (
  call: EsTreeNodeOfType<"CallExpression">,
  name: string,
  context: RuleContext,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (call.optional || !isNodeOfType(callee, "Identifier")) return false;
  const symbol = context.scopes.symbolFor(callee);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportSpecifier")) return false;
  const reference = resolveImportedApiReference(callee, context.scopes);
  return reference?.source === "react" && reference.importedName === name;
};

const isPrimitiveTimerStateSource = (expression: EsTreeNode, context: RuleContext): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "number" || typeof value.value === "boolean";
  }
  const symbol = isNodeOfType(value, "Identifier") ? context.scopes.symbolFor(value) : null;
  const initializer = symbol && getDirectConstInitializer(symbol);
  const call = initializer ? stripParenExpression(initializer) : value;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1)
    return false;
  const callee = stripParenExpression(call.callee);
  const argument = stripParenExpression(call.arguments[0]);
  if (
    !isNumberLiteral(argument) &&
    !isNodeOfType(argument, "Identifier") &&
    !(
      isNodeOfType(argument, "BinaryExpression") &&
      argument.operator === "/" &&
      (isNumberLiteral(argument.left) || isNodeOfType(argument.left, "Identifier")) &&
      isNumberLiteral(argument.right)
    )
  )
    return false;
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "ceil" &&
    isProvenUnmodifiedGlobalNamespaceReference(callee.object, "Math", context.scopes, "ceil", true)
  );
};

const isClosedTimerUpdaterExpression = (expression: EsTreeNode, parameter: string): boolean => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Identifier")) return value.name === parameter;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "number" || typeof value.value === "boolean";
  }
  if (isNodeOfType(value, "BinaryExpression")) {
    return (
      value.operator !== "in" &&
      value.operator !== "instanceof" &&
      isClosedTimerUpdaterExpression(value.left, parameter) &&
      isClosedTimerUpdaterExpression(value.right, parameter)
    );
  }
  return (
    isNodeOfType(value, "ConditionalExpression") &&
    isClosedTimerUpdaterExpression(value.test, parameter) &&
    isClosedTimerUpdaterExpression(value.consequent, parameter) &&
    isClosedTimerUpdaterExpression(value.alternate, parameter)
  );
};

const isClosedTimerStateUpdate = (argument: EsTreeNode, context: RuleContext): boolean => {
  const updater = stripParenExpression(argument);
  if (!isNodeOfType(updater, "ArrowFunctionExpression")) {
    return isPrimitiveTimerStateSource(updater, context);
  }
  const [parameter] = updater.params;
  return (
    !updater.async &&
    updater.params.length === 1 &&
    isNodeOfType(parameter, "Identifier") &&
    !isNodeOfType(updater.body, "BlockStatement") &&
    isClosedTimerUpdaterExpression(updater.body, parameter.name)
  );
};

const isClosedTimerSetterCall = (expression: EsTreeNode, context: RuleContext): boolean => {
  const call = stripParenExpression(expression);
  if (!isNodeOfType(call, "CallExpression") || !isNodeOfType(call.callee, "Identifier"))
    return false;
  const setter = context.scopes.symbolFor(call.callee);
  const declaration = setter?.declarationNode;
  if (
    !setter ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements[1] !== setter.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isNamedReactCallbackRefHook(declaration.init, "useState", context) ||
    declaration.init.arguments.length !== 1 ||
    !isPrimitiveTimerStateSource(declaration.init.arguments[0], context)
  ) {
    return false;
  }
  const knownReferences = new Set<EsTreeNode>(
    setter.references.map((reference) => reference.identifier),
  );
  let hasUntrackedReference = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasUntrackedReference) return false;
    if (
      (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
      node.name !== setter.name ||
      node === setter.bindingIdentifier ||
      knownReferences.has(node)
    )
      return;
    const symbol = context.scopes.symbolFor(node);
    if (!symbol || symbol === setter) {
      hasUntrackedReference = true;
      return false;
    }
  });
  return (
    !hasUntrackedReference &&
    setter.references.every((reference) => {
      const update = reference.identifier.parent;
      return (
        reference.flag === "read" &&
        isNodeOfType(update, "CallExpression") &&
        !update.optional &&
        update.callee === reference.identifier &&
        update.arguments.length === 1 &&
        isClosedTimerStateUpdate(update.arguments[0], context)
      );
    })
  );
};

const hasClosedTimerHandler = (argument: EsTreeNode, context: RuleContext): boolean => {
  const handler = stripParenExpression(argument);
  if (!isNodeOfType(handler, "ArrowFunctionExpression") || handler.async || handler.params.length) {
    return false;
  }
  if (!isNodeOfType(handler.body, "BlockStatement")) {
    return isClosedTimerSetterCall(handler.body, context);
  }
  const statements = handler.body.body;
  if (statements.length === 0) return true;
  const [statement] = statements;
  return (
    statements.length === 1 &&
    isNodeOfType(statement, "ExpressionStatement") &&
    isClosedTimerSetterCall(statement.expression, context)
  );
};

const isClosedTimerSetupStatement = (statement: EsTreeNode, context: RuleContext): boolean => {
  if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
    const [declaration] = statement.declarations;
    return Boolean(
      statement.declarations.length === 1 &&
      isNodeOfType(declaration.id, "Identifier") &&
      declaration.init &&
      isPrimitiveTimerStateSource(declaration.init, context),
    );
  }
  if (isNodeOfType(statement, "ExpressionStatement")) {
    return isClosedTimerSetterCall(statement.expression, context);
  }
  if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return false;
  const test = stripParenExpression(statement.test);
  const condition =
    isNodeOfType(test, "UnaryExpression") && test.operator === "!"
      ? stripParenExpression(test.argument)
      : test;
  const branch = statement.consequent;
  const earlyReturn =
    isNodeOfType(branch, "BlockStatement") && branch.body.length === 1 ? branch.body[0] : branch;
  return (
    isNodeOfType(condition, "Identifier") &&
    isNodeOfType(earlyReturn, "ReturnStatement") &&
    !earlyReturn.argument
  );
};

const hasClosedTimerCleanupHandle = (
  allocationCall: EsTreeNode,
  callback: EsTreeNodeOfType<"ArrowFunctionExpression">,
  cleanupReturn: EsTreeNodeOfType<"ReturnStatement">,
  ownerBody: EsTreeNode,
  context: RuleContext,
  matchesTimerRelease: (release: EsTreeNodeOfType<"CallExpression">) => boolean,
): boolean => {
  const allocation = findTransparentExpressionRoot(allocationCall).parent;
  const setupBody = cleanupReturn.parent;
  const setup = findEnclosingFunction(cleanupReturn);
  const effect = setup ? findTransparentExpressionRoot(setup).parent : null;
  if (
    !isNodeOfType(allocationCall, "CallExpression") ||
    !isNodeOfType(allocationCall.callee, "Identifier") ||
    !context.scopes.isGlobalReference(allocationCall.callee) ||
    !allocationCall.arguments[0] ||
    !hasClosedTimerHandler(allocationCall.arguments[0], context) ||
    !isNodeOfType(effect, "CallExpression") ||
    effect.arguments[0] !== setup ||
    !isNamedReactCallbackRefHook(effect, "useEffect", context) ||
    !setup ||
    !isFunctionLike(setup) ||
    setup.async ||
    setup.generator ||
    !isNodeOfType(setupBody, "BlockStatement") ||
    setup.body !== setupBody ||
    !isNodeOfType(allocation, "AssignmentExpression") ||
    allocation.operator !== "=" ||
    !isNodeOfType(allocation.parent, "ExpressionStatement") ||
    setupBody.body[setupBody.body.findIndex((statement) => statement === cleanupReturn) - 1] !==
      allocation.parent ||
    !setupBody.body
      .slice(
        0,
        setupBody.body.findIndex((statement) => statement === allocation.parent),
      )
      .every((statement) => isClosedTimerSetupStatement(statement, context)) ||
    stripParenExpression(allocation.right) !== allocationCall ||
    !isDirectTimerRefCurrent(allocation.left) ||
    !isNodeOfType(allocation.left.object, "Identifier")
  ) {
    return false;
  }
  const timerRef = context.scopes.symbolFor(allocation.left.object);
  const initializer = timerRef && getDirectConstInitializer(timerRef);
  if (
    !timerRef ||
    timerRef.declarationNode.parent?.parent !== ownerBody ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== 1 ||
    !isNodeOfType(initializer.arguments[0], "Literal") ||
    initializer.arguments[0].value !== null ||
    !isNamedReactCallbackRefHook(initializer, "useRef", context)
  ) {
    return false;
  }
  const guard =
    isNodeOfType(callback.body, "BlockStatement") && callback.body.body.length === 1
      ? callback.body.body[0]
      : null;
  if (
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 2
  ) {
    return false;
  }
  const [releaseStatement, resetStatement] = guard.consequent.body;
  const release = isNodeOfType(releaseStatement, "ExpressionStatement")
    ? stripParenExpression(releaseStatement.expression)
    : null;
  const reset = isNodeOfType(resetStatement, "ExpressionStatement")
    ? stripParenExpression(resetStatement.expression)
    : null;
  if (
    !isNodeOfType(release, "CallExpression") ||
    release.optional ||
    release.arguments.length !== 1 ||
    !isNodeOfType(release.callee, "Identifier") ||
    !context.scopes.isGlobalReference(release.callee) ||
    !matchesTimerRelease(release) ||
    !isNodeOfType(reset, "AssignmentExpression") ||
    reset.operator !== "=" ||
    !isNodeOfType(reset.right, "Literal") ||
    reset.right.value !== null
  ) {
    return false;
  }
  const accesses = [allocation.left, guard.test, release.arguments[0], reset.left];
  return (
    accesses.every(
      (access) =>
        isDirectTimerRefCurrent(access) &&
        isNodeOfType(access.object, "Identifier") &&
        context.scopes.symbolFor(access.object) === timerRef,
    ) &&
    timerRef.references.every(({ identifier }) =>
      accesses.some((access) => isDirectTimerRefCurrent(access) && access.object === identifier),
    )
  );
};

export const resolveRenderWrittenTimerCleanupCallback = (
  cleanupCall: EsTreeNodeOfType<"CallExpression">,
  cleanupReturn: EsTreeNodeOfType<"ReturnStatement">,
  allocationCall: EsTreeNode,
  context: RuleContext,
  matchesTimerRelease: (release: EsTreeNodeOfType<"CallExpression">) => boolean,
): EsTreeNode | null => {
  const callee = stripParenExpression(cleanupCall.callee);
  if (
    cleanupCall.optional ||
    cleanupCall.arguments.length !== 0 ||
    !isDirectTimerRefCurrent(callee) ||
    !isNodeOfType(callee.object, "Identifier")
  ) {
    return null;
  }
  const callbackRef = context.scopes.symbolFor(callee.object);
  const refInitializer = callbackRef && getDirectConstInitializer(callbackRef);
  if (
    !callbackRef ||
    !isNodeOfType(refInitializer, "CallExpression") ||
    refInitializer.arguments.length !== 1 ||
    !isNamedReactCallbackRefHook(refInitializer, "useRef", context)
  ) {
    return null;
  }
  const callbackIdentifier = stripParenExpression(refInitializer.arguments[0]);
  const callbackSymbol = isNodeOfType(callbackIdentifier, "Identifier")
    ? context.scopes.symbolFor(callbackIdentifier)
    : null;
  const callbackInitializer = callbackSymbol && getDirectConstInitializer(callbackSymbol);
  const owner = findRenderPhaseComponentOrHook(refInitializer, context.scopes);
  if (
    !callbackSymbol ||
    !owner ||
    !isFunctionLike(owner) ||
    callbackRef.declarationNode.parent?.parent !== owner.body ||
    callbackSymbol.declarationNode.parent?.parent !== owner.body ||
    !isAstDescendant(cleanupCall, owner) ||
    !isNodeOfType(callbackInitializer, "CallExpression") ||
    callbackInitializer.arguments.length !== 2 ||
    !isNamedReactCallbackRefHook(callbackInitializer, "useCallback", context)
  ) {
    return null;
  }
  const callback = stripParenExpression(callbackInitializer.arguments[0]);
  const dependencies = stripParenExpression(callbackInitializer.arguments[1]);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== 0 ||
    !isNodeOfType(dependencies, "ArrayExpression") ||
    dependencies.elements.length !== 0
  ) {
    return null;
  }
  let renderWrite: EsTreeNode | null = null;
  for (const reference of callbackRef.references) {
    if (reference.identifier === callee.object) continue;
    const member = reference.identifier.parent;
    if (!isDirectTimerRefCurrent(member) || member.object !== reference.identifier) {
      return null;
    }
    const assignment = member.parent;
    if (
      renderWrite ||
      !isNodeOfType(assignment, "AssignmentExpression") ||
      assignment.operator !== "=" ||
      assignment.left !== member ||
      !isNodeOfType(assignment.parent, "ExpressionStatement") ||
      assignment.parent.parent !== owner.body ||
      !isNodeOfType(assignment.right, "Identifier") ||
      context.scopes.symbolFor(assignment.right) !== callbackSymbol ||
      (getRangeStart(assignment) ?? Infinity) >= (getRangeStart(cleanupCall) ?? -Infinity)
    ) {
      return null;
    }
    renderWrite = assignment;
  }
  return renderWrite &&
    hasClosedTimerCleanupHandle(
      allocationCall,
      callback,
      cleanupReturn,
      owner.body,
      context,
      matchesTimerRelease,
    ) &&
    !hasOpaqueReactCallbackRefAccess(context)
    ? callback
    : null;
};
