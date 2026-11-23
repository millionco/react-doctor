import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import {
  isAfterOmittedCallbackGuard,
  isDirectOwnerDeclarator,
  isRefCurrentMember,
  resolveDormantSetActivationProp,
} from "./exhaustive-deps-dormant-set.js";

const getRefInitializer = (ref: SymbolDescriptor, owner: EsTreeNode, scopes: ScopeAnalysis) => {
  const program = findProgramRoot(owner);
  const initializer = getDirectConstInitializer(ref);
  return program &&
    isDirectOwnerDeclarator(ref.declarationNode, owner) &&
    hasCompleteSymbolReferences(ref, program, scopes) &&
    isNodeOfType(initializer, "CallExpression") &&
    !initializer.optional &&
    initializer.arguments.length === 1 &&
    isReactApiCall(initializer, "useRef", scopes)
    ? initializer
    : null;
};

const getCurrentAccess = (node: EsTreeNode | undefined) =>
  isNodeOfType(node, "MemberExpression") &&
  isNodeOfType(node.object, "Identifier") &&
  isRefCurrentMember(node)
    ? node
    : null;

const isNullLiteral = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") && node.value === null;

const isPermanentlyNullState = (
  condition: EsTreeNode,
  owner: EsTreeNode,
  prop: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(condition, "Identifier")) return false;
  const state = scopes.symbolFor(condition);
  const declaration = state?.declarationNode;
  const program = findProgramRoot(owner);
  if (
    !program ||
    !state ||
    state.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isDirectOwnerDeclarator(declaration, owner) ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== 2 ||
    declaration.id.elements[0] !== state.bindingIdentifier ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    declaration.init.arguments.length !== 1 ||
    !isNullLiteral(declaration.init.arguments[0]) ||
    !isReactApiCall(declaration.init, "useState", scopes) ||
    !hasCompleteSymbolReferences(state, program, scopes) ||
    state.references.some(
      ({ identifier, flag }) => flag !== "read" || isWithinAssignmentTarget(identifier),
    )
  )
    return false;
  const setterId = declaration.id.elements[1];
  const setter = isNodeOfType(setterId, "Identifier") ? scopes.symbolFor(setterId) : null;
  return (
    !!setter &&
    setter.bindingIdentifier === setterId &&
    setter.kind === "const" &&
    hasCompleteSymbolReferences(setter, program, scopes) &&
    setter.references.every(({ identifier, flag }) => {
      const call = identifier.parent;
      return (
        flag === "read" &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === identifier &&
        !call.optional &&
        isAfterOmittedCallbackGuard(call, owner, prop, scopes)
      );
    })
  );
};

const readRecordField = (node: EsTreeNode): string | null => {
  const member = node.parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.object !== node ||
    member.computed ||
    member.optional ||
    isWithinAssignmentTarget(member)
  )
    return null;
  const expression = findTransparentExpressionRoot(member);
  const consumer = expression.parent;
  if (
    (isNodeOfType(consumer, "CallExpression") && consumer.callee === expression) ||
    (isNodeOfType(consumer, "NewExpression") && consumer.callee === expression) ||
    (isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === expression)
  )
    return null;
  return getStaticPropertyName(member);
};

const keepsSiblingSnapshotPrivate = (
  ref: SymbolDescriptor,
  record: SymbolDescriptor,
  fields: ReadonlyMap<string, EsTreeNode>,
  owner: EsTreeNode,
  prop: string,
  scopes: ScopeAnalysis,
): boolean => {
  const initializer = getRefInitializer(ref, owner, scopes);
  const seed = initializer?.arguments[0];
  const program = findProgramRoot(owner);
  if (
    !program ||
    !(
      isNullLiteral(seed) ||
      (isNodeOfType(seed, "Identifier") && scopes.symbolFor(seed) === record)
    )
  )
    return false;

  return ref.references.every(({ identifier, flag }) => {
    const access = getCurrentAccess(identifier.parent ?? undefined);
    if (flag !== "read" || !access || access.object !== identifier) return false;
    if (isAfterOmittedCallbackGuard(access, owner, prop, scopes)) return true;
    const parent = access.parent;
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      parent.left === access &&
      isNodeOfType(parent.right, "Identifier") &&
      scopes.symbolFor(parent.right) === record &&
      isNodeOfType(parent.parent, "ExpressionStatement") &&
      parent.parent.parent === (isFunctionLike(owner) ? owner.body : null)
    )
      return true;
    const name = readRecordField(access);
    if (name !== null) return fields.has(name);
    if (
      !isNodeOfType(parent, "VariableDeclarator") ||
      !isDirectOwnerDeclarator(parent, owner) ||
      !isNodeOfType(parent.id, "Identifier") ||
      parent.init !== access
    )
      return false;
    const alias = scopes.symbolFor(parent.id);
    return (
      !!alias &&
      getDirectConstInitializer(alias) === access &&
      hasCompleteSymbolReferences(alias, program, scopes) &&
      alias.references.every(({ identifier: read, flag: aliasFlag }) => {
        if (aliasFlag !== "read") return false;
        const member = readRecordField(read);
        return member !== null
          ? fields.has(member)
          : isNodeOfType(read.parent, "UnaryExpression") &&
              read.parent.operator === "!" &&
              read.parent.argument === read;
      })
    );
  });
};

