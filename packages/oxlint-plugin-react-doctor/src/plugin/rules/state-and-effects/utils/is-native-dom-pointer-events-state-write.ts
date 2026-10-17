import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { getRootIdentifier } from "../../../utils/get-root-identifier.js";
import { getUninterruptedConstInitializer } from "../../../utils/get-uninterrupted-const-initializer.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { isBindingAssignmentTarget } from "../../../utils/is-binding-assignment-target.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "../../../utils/is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isUnmodifiedLocalReactStateCall } from "../../../utils/is-unmodified-local-react-state-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import {
  FIRST_ARGUMENT_INDEX,
  SECOND_ARGUMENT_INDEX,
  NATIVE_DOM_CALL_ARGUMENT_COUNT,
  NATIVE_DOM_STATE_TUPLE_LENGTH,
} from "./effect/constants.js";

interface NativeDomPointerEventsStateWriteInput {
  assignment: EsTreeNode;
  binding: UseStateBinding;
  context: RuleContext;
}

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.kind === "const" &&
  symbol.references.every(
    (reference) => reference.flag === "read" && !isBindingAssignmentTarget(reference.identifier),
  );

const isOrdinaryMember = (node: EsTreeNode, propertyName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === propertyName;

const isPointerEventsWrite = (
  assignment: EsTreeNode,
  symbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    !isNodeOfType(assignment.right, "Literal") ||
    typeof assignment.right.value !== "string" ||
    !isOrdinaryMember(assignment.left, "pointerEvents") ||
    !isNodeOfType(assignment.left, "MemberExpression")
  )
    return false;
  const style = assignment.left.object;
  return (
    isOrdinaryMember(style, "style") &&
    isNodeOfType(style, "MemberExpression") &&
    isNodeOfType(style.object, "Identifier") &&
    context.scopes.symbolFor(style.object) === symbol
  );
};

const hasCanonicalReactImport = (call: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const identifier = getRootIdentifier(call.callee);
  const symbol = identifier ? context.scopes.symbolFor(identifier) : null;
  const declaration = symbol ? getImportDeclarationForSymbol(symbol) : null;
  return Boolean(
    declaration &&
    declaration.source.value === "react" &&
    declaration.importKind !== "type" &&
    (!isNodeOfType(symbol?.declarationNode, "ImportSpecifier") ||
      symbol.declarationNode.importKind !== "type"),
  );
};

const isExactDocumentLookup = (expression: EsTreeNode, context: RuleContext): boolean => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== NATIVE_DOM_CALL_ARGUMENT_COUNT ||
    !isOrdinaryMember(expression.callee, "getElementById") ||
    !isNodeOfType(expression.callee, "MemberExpression")
  )
    return false;
  const receiver = expression.callee.object;
  const argument = expression.arguments[FIRST_ARGUMENT_INDEX];
  return (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "document" &&
    context.scopes.isGlobalReference(receiver) &&
    isNodeOfType(argument, "Literal") &&
    typeof argument.value === "string"
  );
};

const hasClosedDocumentProvider = (
  context: RuleContext,
  provedLookups: ReadonlySet<EsTreeNode>,
): boolean => {
  let hasHazard = false;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (hasHazard) return false;
    if (isTypeScriptTypePosition(node)) return false;
    const binding = isNodeOfType(node, "Identifier") ? context.scopes.symbolFor(node) : null;
    const resolvedPropertyName =
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
        ? getResolvedStaticPropertyName(node, context.scopes)
        : null;
    if (
      (isNodeOfType(node, "Identifier") &&
        node.name === "document" &&
        binding &&
        context.scopes.referenceFor(node) &&
        isErasedTypeScriptBinding(binding) &&
        !hasRuntimeValueBinding(binding)) ||
      isProvenGlobalObjectReference(node, context.scopes) ||
      [
        "Document",
        "HTMLDocument",
        "XMLDocument",
        "Node",
        "Element",
        "HTMLElement",
        "SVGElement",
        "CSSStyleDeclaration",
      ].some(
        (namespaceName) =>
          isProvenGlobalNamespaceReference(node, namespaceName, context.scopes) ||
          (isNodeOfType(node, "Identifier") &&
            node.name === namespaceName &&
            Boolean(
              binding &&
              context.scopes.referenceFor(node) &&
              isErasedTypeScriptBinding(binding) &&
              !hasRuntimeValueBinding(binding),
            )),
      ) ||
      ((isNodeOfType(node, "MemberExpression") ||
        (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))) &&
        (["__proto__", "ownerDocument", "getRootNode", "parentNode"].includes(
          resolvedPropertyName ?? "",
        ) ||
          (node.computed && resolvedPropertyName === null)))
    ) {
      hasHazard = true;
      return false;
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      node.name !== "document" ||
      !context.scopes.isGlobalReference(node)
    )
      return;
    const member = node.parent;
    const invocation = member?.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== node ||
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.callee !== member ||
      !isExactDocumentLookup(invocation, context) ||
      !provedLookups.has(invocation)
    )
      hasHazard = true;
  });
  return !hasHazard;
};

const isNullish = (expression: EsTreeNode, context: RuleContext): boolean =>
  (isNodeOfType(expression, "Literal") && expression.value === null) ||
  (isNodeOfType(expression, "Identifier") &&
    expression.name === "undefined" &&
    context.scopes.isGlobalReference(expression));

