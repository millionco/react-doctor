import { closureCaptures } from "../../semantic/closure-captures.js";
import type {
  ReferenceDescriptor,
  ScopeAnalysis,
  SymbolDescriptor,
} from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isPropOmittedByPrivateJsxConsumers } from "../../utils/is-prop-omitted-by-private-jsx-consumers.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import {
  hasOpaqueLexicalAccess,
  resolveSimplePropName,
} from "./exhaustive-deps-disabled-terminal-state.js";
import {
  isRefCurrentMember,
  resolveDormantSetActivationProp,
} from "./exhaustive-deps-dormant-set.js";
import { resolvePrivateSnapshotCaptureKeys } from "./exhaustive-deps-private-snapshot-capture.js";

const isPrivateRefSnapshot = (
  statement: EsTreeNode,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(statement, "VariableDeclaration") ||
    statement.kind !== "const" ||
    statement.declarations.length !== 1
  )
    return false;
  const [declaration] = statement.declarations;
  if (!declaration || !isNodeOfType(declaration.id, "Identifier") || !declaration.init)
    return false;
  const member = stripParenExpression(declaration.init);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !isNodeOfType(member.property, "Identifier") ||
    member.property.name !== "current" ||
    !isNodeOfType(member.object, "Identifier")
  )
    return false;
  const ref = scopes.symbolFor(member.object);
  const initializer = ref ? getDirectConstInitializer(ref) : null;
  const program = findProgramRoot(component);
  if (
    !ref ||
    !program ||
    findEnclosingFunction(ref.bindingIdentifier) !== component ||
    !hasCompleteSymbolReferences(ref, program, scopes) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isReactApiCall(initializer, "useRef", scopes)
  )
    return false;
  return ref.references.every(({ identifier, flag }) => {
    const access = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(access, "MemberExpression") ||
      access.object !== identifier ||
      !isRefCurrentMember(access)
    )
      return false;
    const target = findTransparentExpressionRoot(access);
    const consumer = target.parent;
    return (
      !isWithinAssignmentTarget(target) ||
      (isNodeOfType(consumer, "AssignmentExpression") &&
        consumer.operator === "=" &&
        consumer.left === target)
    );
  });
};

const collectDeclaredRecordFieldBindings = (
  record: SymbolDescriptor,
  dependencies: EsTreeNode,
  scopes: ScopeAnalysis,
): Set<string> | null => {
  const initializer = getDirectConstInitializer(record);
  if (
    !isNodeOfType(dependencies, "ArrayExpression") ||
    !isNodeOfType(initializer, "ObjectExpression")
  )
    return null;
  const declared = new Set(
    dependencies.elements.flatMap((element) => {
      const symbol = isNodeOfType(element, "Identifier") && scopes.symbolFor(element);
      return symbol ? [symbol] : [];
    }),
  );
  const fieldNames = new Set<string>();
  const sources = new Set<string>();
  for (const property of initializer.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    const symbol = scopes.symbolFor(property.value);
    if (!name || name === "__proto__" || fieldNames.has(name) || !symbol || !declared.has(symbol))
      return null;
    fieldNames.add(name);
    sources.add(symbol.name);
  }
  return sources.size > 0 ? sources : null;
};

const findGuardedCallbackProp = (
  callback: EsTreeNode,
  component: EsTreeNode,
  references: readonly ReferenceDescriptor[],
  scopes: ScopeAnalysis,
): string | null => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    callback.async ||
    callback.params.length ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return null;
  const statements = callback.body.body;
  const first = statements[0];
  if (!first) return null;
  const guardIndex = isPrivateRefSnapshot(first, component, scopes) ? 1 : 0;
  const guard = statements[guardIndex];
  if (!isNodeOfType(guard, "IfStatement") || guard.alternate) return null;
  const consequence = guard.consequent;
  const returned =
    isNodeOfType(consequence, "BlockStatement") && consequence.body.length === 1
      ? consequence.body[0]
      : consequence;
  if (!isNodeOfType(returned, "ReturnStatement") || returned.argument) return null;
  const unreachable: EsTreeNode[] = statements.slice(guardIndex + 1);
  let condition = stripParenExpression(guard.test);
  while (isNodeOfType(condition, "LogicalExpression") && condition.operator === "||") {
    unreachable.push(condition.right);
    condition = stripParenExpression(condition.left);
  }
  if (!isNodeOfType(condition, "UnaryExpression") || condition.operator !== "!") return null;
  const checked = stripParenExpression(condition.argument);
  const prop = isNodeOfType(checked, "Identifier") ? scopes.symbolFor(checked) : null;
  if (
    !prop ||
    references.some(
      ({ flag, identifier }) =>
        flag !== "read" || !unreachable.some((root) => isAstDescendant(identifier, root)),
    )
  )
    return null;
  return resolveSimplePropName(component, prop, scopes);
};

