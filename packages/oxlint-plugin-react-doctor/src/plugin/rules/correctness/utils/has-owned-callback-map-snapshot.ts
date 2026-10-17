import { HTML_TAGS } from "../../../constants/html-tags.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import {
  NO_VALUE_COUNT,
  SINGLE_VALUE_COUNT,
  SNAPSHOT_ACTION_COUNT,
  SNAPSHOT_STATEMENT_COUNT,
} from "./callback-map-snapshot/constants.js";
import { getOwnedCallbackMapRefSymbol } from "./get-owned-callback-map-ref-symbol.js";
import { getStableCallbackMapKey as getStableKey } from "./get-stable-callback-map-key.js";
import {
  getSingleStatement,
  readReturnedAction,
  readStoreAction,
  type NullDetachActionInput,
  type StoreAction,
} from "./has-equivalent-null-detach-action.js";
import { hasSupportedCallbackMapProgram as hasSupportedProgram } from "./has-supported-callback-map-program.js";
import { isDiscardedCallbackMapFocusObservation as isDiscardedFocusObservation } from "./is-discarded-callback-map-focus-observation.js";
import { isReadonlyCallbackMapSymbol as isReadonly } from "./is-readonly-callback-map-symbol.js";

const hasClosedRef = (
  current: EsTreeNode,
  snapshot: EsTreeNode,
  callback: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const refSymbol = getOwnedCallbackMapRefSymbol(current, callback, scopes);
  if (!refSymbol) return false;
  return refSymbol.references.every(({ identifier }) => {
    const member = identifier.parent;
    if (
      !member ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      member.computed ||
      member.optional ||
      !isNodeOfType(member.property, "Identifier") ||
      member.property.name !== "current"
    )
      return false;
    return member === current ? member.parent === snapshot : isDiscardedFocusObservation(member);
  });
};

export const hasOwnedCallbackMapSnapshot = ({
  attribute,
  scopes,
}: NullDetachActionInput): boolean => {
  const opening = attribute.parent;
  if (
    !opening ||
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
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.params.length !== SINGLE_VALUE_COUNT
  )
    return false;
  const input = callback.params[NO_VALUE_COUNT];
  if (!isNodeOfType(input, "Identifier")) return false;
  const inputSymbol = scopes.symbolFor(input);
  if (
    !inputSymbol ||
    !isReadonly(inputSymbol) ||
    callback.body.body.length !== SNAPSHOT_STATEMENT_COUNT
  )
    return false;
  const [declaration, guard, returned] = callback.body.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== SINGLE_VALUE_COUNT ||
    !isNodeOfType(guard, "IfStatement") ||
    !guard.alternate
  )
    return false;
  const snapshot = declaration.declarations[NO_VALUE_COUNT];
  if (!isNodeOfType(snapshot.id, "Identifier") || !snapshot.init) return false;
  const snapshotSymbol = scopes.symbolFor(snapshot.id);
  const test = stripParenExpression(guard.test);
  if (
    !snapshotSymbol ||
    !isReadonly(snapshotSymbol) ||
    !isNodeOfType(test, "Identifier") ||
    scopes.symbolFor(test) !== inputSymbol
  )
    return false;
  const registration = readStoreAction(getSingleStatement(guard.consequent), "set");
  const detachment = readStoreAction(getSingleStatement(guard.alternate), "delete");
  const cleanup = readReturnedAction(returned);
  if (!registration?.value || !detachment || !cleanup) return false;
  const attached = stripParenExpression(registration.value);
  if (!isNodeOfType(attached, "Identifier") || scopes.symbolFor(attached) !== inputSymbol)
    return false;
  const actions: StoreAction[] = [registration, detachment, cleanup];
  const receivers = actions.map((action) => stripParenExpression(action.receiver));
  if (
    receivers.some(
      (receiver) =>
        !isNodeOfType(receiver, "Identifier") || scopes.symbolFor(receiver) !== snapshotSymbol,
    ) ||
    snapshotSymbol.references.length !== SNAPSHOT_ACTION_COUNT ||
    snapshotSymbol.references.some(({ identifier }) => !receivers.includes(identifier))
  )
    return false;
  const key = getStableKey(registration.key, callback, scopes);
  return Boolean(
    key &&
    actions.every((action) => getStableKey(action.key, callback, scopes) === key) &&
    hasClosedRef(stripParenExpression(snapshot.init), snapshot, callback, scopes) &&
    hasSupportedProgram(scopes),
  );
};
