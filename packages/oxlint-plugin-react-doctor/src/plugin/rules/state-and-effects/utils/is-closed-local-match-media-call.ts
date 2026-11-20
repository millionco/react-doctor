import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { isSymbolReadOnly } from "../../../utils/is-symbol-read-only.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

const isGlobalWindow = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === "window" && scopes.isGlobalReference(node);

const isWindowMatchMedia = (node: EsTreeNode, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isGlobalWindow(node.object, scopes) &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === "matchMedia";

const isAvailabilityCheck = (raw: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const node = stripParenExpression(raw);
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "||") {
    return isAvailabilityCheck(node.left, scopes) && isAvailabilityCheck(node.right, scopes);
  }
  if (
    !isNodeOfType(node, "BinaryExpression") ||
    !isNodeOfType(node.left, "UnaryExpression") ||
    node.left.operator !== "typeof" ||
    !isNodeOfType(node.right, "Literal")
  ) {
    return false;
  }
  return (
    (node.operator === "===" &&
      node.right.value === "undefined" &&
      isGlobalWindow(node.left.argument, scopes)) ||
    (node.operator === "!==" &&
      node.right.value === "function" &&
      isWindowMatchMedia(node.left.argument, scopes))
  );
};

const isAbsentReturn = (statement: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const returned =
    isNodeOfType(statement, "BlockStatement") && statement.body.length === 1
      ? statement.body[0]
      : statement;
  if (!isNodeOfType(returned, "ReturnStatement") || !returned.argument) {
    return isNodeOfType(returned, "ReturnStatement");
  }
  const value = stripParenExpression(returned.argument);
  return (
    (isNodeOfType(value, "Literal") && value.value === null) ||
    (isNodeOfType(value, "Identifier") &&
      value.name === "undefined" &&
      scopes.isGlobalReference(value))
  );
};

const readFactoryReturn = (body: EsTreeNode, scopes: ScopeAnalysis): EsTreeNode | null => {
  if (!isNodeOfType(body, "BlockStatement")) return body;
  if (body.body.length === 2) {
    const [earlyExit] = body.body;
    if (
      !isNodeOfType(earlyExit, "IfStatement") ||
      earlyExit.alternate ||
      !isAvailabilityCheck(earlyExit.test, scopes) ||
      !isAbsentReturn(earlyExit.consequent, scopes)
    ) {
      return null;
    }
  } else if (body.body.length !== 1) {
    return null;
  }
  const last = body.body.at(-1);
  return isNodeOfType(last, "ReturnStatement") ? last.argument : null;
};

const MEDIA_LISTENER_METHODS: ReadonlySet<string> = new Set([
  "addEventListener",
  "removeEventListener",
  "addListener",
  "removeListener",
]);

const getOwningLocalConst = (value: EsTreeNode, scopes: ScopeAnalysis): SymbolDescriptor | null => {
  const root = findTransparentExpressionRoot(value);
  const declaration = root.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    declaration.init !== root ||
    isNodeOfType(declaration.parent?.parent, "ExportNamedDeclaration")
  ) {
    return null;
  }
  const symbol = scopes.symbolFor(declaration.id);
  return symbol?.kind === "const" && isSymbolReadOnly(symbol) ? symbol : null;
};

const hasOnlyDirectReactRuntimeUses = (scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(scopes.rootScope.node, "Program")) return false;
  return scopes.rootScope.node.body.every((statement) => {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.source.value !== "react" ||
      statement.importKind === "type"
    ) {
      return true;
    }
    if (statement.attributes?.length || statement.specifiers.length === 0) return false;
    return statement.specifiers.every((specifier) => {
      if (isNodeOfType(specifier, "ImportSpecifier")) {
        const imported = getImportedName(specifier);
        return specifier.importKind === "type" || Boolean(imported && /^use[A-Z]/.test(imported));
      }
      if (
        !isNodeOfType(specifier, "ImportDefaultSpecifier") &&
        !isNodeOfType(specifier, "ImportNamespaceSpecifier")
      )
        return false;
      const binding = scopes.symbolFor(specifier.local);
      return Boolean(
        binding?.references.every(({ identifier, flag }) => {
          if (flag !== "read") return false;
          const receiver = findTransparentExpressionRoot(identifier);
          const method = receiver.parent;
          if (
            !isNodeOfType(method, "MemberExpression") ||
            method.object !== receiver ||
            method.optional ||
            method.computed
          )
            return false;
          const name = getStaticPropertyName(method);
          const callee = findTransparentExpressionRoot(method);
          return Boolean(
            name &&
            /^use[A-Z]/.test(name) &&
            isNodeOfType(callee.parent, "CallExpression") &&
            callee.parent.callee === callee,
          );
        }),
      );
    });
  });
};