const isDirectGuard = (reference: EsTreeNode, context: RuleContext): boolean => {
  let root = findTransparentExpressionRoot(reference);
  const unary = root.parent;
  if (isNodeOfType(unary, "UnaryExpression") && unary.operator === "!")
    root = findTransparentExpressionRoot(unary);
  const comparison = root.parent;
  if (
    isNodeOfType(comparison, "BinaryExpression") &&
    ["===", "!==", "==", "!="].includes(comparison.operator) &&
    isNullish(comparison.left === root ? comparison.right : comparison.left, context)
  )
    root = findTransparentExpressionRoot(comparison);
  const parent = root.parent;
  return (
    (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
    parent.test === root
  );
};

const isNativeEffectDependency = (reference: EsTreeNode, context: RuleContext): boolean => {
  const root = findTransparentExpressionRoot(reference);
  const dependencies = root.parent;
  const call = dependencies?.parent;
  return (
    isNodeOfType(dependencies, "ArrayExpression") &&
    dependencies.elements.some((element) => element === root) &&
    isNodeOfType(call, "CallExpression") &&
    call.arguments[SECOND_ARGUMENT_INDEX] === dependencies &&
    hasCanonicalReactImport(call, context) &&
    isProvenUnmodifiedReactApiCall(call, "useEffect", context.scopes) &&
    !hasReactDefaultProviderMutation("useEffect", context.scopes)
  );
};

export const isNativeDomPointerEventsStateWrite = ({
  assignment,
  binding,
  context,
}: NativeDomPointerEventsStateWriteInput): boolean => {
  const declarator = binding.declarator;
  if (
    !isNodeOfType(declarator.id, "ArrayPattern") ||
    declarator.id.elements.length !== NATIVE_DOM_STATE_TUPLE_LENGTH ||
    !isNodeOfType(declarator.init, "CallExpression") ||
    !hasCanonicalReactImport(declarator.init, context) ||
    !isUnmodifiedLocalReactStateCall(declarator.init, context.scopes) ||
    declarator.init.arguments.length > NATIVE_DOM_CALL_ARGUMENT_COUNT
  )
    return false;
  const initializer = declarator.init.arguments[FIRST_ARGUMENT_INDEX];
  if (initializer && !isNullish(stripParenExpression(initializer), context)) return false;
  const stateIdentifier = declarator.id.elements[FIRST_ARGUMENT_INDEX];
  const setterIdentifier = declarator.id.elements[SECOND_ARGUMENT_INDEX];
  if (!isNodeOfType(stateIdentifier, "Identifier") || !isNodeOfType(setterIdentifier, "Identifier"))
    return false;
  const stateSymbol = context.scopes.symbolFor(stateIdentifier);
  const setterSymbol = context.scopes.symbolFor(setterIdentifier);
  if (
    !stateSymbol ||
    !setterSymbol ||
    !isReadonlyBinding(stateSymbol) ||
    !isReadonlyBinding(setterSymbol) ||
    !isPointerEventsWrite(assignment, stateSymbol, context)
  )
    return false;
  for (const reference of stateSymbol.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const style = root.parent;
    const member = style?.parent;
    const write = member?.parent;
    if (
      isDirectGuard(reference.identifier, context) ||
      isNativeEffectDependency(reference.identifier, context)
    )
      continue;
    if (
      !isNodeOfType(style, "MemberExpression") ||
      style.object !== root ||
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== style ||
      !write ||
      !isPointerEventsWrite(write, stateSymbol, context)
    )
      return false;
  }
  const provedLookups = new Set<EsTreeNode>();
  const lookupAliases = new Set<SymbolDescriptor>();
  const allowedAliasReferences = new Set<EsTreeNode>();
  const resolveLookup = (
    expression: EsTreeNode,
    owner: EsTreeNode | null,
    seen: Set<number>,
  ): boolean => {
    const unwrapped = stripParenExpression(expression);
    if (isExactDocumentLookup(unwrapped, context)) {
      provedLookups.add(unwrapped);
      return true;
    }
    if (!isNodeOfType(unwrapped, "Identifier") || !owner) return false;
    const symbol = context.scopes.symbolFor(unwrapped);
    if (
      !symbol ||
      seen.has(symbol.id) ||
      !isReadonlyBinding(symbol) ||
      context.cfg.enclosingFunction(symbol.declarationNode) !== owner
    )
      return false;
    const initializer = getUninterruptedConstInitializer(unwrapped, context);
    if (!initializer) return false;
    seen.add(symbol.id);
    lookupAliases.add(symbol);
    allowedAliasReferences.add(unwrapped);
    return resolveLookup(initializer, owner, seen);
  };
  let hasLookupFeed = false;
  for (const reference of setterSymbol.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== root ||
      call.optional ||
      call.arguments.length !== NATIVE_DOM_CALL_ARGUMENT_COUNT
    )
      return false;
    const argument = call.arguments[FIRST_ARGUMENT_INDEX];
    if (isNullish(stripParenExpression(argument), context)) continue;
    if (!resolveLookup(argument, context.cfg.enclosingFunction(call), new Set())) return false;
    hasLookupFeed = true;
  }
  if (!hasLookupFeed || !hasClosedDocumentProvider(context, provedLookups)) return false;
  return [...lookupAliases].every((symbol) =>
    symbol.references.every(
      (reference) =>
        allowedAliasReferences.has(reference.identifier) ||
        isDirectGuard(reference.identifier, context),
    ),
  );
};
