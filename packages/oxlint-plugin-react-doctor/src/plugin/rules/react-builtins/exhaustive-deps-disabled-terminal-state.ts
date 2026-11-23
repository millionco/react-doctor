import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
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
export const findWriterGate = (
  write: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  let writer = findEnclosingFunction(write);
  while (writer && writer !== component) {
    const parent = findEnclosingFunction(writer);
    if (parent === component) break;
    writer = parent;
  }
  if (!writer || writer === component || !isFunctionLike(writer)) return null;
  const body = writer.body;
  if (!isNodeOfType(body, "BlockStatement") || !sameFunctionBody(body, write)) return null;
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

export const resolveSimplePropName = (
  component: EsTreeNode,
  binding: SymbolDescriptor,
  scopes: ScopeAnalysis,
): string | null => {
  if (!isFunctionLike(component) || component.params.length !== 1) return null;
  const parameter = component.params[0];
  if (!isNodeOfType(parameter, "ObjectPattern")) return null;
  const program = findProgramRoot(component);
  if (
    !program ||
    !hasCompleteSymbolReferences(binding, program, scopes) ||
    binding.references.some(
      ({ flag, identifier }) => flag !== "read" || isWithinAssignmentTarget(identifier),
    )
  )
    return null;
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

export const hasOpaqueLexicalAccess = (component: EsTreeNode): boolean => {
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
    const call = reference.identifier.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== reference.identifier) return false;
    const gate = findWriterGate(call, component, scopes);
    if (!gate || (prop && gate !== prop)) return false;
    prop = gate;
  }
  if (!prop) return false;
  const propName = resolveSimplePropName(component, prop, scopes);
  return (
    propName !== null && isPropOmittedByPrivateJsxConsumers(component, scopes, filename, propName)
  );
};

const isNullLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === null;

export const resolveOmittedCallbackProp = (
  gate: SymbolDescriptor,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  const direct = resolveSimplePropName(component, gate, scopes);
  if (direct !== null) return direct;
  const initializer = getDirectConstInitializer(gate);
  if (
    !initializer ||
    findEnclosingFunction(initializer) !== component ||
    !isNodeOfType(initializer, "LogicalExpression") ||
    initializer.operator !== "??" ||
    !isNodeOfType(initializer.left, "Identifier") ||
    !isNullLiteral(initializer.right)
  )
    return null;
  const prop = scopes.symbolFor(initializer.left);
  return prop ? resolveSimplePropName(component, prop, scopes) : null;
};

const isCurrentMember = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  getStaticPropertyName(node) === "current";

const findDisabledRefProp = (
  ref: SymbolDescriptor,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): string | null => {
  let propName: string | null = null;
  for (const { flag, identifier } of ref.references) {
    const member = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      !isCurrentMember(member)
    )
      return null;
    if (!isWithinAssignmentTarget(member)) continue;
    const write = member.parent;
    if (
      !isNodeOfType(write, "AssignmentExpression") ||
      write.operator !== "=" ||
      write.left !== member ||
      member.optional
    )
      return null;
    if (isNullLiteral(stripParenExpression(write.right))) continue;
    const gate = findWriterGate(write, component, scopes);
    const writtenBy = gate && resolveOmittedCallbackProp(gate, component, scopes);
    if (writtenBy === null || (propName !== null && writtenBy !== propName)) return null;
    propName = writtenBy;
  }
  return propName;
};