const isDirectReactCall = (
  node: EsTreeNode | null | undefined,
  api: "useCallback" | "useSyncExternalStore",
  scopes: ScopeAnalysis,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = stripParenExpression(node.callee);
  const receiver = isNodeOfType(callee, "MemberExpression") ? callee.object : callee;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  return Boolean(
    symbol &&
    isSymbolReadOnly(symbol) &&
    getImportDeclarationForSymbol(symbol)?.source.value === "react" &&
    isReactApiCall(node, api, scopes),
  );
};

const isReactStoreNotification = (
  handler: EsTreeNode,
  registration: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(handler, "Identifier")) return false;
  const subscribe = findEnclosingFunction(registration);
  const binding = scopes.symbolFor(handler);
  if (
    !isNodeOfType(subscribe, "ArrowFunctionExpression") ||
    subscribe.async ||
    !binding ||
    !isSymbolReadOnly(binding) ||
    subscribe.params.length !== 1 ||
    subscribe.params[0] !== binding.bindingIdentifier
  ) {
    return false;
  }
  const callback = findTransparentExpressionRoot(subscribe);
  const wrapper = callback.parent;
  if (
    isDirectReactCall(wrapper, "useSyncExternalStore", scopes) &&
    wrapper.arguments[0] === callback
  ) {
    return hasOnlyDirectReactRuntimeUses(scopes);
  }
  const assigned = isNodeOfType(wrapper, "CallExpression")
    ? isDirectReactCall(wrapper, "useCallback", scopes) &&
      wrapper.arguments[0] === callback &&
      wrapper
    : callback;
  if (!assigned) return false;
  const owner = getOwningLocalConst(assigned, scopes);
  return Boolean(
    owner?.references.length &&
    owner.references.every(({ identifier }) => {
      const subscription = findTransparentExpressionRoot(identifier);
      const call = subscription.parent;
      return (
        isDirectReactCall(call, "useSyncExternalStore", scopes) &&
        call.arguments[0] === subscription
      );
    }) &&
    hasOnlyDirectReactRuntimeUses(scopes),
  );
};

const isSafeRegistrationHandler = (
  method: string,
  registration: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  if (method !== "addListener" && method !== "addEventListener") return true;
  // A spread can change which runtime argument receives the native event.
  if (registration.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))) {
    return false;
  }
  const argument = registration.arguments[method === "addListener" ? 0 : 1];
  return Boolean(
    argument && isReactStoreNotification(stripParenExpression(argument), registration, scopes),
  );
};

const isReadOnlyReceiverUse = (reference: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const receiver = findTransparentExpressionRoot(reference);
  const member = receiver.parent;
  if (isNodeOfType(member, "UnaryExpression") && member.operator === "!") return true;
  if (!isNodeOfType(member, "MemberExpression") || member.object !== receiver) return false;
  const property = getStaticPropertyName(member);
  if (!property || isWithinAssignmentTarget(member)) return false;
  if (property === "matches" || property === "media") return true;
  const access = findTransparentExpressionRoot(member);
  const consumer = access.parent;
  return (
    MEDIA_LISTENER_METHODS.has(property) &&
    ((isNodeOfType(consumer, "CallExpression") &&
      consumer.callee === access &&
      isSafeRegistrationHandler(property, consumer, scopes)) ||
      (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "typeof"))
  );
};