const collectSnapshotTestKeys = (
  expression: EsTreeNode,
  previous: SymbolDescriptor,
  record: SymbolDescriptor,
  fields: ReadonlyMap<string, EsTreeNode>,
  declared: ReadonlySet<SymbolDescriptor>,
  scopes: ScopeAnalysis,
  keys: Set<string>,
): boolean => {
  const test = stripParenExpression(expression);
  if (
    (isNodeOfType(test, "LogicalExpression") &&
      (test.operator === "&&" || test.operator === "||")) ||
    (isNodeOfType(test, "BinaryExpression") && (test.operator === "===" || test.operator === "!=="))
  )
    return (
      collectSnapshotTestKeys(test.left, previous, record, fields, declared, scopes, keys) &&
      collectSnapshotTestKeys(test.right, previous, record, fields, declared, scopes, keys)
    );
  if (isNodeOfType(test, "UnaryExpression") && test.operator === "!")
    return collectSnapshotTestKeys(test.argument, previous, record, fields, declared, scopes, keys);
  if (
    !isNodeOfType(test, "MemberExpression") ||
    test.computed ||
    test.optional ||
    !isNodeOfType(test.object, "Identifier")
  )
    return false;
  const object = scopes.symbolFor(test.object);
  const name = getStaticPropertyName(test);
  const value = name === null ? undefined : fields.get(name);
  const captured = isNodeOfType(value, "Identifier") ? scopes.symbolFor(value) : null;
  if ((object !== previous && object !== record) || !captured || !declared.has(captured))
    return false;
  keys.add(captured.name);
  return true;
};

