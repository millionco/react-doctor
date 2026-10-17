import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactNamespaceImport } from "../../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  GUARDED_ATTACH_STATEMENT_COUNT,
  GUARDED_CALLBACK_STATEMENT_COUNT,
  NO_VALUE_COUNT,
  SINGLE_VALUE_COUNT,
} from "./callback-map-snapshot/constants.js";
import { getOwnedCallbackMapRefSymbol } from "./get-owned-callback-map-ref-symbol.js";
import { getStableCallbackMapKey } from "./get-stable-callback-map-key.js";
import {
  getSingleStatement,
  readStoreAction,
  type NullDetachActionInput,
} from "./has-equivalent-null-detach-action.js";
import {
  hasSupportedCallbackMapProgram,
  isRuntimeGlobalReference,
} from "./has-supported-callback-map-program.js";
import { isDiscardedCallbackMapFocusObservation } from "./is-discarded-callback-map-focus-observation.js";
import { isReadonlyCallbackMapSymbol } from "./is-readonly-callback-map-symbol.js";

const effectSelectorPermissions = new WeakMap<ScopeAnalysis, ReadonlySet<EsTreeNode>>();

const getEffectSelectorPermissions = (scopes: ScopeAnalysis): ReadonlySet<EsTreeNode> => {
  const cached = effectSelectorPermissions.get(scopes);
  if (cached) return cached;
  const permissions = new Set<EsTreeNode>();
  walkAst(scopes.rootScope.node, (node) => {
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !node.init ||
      !isNodeOfType(node.id, "Identifier") ||
      !isNodeOfType(node.parent, "VariableDeclaration") ||
      node.parent.kind !== "const" ||
      isNodeOfType(node.parent.parent, "ExportNamedDeclaration")
    )
      return undefined;
    const value = stripParenExpression(node.init);
    if (!isNodeOfType(value, "ConditionalExpression")) return undefined;
    const test = stripParenExpression(value.test);
    if (!isNodeOfType(test, "BinaryExpression") || test.operator !== "===") return undefined;
    const operand = stripParenExpression(test.left);
    const comparison = stripParenExpression(test.right);
    if (
      !isNodeOfType(operand, "UnaryExpression") ||
      operand.operator !== "typeof" ||
      !isNodeOfType(operand.argument, "Identifier") ||
      operand.argument.name !== "window" ||
      !isRuntimeGlobalReference(operand.argument, scopes) ||
      !isNodeOfType(comparison, "Literal") ||
      comparison.value !== "undefined"
    )
      return undefined;
    const effect = stripParenExpression(value.consequent);
    const layoutEffect = stripParenExpression(value.alternate);
    if (
      !isNodeOfType(effect, "MemberExpression") ||
      effect.computed ||
      effect.optional ||
      !isNodeOfType(effect.object, "Identifier") ||
      !isNodeOfType(effect.property, "Identifier") ||
      effect.property.name !== "useEffect" ||
      !isReactNamespaceImport(effect.object, scopes) ||
      !isNodeOfType(layoutEffect, "MemberExpression") ||
      layoutEffect.computed ||
      layoutEffect.optional ||
      !isNodeOfType(layoutEffect.object, "Identifier") ||
      !isNodeOfType(layoutEffect.property, "Identifier") ||
      layoutEffect.property.name !== "useLayoutEffect" ||
      scopes.symbolFor(effect.object) !== scopes.symbolFor(layoutEffect.object)
    )
      return undefined;
    const namespace = scopes.symbolFor(effect.object);
    if (
      !namespace ||
      !isReadonlyCallbackMapSymbol(namespace) ||
      (isNodeOfType(namespace.declarationNode, "ImportSpecifier") &&
        namespace.declarationNode.importKind === "type") ||
      (isNodeOfType(namespace.declarationNode.parent, "ImportDeclaration") &&
        namespace.declarationNode.parent.importKind === "type")
    )
      return undefined;
    const selector = scopes.symbolFor(node.id);
    const declarationStart = getNodeStartIndex(node);
    if (
      !selector ||
      selector.kind !== "const" ||
      !isReadonlyCallbackMapSymbol(selector) ||
      !selector.references.length ||
      declarationStart < NO_VALUE_COUNT
    )
      return undefined;
    if (
      !selector.references.every(({ identifier }) => {
        const expression = findTransparentExpressionRoot(identifier);
        const call = expression.parent;
        return (
          getNodeStartIndex(identifier) > declarationStart &&
          isNodeOfType(call, "CallExpression") &&
          !call.optional &&
          call.callee === expression
        );
      })
    )
      return undefined;
    permissions.add(operand.argument);
    permissions.add(effect);
    permissions.add(layoutEffect);
    return undefined;
  });
  effectSelectorPermissions.set(scopes, permissions);
  return permissions;
};