const hasUnescapedMediaQueryResult = (call: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const owner = getOwningLocalConst(call, scopes);
  if (!owner) return false;
  const pending = [owner];
  const visited = new Set<SymbolDescriptor>();
  while (pending.length > 0) {
    const symbol = pending.pop();
    if (!symbol || visited.has(symbol)) continue;
    visited.add(symbol);
    for (const { identifier } of symbol.references) {
      const alias = getOwningLocalConst(identifier, scopes);
      if (alias) {
        pending.push(alias);
      } else if (!isReadOnlyReceiverUse(identifier, scopes)) {
        return false;
      }
    }
  }
  return true;
};

const AMBIENT_BROWSER_NAMES: ReadonlySet<string> = new Set([
  "document",
  "window",
  "globalThis",
  "global",
  "self",
  "Window",
  "MediaQueryList",
  "EventTarget",
  "matchMedia",
  "top",
  "parent",
  "frames",
  "opener",
  "event",
  "frameElement",
  "addEventListener",
  "removeEventListener",
  "require",
  "module",
  "arguments",
  "eval",
  "Function",
]);
const soleMatchMediaCallByScope = new WeakMap<ScopeAnalysis, EsTreeNode | null>();

// A visible browser object escape can replace the factory or a listener
// method before cleanup. For this local proof, only availability checks and
// the factory's own native call may access the ambient browser objects.
const getSoleAmbientMatchMediaCall = (scopes: ScopeAnalysis): EsTreeNode | null => {
  const cached = soleMatchMediaCallByScope.get(scopes);
  if (cached !== undefined) return cached;
  let call: EsTreeNode | null = null;
  let hasOtherAccess = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasOtherAccess) return false;
    if (isNodeOfType(node, "ThisExpression") || isNodeOfType(node, "ImportExpression")) {
      hasOtherAccess = true;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      !scopes.isGlobalReference(node) ||
      (!AMBIENT_BROWSER_NAMES.has(node.name) &&
        !(node.name.startsWith("on") && isWithinAssignmentTarget(node)))
    ) {
      return;
    }
    const root = findTransparentExpressionRoot(node);
    const member = root.parent;
    if (isNodeOfType(member, "UnaryExpression") && member.operator === "typeof") return;
    if (member && isWindowMatchMedia(member, scopes)) {
      const access = findTransparentExpressionRoot(member);
      const consumer = access.parent;
      if (isNodeOfType(consumer, "UnaryExpression") && consumer.operator === "typeof") return;
      if (!call && isNodeOfType(consumer, "CallExpression") && consumer.callee === access) {
        call = consumer;
        return;
      }
    }
    hasOtherAccess = true;
    return false;
  });
  const result = hasOtherAccess ? null : call;
  soleMatchMediaCallByScope.set(scopes, result);
  return result;
};

export const isClosedLocalMatchMediaCall = (raw: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const call = stripParenExpression(raw);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    call.arguments.length !== 1 ||
    isNodeOfType(call.arguments[0], "SpreadElement")
  ) {
    return false;
  }
  const factory = scopes.symbolFor(call.callee);
  if (!factory || !isSymbolReadOnly(factory)) return false;
  const value =
    factory.kind === "function" ? factory.declarationNode : getDirectConstInitializer(factory);
  if (
    !isFunctionLike(value) ||
    value.async ||
    value.generator ||
    value.params.length !== 1 ||
    !isNodeOfType(value.params[0], "Identifier")
  ) {
    return false;
  }
  const returned = readFactoryReturn(value.body, scopes);
  const result = returned ? stripParenExpression(returned) : null;
  if (
    !isNodeOfType(result, "CallExpression") ||
    result.optional ||
    !isNodeOfType(result.callee, "MemberExpression") ||
    !isWindowMatchMedia(result.callee, scopes) ||
    result.arguments.length !== 1 ||
    !isNodeOfType(result.arguments[0], "Identifier") ||
    scopes.symbolFor(result.arguments[0])?.bindingIdentifier !== value.params[0]
  ) {
    return false;
  }
  return (
    getSoleAmbientMatchMediaCall(scopes) === result && hasUnescapedMediaQueryResult(call, scopes)
  );
};
