import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../utils/is-proven-unmodified-global-namespace-reference.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import { isWithinAssignmentTarget } from "../../utils/is-within-assignment-target.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { isAstDescendant } from "../../utils/is-ast-descendant.js";
import {
  findWriterGate,
  resolveOmittedCallbackProp,
  resolveSimplePropName,
} from "./exhaustive-deps-disabled-terminal-state.js";

export const isRefCurrentMember = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyName(node) === "current";

export const isDirectOwnerDeclarator = (node: EsTreeNode, owner: EsTreeNode): boolean =>
  isFunctionLike(owner) &&
  isNodeOfType(owner.body, "BlockStatement") &&
  isNodeOfType(node, "VariableDeclarator") &&
  isNodeOfType(node.parent, "VariableDeclaration") &&
  node.parent.parent === owner.body;

export const isAfterOmittedCallbackGuard = (
  node: EsTreeNode,
  owner: EsTreeNode,
  prop: string,
  scopes: ScopeAnalysis,
): boolean => {
  let writer = findEnclosingFunction(node);
  while (writer && writer !== owner && findEnclosingFunction(writer) !== owner) {
    writer = findEnclosingFunction(writer);
  }
  const declaration = writer?.parent;
  if (
    !isNodeOfType(writer, "ArrowFunctionExpression") ||
    writer.params.length > 0 ||
    !isNodeOfType(writer.body, "BlockStatement") ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    declaration.init !== writer ||
    !isDirectOwnerDeclarator(declaration, owner) ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !writer.body.body.slice(1).some((statement) => isAstDescendant(node, statement))
  )
    return false;
  const gate = findWriterGate(node, owner, scopes);
  return gate !== null && resolveSimplePropName(owner, gate, scopes) === prop;
};

// The iterator stays empty while the only additions remain behind the omitted prop.
export const resolveDormantSetActivationProp = (
  ref: SymbolDescriptor,
  component: EsTreeNode,
  scopes: ScopeAnalysis,
  requireDirectActivationWriter = false,
): string | null => {
  const program = findProgramRoot(component);
  const initializer = getDirectConstInitializer(ref);
  if (
    !program ||
    !hasCompleteSymbolReferences(ref, program, scopes) ||
    !isNodeOfType(initializer, "CallExpression") ||
    findEnclosingFunction(initializer) !== component ||
    !isReactApiCall(initializer, "useRef", scopes) ||
    initializer.arguments.length !== 1
  )
    return null;
  const emptySet = initializer.arguments[0];
  if (
    !isNodeOfType(emptySet, "NewExpression") ||
    emptySet.arguments.length !== 0 ||
    !isNodeOfType(emptySet.callee, "Identifier") ||
    emptySet.callee.name !== "Set" ||
    !isProvenUnmodifiedGlobalNamespaceReference(emptySet.callee, "Set", scopes, undefined, true)
  )
    return null;

  let propertyName: string | null = null;
  const guardedSpreads: EsTreeNode[] = [];
  for (const { identifier, flag } of ref.references) {
    const current = identifier.parent;
    if (
      flag !== "read" ||
      !isNodeOfType(current, "MemberExpression") ||
      current.object !== identifier ||
      !isRefCurrentMember(current) ||
      current.optional ||
      isWithinAssignmentTarget(current)
    )
      return null;
    const consumer = current.parent;
    if (isNodeOfType(consumer, "ForOfStatement") && consumer.right === current && !consumer.await)
      continue;
    if (
      requireDirectActivationWriter &&
      isNodeOfType(consumer, "SpreadElement") &&
      consumer.argument === current &&
      isNodeOfType(consumer.parent, "ArrayExpression")
    ) {
      const array = consumer.parent;
      const method = array.parent;
      const call = method?.parent;
      if (
        array.elements.length !== 1 ||
        !isNodeOfType(method, "MemberExpression") ||
        method.object !== array ||
        method.computed ||
        method.optional ||
        getStaticPropertyName(method) !== "some" ||
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== method ||
        call.optional ||
        call.arguments.length !== 1 ||
        !isNodeOfType(call.arguments[0], "ArrowFunctionExpression")
      )
        return null;
      guardedSpreads.push(call);
      continue;
    }
    if (
      !isNodeOfType(consumer, "MemberExpression") ||
      consumer.object !== current ||
      consumer.optional
    )
      return null;
    const operation = getStaticPropertyName(consumer);
    const call = consumer.parent;
    if (!isNodeOfType(call, "CallExpression") || call.callee !== consumer || call.optional)
      return null;
    if (operation === "delete" || operation === "clear") continue;
    if (operation !== "add" || call.arguments.length !== 1) return null;
    const guard = findWriterGate(call, component, scopes);
    const checked = guard && resolveOmittedCallbackProp(guard, component, scopes);
    if (
      checked === null ||
      (propertyName !== null && checked !== propertyName) ||
      (requireDirectActivationWriter &&
        !isAfterOmittedCallbackGuard(call, component, checked, scopes))
    )
      return null;
    propertyName = checked;
  }
  const activation = propertyName;
  return activation !== null &&
    guardedSpreads.every((spread) =>
      isAfterOmittedCallbackGuard(spread, component, activation, scopes),
    )
    ? activation
    : null;
};
