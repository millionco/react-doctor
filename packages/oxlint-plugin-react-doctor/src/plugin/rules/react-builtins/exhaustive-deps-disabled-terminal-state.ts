import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticObjectPropertyValue } from "../../utils/get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPropOmittedByPrivateJsxConsumers } from "../../utils/is-prop-omitted-by-private-jsx-consumers.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { resolveReactUseStatePair } from "../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const isPrivateStateRead = (
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
  allowViewAlias: boolean,
): boolean =>
  symbol.references.every((reference) => {
    const parent = reference.identifier.parent;
    if (reference.flag !== "read") return false;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === reference.identifier &&
      getStaticPropertyName(parent) !== null
    ) {
      return (
        !isWithinAssignmentTarget(parent) &&
        (!isNodeOfType(parent.parent, "CallExpression") || parent.parent.callee !== parent) &&
        (!isNodeOfType(parent.parent, "NewExpression") || parent.parent.callee !== parent) &&
        (!isNodeOfType(parent.parent, "TaggedTemplateExpression") || parent.parent.tag !== parent)
      );
    }
    if (
      !allowViewAlias ||
      !isNodeOfType(parent, "ConditionalExpression") ||
      parent.alternate !== reference.identifier ||
      !isNodeOfType(parent.parent, "VariableDeclarator") ||
      parent.parent.init !== parent ||
      !isNodeOfType(parent.parent.id, "Identifier")
    )
      return false;
    const view = scopes.symbolFor(parent.parent.id);
    return Boolean(
      view && getDirectConstInitializer(view) === parent && isPrivateStateRead(view, scopes, false),
    );
  });

const hasPlainTerminalValue = (value: EsTreeNode, member: string, terminal: string): boolean => {
  const expression = stripParenExpression(value);
  if (
    !isNodeOfType(expression, "ObjectExpression") ||
    !expression.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.computed &&
        !property.method &&
        getStaticPropertyKeyName(property) !== "__proto__",
    )
  )
    return false;
  const written = getStaticObjectPropertyValue(expression, member);
  return isNodeOfType(written, "Literal") && written.value === terminal;
};

const sameFunctionBody = (body: EsTreeNode, node: EsTreeNode): boolean => {
  for (let ancestor = node.parent; ancestor; ancestor = ancestor.parent) {
    if (ancestor === body) return true;
  }
  return false;
};

// A callback declared under this early return cannot perform any of the
// alternate writes when its owner received no value for the checked prop.
const findWriterGate = (
  reference: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const call = reference.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== reference) return null;
  let writer = findEnclosingFunction(call);
  while (writer && writer !== component) {
    const parent = findEnclosingFunction(writer);
    if (parent === component) break;
    writer = parent;
  }
  if (!writer || writer === component || !isFunctionLike(writer)) return null;
  const body = writer.body;
  if (!isNodeOfType(body, "BlockStatement") || !sameFunctionBody(body, call)) return null;
  const [guard] = body.body;
  if (!isNodeOfType(guard, "IfStatement") || guard.alternate) return null;
  const consequent =
    isNodeOfType(guard.consequent, "BlockStatement") && guard.consequent.body.length === 1
      ? guard.consequent.body[0]
      : guard.consequent;
  if (!isNodeOfType(consequent, "ReturnStatement") || consequent.argument) return null;
  let test = stripParenExpression(guard.test);
  while (isNodeOfType(test, "LogicalExpression") && test.operator === "||") {
    test = stripParenExpression(test.left);
  }
  if (!isNodeOfType(test, "UnaryExpression") || test.operator !== "!") return null;
  const checked = stripParenExpression(test.argument);
  return isNodeOfType(checked, "Identifier") ? (scopes.symbolFor(checked) ?? null) : null;
};

const resolveSimplePropName = (component: EsTreeNode, binding: SymbolDescriptor): string | null => {
  if (!isFunctionLike(component) || component.params.length !== 1) return null;
  const parameter = component.params[0];
  if (!isNodeOfType(parameter, "ObjectPattern")) return null;
  if (!binding.references.every(({ flag }) => flag === "read")) return null;
  for (const property of parameter.properties) {
    if (
      isNodeOfType(property, "Property") &&
      !property.computed &&
      isNodeOfType(property.key, "Identifier") &&
      property.value === binding.bindingIdentifier
    )
      return property.key.name;
  }
  return null;
};