export const hasOwnedGuardedCallbackMapReturn = ({
  attribute,
  scopes,
}: NullDetachActionInput): boolean => {
  const opening = attribute.parent;
  if (
    !isNodeOfType(opening, "JSXOpeningElement") ||
    !isNodeOfType(opening.name, "JSXIdentifier") ||
    !HTML_TAGS.has(opening.name.name) ||
    getAuthoritativeJsxAttribute(opening.attributes, "ref") !== attribute ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  )
    return false;
  const callback = stripParenExpression(attribute.value.expression);
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length !== SINGLE_VALUE_COUNT ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== GUARDED_CALLBACK_STATEMENT_COUNT
  )
    return false;
  const input = callback.params[NO_VALUE_COUNT];
  if (!isNodeOfType(input, "Identifier")) return false;
  const inputSymbol = scopes.symbolFor(input);
  if (!inputSymbol || !isReadonlyCallbackMapSymbol(inputSymbol)) return false;
  const guard = callback.body.body[NO_VALUE_COUNT];
  if (
    !isNodeOfType(guard, "IfStatement") ||
    !guard.alternate ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== GUARDED_ATTACH_STATEMENT_COUNT
  )
    return false;
  const test = stripParenExpression(guard.test);
  if (!isNodeOfType(test, "Identifier") || scopes.symbolFor(test) !== inputSymbol) return false;
  const [registered, returned] = guard.consequent.body;
  const registration = readStoreAction(registered, "set");
  const detachment = readStoreAction(getSingleStatement(guard.alternate), "delete");
  if (
    !registration?.value ||
    !detachment ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !returned.argument
  )
    return false;
  const attached = stripParenExpression(registration.value);
  if (!isNodeOfType(attached, "Identifier") || scopes.symbolFor(attached) !== inputSymbol)
    return false;
  const cleanupFunction = stripParenExpression(returned.argument);
  if (
    !isNodeOfType(cleanupFunction, "ArrowFunctionExpression") ||
    cleanupFunction.async ||
    cleanupFunction.params.length !== NO_VALUE_COUNT ||
    !isNodeOfType(cleanupFunction.body, "BlockStatement")
  )
    return false;
  const cleanupGuard = getSingleStatement(cleanupFunction.body);
  if (!isNodeOfType(cleanupGuard, "IfStatement") || cleanupGuard.alternate) return false;
  const cleanupTest = stripParenExpression(cleanupGuard.test);
  if (!isNodeOfType(cleanupTest, "BinaryExpression") || cleanupTest.operator !== "===")
    return false;
  const observed = readStoreAction(stripParenExpression(cleanupTest.left), "get");
  const compared = stripParenExpression(cleanupTest.right);
  const cleanup = readStoreAction(getSingleStatement(cleanupGuard.consequent), "delete");
  if (
    !observed ||
    !cleanup ||
    !isNodeOfType(compared, "Identifier") ||
    scopes.symbolFor(compared) !== inputSymbol
  )
    return false;
  const actions = [registration, detachment, observed, cleanup];
  const receivers = actions.map((action) => stripParenExpression(action.receiver));
  const selected = receivers[NO_VALUE_COUNT];
  const refSymbol = getOwnedCallbackMapRefSymbol(selected, callback, scopes);
  if (
    !refSymbol ||
    receivers.some(
      (receiver) =>
        !isNodeOfType(receiver, "MemberExpression") ||
        receiver.computed ||
        receiver.optional ||
        !isNodeOfType(receiver.property, "Identifier") ||
        receiver.property.name !== "current" ||
        !isNodeOfType(receiver.object, "Identifier") ||
        scopes.symbolFor(receiver.object) !== refSymbol,
    )
  )
    return false;
  const selectedReceivers = new Set(receivers);
  if (
    !refSymbol.references.every(({ identifier }) => {
      const member = identifier.parent;
      return (
        isNodeOfType(member, "MemberExpression") &&
        member.object === identifier &&
        !member.computed &&
        !member.optional &&
        isNodeOfType(member.property, "Identifier") &&
        member.property.name === "current" &&
        (selectedReceivers.has(member) || isDiscardedCallbackMapFocusObservation(member))
      );
    })
  )
    return false;
  const key = getStableCallbackMapKey(registration.key, callback, scopes);
  return Boolean(
    key &&
    actions.every((action) => getStableCallbackMapKey(action.key, callback, scopes) === key) &&
    hasSupportedCallbackMapProgram(scopes, getEffectSelectorPermissions(scopes)),
  );
};