export const hasUnreachableRefGuardedStateWrite = (
  callback: EsTreeNode,
  setterReference: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  if (!filename || !/\.[jt]sx$/.test(filename)) return false;
  const call = setterReference.parent;
  const statement = call?.parent;
  const branch = statement?.parent;
  const guard = branch?.parent;
  const body = guard?.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== setterReference ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(branch, "BlockStatement") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== branch ||
    !isNodeOfType(body, "BlockStatement") ||
    body.parent !== callback ||
    body.body[1] !== guard
  )
    return false;

  let predicate = stripParenExpression(guard.test);
  while (isNodeOfType(predicate, "LogicalExpression") && predicate.operator === "&&") {
    predicate = stripParenExpression(predicate.left);
  }
  if (
    !isNodeOfType(predicate, "BinaryExpression") ||
    predicate.operator !== "!==" ||
    !isNodeOfType(predicate.left, "Identifier") ||
    !isNullLiteral(predicate.right)
  )
    return false;

  const snapshot = scopes.symbolFor(predicate.left);
  const read = snapshot && getDirectConstInitializer(snapshot);
  const declaration = body.body[0];
  if (
    !read ||
    !isNodeOfType(read, "MemberExpression") ||
    !isCurrentMember(read) ||
    !isNodeOfType(read.object, "Identifier") ||
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.declarations.length !== 1 ||
    declaration.declarations[0]?.init !== read
  )
    return false;

  const component = findEnclosingFunction(callback);
  const ref = scopes.symbolFor(read.object);
  const initialized = ref && getDirectConstInitializer(ref);
  if (
    !component ||
    !ref ||
    !initialized ||
    findEnclosingFunction(initialized) !== component ||
    !isNodeOfType(initialized, "CallExpression") ||
    !isReactApiCall(initialized, "useRef", scopes) ||
    initialized.arguments.length !== 1 ||
    !initialized.arguments[0] ||
    !isNullLiteral(initialized.arguments[0]) ||
    hasOpaqueLexicalAccess(component)
  )
    return false;

  const propName = findDisabledRefProp(ref, component, scopes);
  return (
    propName !== null && isPropOmittedByPrivateJsxConsumers(component, scopes, filename, propName)
  );
};

const isPrivateStateOrLocalViewRead = (state: SymbolDescriptor, scopes: ScopeAnalysis): boolean =>
  state.references.every((reference) => {
    const parent = reference.identifier.parent;
    if (
      reference.flag !== "read" ||
      !isNodeOfType(parent, "VariableDeclarator") ||
      parent.init !== reference.identifier ||
      !isNodeOfType(parent.id, "Identifier")
    )
      return isPrivateStateRead({ ...state, references: [reference] }, scopes, false);
    const local = scopes.symbolFor(parent.id);
    return (
      local?.kind === "let" &&
      local.bindingIdentifier === parent.id &&
      local.references.every((use) => {
        const target = use.identifier.parent;
        if (
          isNodeOfType(target, "AssignmentExpression") &&
          target.operator === "=" &&
          target.left === use.identifier
        )
          return true;
        // React stores this identity for comparison without exposing the state.
        if (
          use.flag === "read" &&
          isNodeOfType(target, "ArrayExpression") &&
          isNodeOfType(target.parent, "CallExpression") &&
          target.parent.arguments.length === 2 &&
          target.parent.arguments[1] === target &&
          isReactApiCall(target.parent, "useCallback", scopes)
        )
          return true;
        return isPrivateStateRead({ ...local, references: [use] }, scopes, false);
      })
    );
  });

const isTerminalResetArm = (
  write: EsTreeNode,
  component: EsTreeNode,
  state: SymbolDescriptor,
  member: string,
  terminal: string,
  scopes: ScopeAnalysis,
): boolean => {
  const statement = write.parent;
  const block = statement?.parent;
  const guard = block?.parent;
  if (
    !isNodeOfType(block, "BlockStatement") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== block ||
    findEnclosingFunction(write) !== component
  )
    return false;
  const test = stripParenExpression(guard.test);
  return (
    isNodeOfType(test, "BinaryExpression") &&
    test.operator === "!==" &&
    isNodeOfType(test.left, "MemberExpression") &&
    isNodeOfType(test.left.object, "Identifier") &&
    scopes.symbolFor(test.left.object) === state &&
    getStaticPropertyName(test.left) === member &&
    isNodeOfType(test.right, "Literal") &&
    test.right.value === terminal
  );
};