export const resolvePrivateSnapshotCaptureKeys = (
  callback: EsTreeNode,
  record: SymbolDescriptor,
  owner: EsTreeNode,
  dependencies: EsTreeNodeOfType<"ArrayExpression">,
  scopes: ScopeAnalysis,
): { readonly prop: string; readonly keys: ReadonlySet<string> } | null => {
  const initializer = getDirectConstInitializer(record);
  const program = findProgramRoot(owner);
  if (
    !program ||
    !isDirectOwnerDeclarator(record.declarationNode, owner) ||
    !isNodeOfType(initializer, "ObjectExpression") ||
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length > 0 ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 3
  )
    return null;
  const [readStatement, branch, saveStatement] = callback.body.body;
  if (
    !isNodeOfType(readStatement, "VariableDeclaration") ||
    readStatement.kind !== "const" ||
    readStatement.declarations.length !== 1 ||
    !isNodeOfType(branch, "IfStatement") ||
    branch.alternate ||
    !isNodeOfType(branch.consequent, "BlockStatement") ||
    branch.consequent.body.length !== 1 ||
    !isNodeOfType(saveStatement, "ExpressionStatement") ||
    !isNodeOfType(saveStatement.expression, "AssignmentExpression") ||
    saveStatement.expression.operator !== "="
  )
    return null;
  const [snapshot] = readStatement.declarations;
  const { left, right } = saveStatement.expression;
  const read = getCurrentAccess(snapshot?.init ?? undefined);
  const saved = getCurrentAccess(left);
  const previous = isNodeOfType(snapshot?.id, "Identifier") ? scopes.symbolFor(snapshot.id) : null;
  const ref =
    read && isNodeOfType(read.object, "Identifier") ? scopes.symbolFor(read.object) : null;
  const refInitializer = ref && getRefInitializer(ref, owner, scopes);
  const seed = refInitializer?.arguments[0];
  if (
    !previous ||
    !read ||
    !saved ||
    !ref ||
    !isNodeOfType(saved.object, "Identifier") ||
    scopes.symbolFor(saved.object) !== ref ||
    !isNodeOfType(seed, "Identifier") ||
    scopes.symbolFor(seed) !== record ||
    !isNodeOfType(right, "Identifier") ||
    scopes.symbolFor(right) !== record ||
    ref.references.length !== 2 ||
    ref.references.some(
      ({ identifier, flag }) =>
        flag !== "read" || (identifier !== read.object && identifier !== saved.object),
    ) ||
    !hasCompleteSymbolReferences(previous, program, scopes) ||
    previous.references.some(
      ({ identifier, flag }) => flag !== "read" || !isAstDescendant(identifier, branch.test),
    )
  )
    return null;

  const [loop] = branch.consequent.body;
  if (!isNodeOfType(loop, "ForOfStatement") || loop.await) return null;
  const setAccess = getCurrentAccess(loop.right);
  const set =
    setAccess && isNodeOfType(setAccess.object, "Identifier")
      ? scopes.symbolFor(setAccess.object)
      : null;
  const prop = set && resolveDormantSetActivationProp(set, owner, scopes, true);
  if (!prop) return null;

  // Only the fields read by the comparison need declared render bindings.
  const fields = new Map<string, EsTreeNode>();
  for (const field of initializer.properties) {
    if (!isNodeOfType(field, "Property") || field.kind !== "init" || field.computed || field.method)
      return null;
    const name = getStaticPropertyKeyName(field);
    if (!name || name === "__proto__" || fields.has(name)) return null;
    if (!isNodeOfType(field.value, "Identifier")) {
      const access = getCurrentAccess(field.value);
      const fieldRef =
        access && isNodeOfType(access.object, "Identifier")
          ? scopes.symbolFor(access.object)
          : null;
      const initial = fieldRef && getRefInitializer(fieldRef, owner, scopes)?.arguments[0];
      if (!isNodeOfType(initial, "Literal") || typeof initial.value !== "number") return null;
    }
    fields.set(name, field.value);
  }
  const declared = new Set<SymbolDescriptor>();
  for (const dep of dependencies.elements) {
    const binding = isNodeOfType(dep, "Identifier") && scopes.symbolFor(dep);
    if (!binding) return null;
    declared.add(binding);
  }
  const keys = new Set<string>();
  if (
    !collectSnapshotTestKeys(branch.test, previous, record, fields, declared, scopes, keys) ||
    !keys.size
  )
    return null;

  // The final write is unobservable unless some consumer can see snapshot identity.
  const holders = new Set<SymbolDescriptor>();
  for (const { identifier, flag } of record.references) {
    if (flag !== "read") return null;
    if (
      identifier === right ||
      identifier === seed ||
      isAstDescendant(identifier, branch.test) ||
      isAstDescendant(identifier, loop.body) ||
      isAfterOmittedCallbackGuard(identifier, owner, prop, scopes)
    )
      continue;
    if (isAstDescendant(identifier, callback)) return null;
    const parent = identifier.parent;
    const enclosing = parent?.parent;
    if (
      isNodeOfType(parent, "CallExpression") &&
      isNodeOfType(enclosing, "LogicalExpression") &&
      enclosing.operator === "&&" &&
      enclosing.right === parent &&
      isPermanentlyNullState(enclosing.left, owner, prop, scopes)
    )
      continue;
    const name = readRecordField(identifier);
    if (name !== null && fields.has(name)) continue;

    let holder: SymbolDescriptor | null | undefined;
    if (
      isNodeOfType(parent, "CallExpression") &&
      isNodeOfType(enclosing, "VariableDeclarator") &&
      enclosing.init === parent &&
      isNodeOfType(enclosing.id, "Identifier") &&
      parent.arguments[0] === identifier
    ) {
      holder = scopes.symbolFor(enclosing.id);
      if (!holder || getRefInitializer(holder, owner, scopes) !== parent) return null;
    } else if (isNodeOfType(parent, "AssignmentExpression") && parent.right === identifier) {
      const sibling = getCurrentAccess(parent.left);
      holder =
        sibling && isNodeOfType(sibling.object, "Identifier")
          ? scopes.symbolFor(sibling.object)
          : null;
    }
    if (!holder) return null;
    holders.add(holder);
  }
  return [...holders].every((holder) =>
    keepsSiblingSnapshotPrivate(holder, record, fields, owner, prop, scopes),
  )
    ? { prop, keys }
    : null;
};