const findDormantCleanupProp = (
  callback: EsTreeNode,
  component: EsTreeNode,
  references: readonly ReferenceDescriptor[],
  scopes: ScopeAnalysis,
): string | null => {
  if (
    !isFunctionLike(callback) ||
    !isNodeOfType(callback.body, "BlockStatement") ||
    callback.body.body.length !== 1
  )
    return null;
  const register = callback.body.body[0];
  const cleanup = isNodeOfType(register, "ReturnStatement") ? register.argument : null;
  if (
    !isNodeOfType(cleanup, "ArrowFunctionExpression") ||
    cleanup.async ||
    !isNodeOfType(cleanup.body, "BlockStatement") ||
    cleanup.body.body.length !== 1
  )
    return null;
  const loop = cleanup.body.body[0];
  if (
    !isNodeOfType(loop, "ForOfStatement") ||
    loop.await ||
    !isNodeOfType(loop.right, "MemberExpression") ||
    !isRefCurrentMember(loop.right) ||
    !isNodeOfType(loop.right.object, "Identifier") ||
    references.some(({ identifier }) => !isAstDescendant(identifier, loop.body))
  )
    return null;
  const ref = scopes.symbolFor(loop.right.object);
  return ref ? resolveDormantSetActivationProp(ref, component, scopes) : null;
};

export const resolveGuardedRecordCaptureKeys = (
  callback: EsTreeNode,
  record: SymbolDescriptor,
  scopes: ScopeAnalysis,
  filename: string,
): ReadonlySet<string> | null => {
  if (!/\.[jt]sx$/.test(filename)) return null;
  const call = callback.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.arguments[0] !== callback ||
    !isNodeOfType(call.arguments[1], "ArrayExpression")
  )
    return null;
  const component = findEnclosingFunction(callback);
  const program = findProgramRoot(callback);
  if (
    !component ||
    !program ||
    findEnclosingFunction(record.bindingIdentifier) !== component ||
    !hasCompleteSymbolReferences(record, program, scopes)
  )
    return null;
  const dependencies = call.arguments[1];
  if (record.references.some(({ identifier }) => isAstDescendant(identifier, dependencies)))
    return null;
  const references = record.references.filter(({ identifier }) =>
    isAstDescendant(identifier, callback),
  );
  if (!references.length) return null;
  const cleanupEffect = isReactApiCall(call, "useEffect", scopes);
  if (cleanupEffect && !hasOpaqueLexicalAccess(component)) {
    const snapshot = resolvePrivateSnapshotCaptureKeys(
      callback,
      record,
      component,
      dependencies,
      scopes,
    );
    if (
      snapshot &&
      isPropOmittedByPrivateJsxConsumers(component, scopes, filename, snapshot.prop, true)
    )
      return snapshot.keys;
  }
  const sources = collectDeclaredRecordFieldBindings(record, dependencies, scopes);
  if (!sources) return null;
  const prop = cleanupEffect
    ? findDormantCleanupProp(callback, component, references, scopes)
    : isReactApiCall(call, "useCallback", scopes)
      ? findGuardedCallbackProp(callback, component, references, scopes)
      : null;
  return prop !== null &&
    !hasOpaqueLexicalAccess(component) &&
    isPropOmittedByPrivateJsxConsumers(component, scopes, filename, prop, cleanupEffect)
    ? sources
    : null;
};

const GUARDED_RECORD_HOOKS: ReadonlySet<string> = new Set(["useCallback", "useEffect"]);

export const collectGuardedRecordCaptureDependencies = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string,
): void => {
  walkAst(program, (node) => {
    if (
      !isNodeOfType(node, "CallExpression") ||
      !isNodeOfType(node.arguments[1], "ArrayExpression") ||
      !isReactApiCall(node, GUARDED_RECORD_HOOKS, scopes)
    )
      return;
    const callback = node.arguments[0];
    if (!isFunctionLike(callback)) return;
    const records = new Set<SymbolDescriptor>();
    for (const { resolvedSymbol } of closureCaptures(callback, scopes)) {
      if (!resolvedSymbol || records.has(resolvedSymbol)) continue;
      records.add(resolvedSymbol);
      resolveGuardedRecordCaptureKeys(callback, resolvedSymbol, scopes, filename);
    }
  });
};