export const hasNeverArmedTerminalStateReset = (
  callback: EsTreeNode,
  setterReference: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string | undefined,
): boolean => {
  if (!filename || !/\.[jt]sx$/.test(filename)) return false;
  const call = setterReference.parent;
  const statement = call?.parent;
  const branch = statement?.parent;
  const guard = branch?.parent;
  const body = guard?.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.callee !== setterReference ||
    call.arguments.length !== 1 ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    !isNodeOfType(branch, "BlockStatement") ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.consequent !== branch ||
    !isNodeOfType(body, "BlockStatement") ||
    body.parent !== callback ||
    body.body.length !== 1
  )
    return false;
  const test = stripParenExpression(guard.test);
  if (
    !isNodeOfType(test, "MemberExpression") ||
    !isCurrentMember(test) ||
    !isNodeOfType(test.object, "Identifier")
  )
    return false;

  const component = findEnclosingFunction(callback);
  const ref = scopes.symbolFor(test.object);
  const refInit = ref && getDirectConstInitializer(ref);
  const pair = resolveReactUseStatePair(setterReference, scopes);
  const state = pair?.stateSymbol;
  const stateInit = pair?.declarator.init;
  if (
    !component ||
    !ref ||
    !refInit ||
    findEnclosingFunction(refInit) !== component ||
    !isNodeOfType(refInit, "CallExpression") ||
    !isReactApiCall(refInit, "useRef", scopes) ||
    refInit.arguments.length !== 1 ||
    !isNodeOfType(refInit.arguments[0], "Literal") ||
    refInit.arguments[0].value !== false ||
    !pair ||
    !state ||
    state.kind !== "const" ||
    pair.setterSymbol.kind !== "const" ||
    !isNodeOfType(stateInit, "CallExpression") ||
    !isReactApiCall(stateInit, "useState", scopes) ||
    findEnclosingFunction(stateInit) !== component ||
    !isPrivateStateOrLocalViewRead(state, scopes) ||
    hasOpaqueLexicalAccess(component)
  )
    return false;

  let arm: EsTreeNode | undefined;
  for (const { flag, identifier } of ref.references) {
    const member = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== identifier ||
      !isCurrentMember(member)
    )
      return false;
    if (!isWithinAssignmentTarget(member)) continue;
    const write = member.parent;
    if (
      !isNodeOfType(write, "AssignmentExpression") ||
      write.operator !== "=" ||
      write.left !== member ||
      member.optional ||
      !isNodeOfType(write.right, "Literal")
    )
      return false;
    if (write.right.value === false) continue;
    if (write.right.value !== true || arm) return false;
    arm = write;
  }

  const armGuard = arm?.parent?.parent?.parent;
  const armTest = isNodeOfType(armGuard, "IfStatement")
    ? stripParenExpression(armGuard.test)
    : null;
  if (
    !arm ||
    !isNodeOfType(armTest, "BinaryExpression") ||
    !isNodeOfType(armTest.left, "MemberExpression") ||
    !isNodeOfType(armTest.right, "Literal") ||
    typeof armTest.right.value !== "string"
  )
    return false;
  const member = getStaticPropertyName(armTest.left);
  const terminal = armTest.right.value;
  const initial = stateInit.arguments[0];
  const reset = call.arguments[0];
  if (
    !member ||
    !initial ||
    !reset ||
    !isTerminalResetArm(arm, component, state, member, terminal, scopes) ||
    !hasPlainTerminalValue(initial, member, terminal) ||
    !hasPlainTerminalValue(reset, member, terminal)
  )
    return false;

  let propName: string | null = null;
  for (const { flag, identifier } of pair.setterSymbol.references) {
    if (identifier === setterReference) continue;
    const write = identifier.parent;
    if (flag !== "read" || !isNodeOfType(write, "CallExpression") || write.callee !== identifier)
      return false;
    const gate = findWriterGate(write, component, scopes);
    const writtenBy = gate && resolveOmittedCallbackProp(gate, component, scopes);
    if (writtenBy === null || (propName !== null && writtenBy !== propName)) return false;
    propName = writtenBy;
  }
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
    const [terminalGuard, refGuard] = callback.body.body;
    if (
      isNodeOfType(terminalGuard, "IfStatement") &&
      isNodeOfType(terminalGuard.consequent, "ExpressionStatement")
    ) {
      const setter = terminalGuard.consequent.expression;
      if (isNodeOfType(setter, "CallExpression") && isNodeOfType(setter.callee, "Identifier")) {
        endsWithDisabledTerminalStateGuard(callback, setter.callee, scopes, filename);
      }
    }
    for (const [guard, prove] of [
      [refGuard, hasUnreachableRefGuardedStateWrite],
      [terminalGuard, hasNeverArmedTerminalStateReset],
    ] as const) {
      if (!isNodeOfType(guard, "IfStatement") || !isNodeOfType(guard.consequent, "BlockStatement"))
        continue;
      for (const statement of guard.consequent.body) {
        if (!isNodeOfType(statement, "ExpressionStatement")) continue;
        const setter = statement.expression;
        if (
          isNodeOfType(setter, "CallExpression") &&
          isNodeOfType(setter.callee, "Identifier") &&
          resolveReactUseStatePair(setter.callee, scopes)
        )
          prove(callback, setter.callee, scopes, filename);
      }
    }
  });
};