const hasOpaqueLexicalAccess = (component: EsTreeNode): boolean => {
  let opaque = false;
  walkAst(component, (node) => {
    if (opaque) return false;
    opaque =
      isNodeOfType(node, "WithStatement") ||
      (isNodeOfType(node, "Identifier") && node.name === "eval");
  });
  return opaque;
};

export const endsWithDisabledTerminalStateGuard = (
  callback: EsTreeNode,
  setterReference: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  if (!filename || !/\.[jt]sx$/.test(filename)) return false;
  const call = setterReference.parent;
  const statement = call?.parent;
  const guard = statement?.parent;
  const body = guard?.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== setterReference ||
    call.arguments.length !== 1 ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== statement ||
    guard.alternate ||
    !isNodeOfType(body, "BlockStatement") ||
    body.parent !== callback ||
    body.body.length !== 1
  )
    return false;

  const pair = resolveReactUseStatePair(setterReference, scopes);
  const component = findEnclosingFunction(callback);
  if (
    !pair?.stateSymbol ||
    !component ||
    pair.stateSymbol.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    !isNodeOfType(pair.declarator.init, "CallExpression") ||
    !isReactApiCall(pair.declarator.init, "useState", scopes) ||
    findEnclosingFunction(pair.declarator) !== component ||
    !isPrivateStateRead(pair.stateSymbol, scopes, true) ||
    hasOpaqueLexicalAccess(component)
  )
    return false;

  let predicate = stripParenExpression(guard.test);
  if (isNodeOfType(predicate, "Identifier")) {
    const alias = scopes.symbolFor(predicate);
    const assigned = alias && getDirectConstInitializer(alias);
    if (!assigned || findEnclosingFunction(assigned) !== component) return false;
    predicate = stripParenExpression(assigned);
  }
  while (isNodeOfType(predicate, "LogicalExpression") && predicate.operator === "&&") {
    predicate = stripParenExpression(predicate.left);
  }
  if (
    !isNodeOfType(predicate, "BinaryExpression") ||
    predicate.operator !== "!==" ||
    !isNodeOfType(predicate.left, "MemberExpression") ||
    !isNodeOfType(predicate.left.object, "Identifier") ||
    scopes.symbolFor(predicate.left.object) !== pair.stateSymbol ||
    !isNodeOfType(predicate.right, "Literal") ||
    typeof predicate.right.value !== "string"
  )
    return false;
  const member = getStaticPropertyName(predicate.left);
  const initialized = pair.declarator.init.arguments[0];
  const written = call.arguments[0];
  if (
    !member ||
    !initialized ||
    !written ||
    !hasPlainTerminalValue(initialized, member, predicate.right.value) ||
    !hasPlainTerminalValue(written, member, predicate.right.value)
  )
    return false;

  let prop: SymbolDescriptor | null = null;
  for (const reference of pair.setterSymbol.references) {
    if (reference.identifier === setterReference) continue;
    if (reference.flag !== "read") return false;
    const gate = findWriterGate(reference.identifier, component, scopes);
    if (!gate || (prop && gate !== prop)) return false;
    prop = gate;
  }
  if (!prop) return false;
  const propName = resolveSimplePropName(component, prop);
  return (
    propName !== null && isPropOmittedByPrivateJsxConsumers(component, scopes, filename, propName)
  );
};

// This visits the same literal useEffect shape as the curated check. The
// provider records directory and content probes during either outcome.
export const collectDisabledTerminalGuardDependencies = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string,
): void => {
  walkAst(program, (node) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      node.arguments.length !== 1 ||
      !isReactApiCall(node, "useEffect", scopes)
    )
      return;
    const argument = node.arguments[0];
    if (!argument) return;
    const callback = stripParenExpression(argument);
    if (!isFunctionLike(callback) || !isNodeOfType(callback.body, "BlockStatement")) return;
    const [guard] = callback.body.body;
    if (
      !isNodeOfType(guard, "IfStatement") ||
      !isNodeOfType(guard.consequent, "ExpressionStatement")
    )
      return;
    const setter = guard.consequent.expression;
    if (isNodeOfType(setter, "CallExpression") && isNodeOfType(setter.callee, "Identifier")) {
      endsWithDisabledTerminalStateGuard(callback, setter.callee, scopes, filename);
    }
  });
};
