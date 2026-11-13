import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getResolvedStaticPropertyName } from "../../../utils/get-resolved-static-property-name.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedGlobalNamespaceReference } from "../../../utils/is-proven-unmodified-global-namespace-reference.js";
import { isErasedTypeScriptBinding } from "../../../utils/is-erased-typescript-binding.js";
import { hasRuntimeValueBinding } from "../../../utils/has-runtime-value-binding.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  NATIVE_LOCATION_FORBIDDEN_PROPERTY_NAMES,
  NATIVE_LOCATION_PROTECTED_REFERENCE_NAMES,
  NATIVE_LOCATION_QUERY_PART_INDEX,
  NATIVE_LOCATION_RUNTIME_TYPESCRIPT_NODE_TYPES,
  NATIVE_LOCATION_SPLIT_ARGUMENT_COUNT,
} from "./constants.js";

const closedProgramByAnalysis = new WeakMap<ScopeAnalysis, boolean>();

const isQuestionLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "Literal") && node.value === "?";

const isDirectMember = (node: EsTreeNode, propertyName: string): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  isNodeOfType(node.property, "Identifier") &&
  node.property.name === propertyName;

const isNativeSearchRead = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const search = stripParenExpression(node);
  if (!isNodeOfType(search, "MemberExpression") || !isDirectMember(search, "search")) return false;
  const location = stripParenExpression(search.object);
  if (!isNodeOfType(location, "MemberExpression") || !isDirectMember(location, "location"))
    return false;
  const host = stripParenExpression(location.object);
  if (!isNodeOfType(host, "Identifier") || host.name !== "window") return false;
  const symbol = scopes.symbolFor(host);
  return (
    (scopes.isGlobalReference(host)
      ? isProvenUnmodifiedGlobalNamespaceReference(host, "window", scopes)
      : Boolean(symbol && isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol))) &&
    !isWithinAssignmentTarget(search)
  );
};

const isDirectMethodCall = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  const parent = root.parent;
  return isNodeOfType(parent, "CallExpression") && parent.callee === root && !parent.optional;
};

const hasClosedNativeProviders = (context: RuleContext): boolean => {
  const cached = closedProgramByAnalysis.get(context.scopes);
  if (cached !== undefined) return cached;
  let isClosed = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!isClosed) return false;
    if (
      ("declare" in node && node.declare === true) ||
      NATIVE_LOCATION_RUNTIME_TYPESCRIPT_NODE_TYPES.has(node.type) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ImportExpression")
    ) {
      isClosed = false;
      return false;
    }
    if (
      isTypeScriptTypePosition(node) ||
      isNodeOfType(node, "TSInterfaceDeclaration") ||
      isNodeOfType(node, "TSTypeAliasDeclaration")
    )
      return false;
    if (node.type.startsWith("TS")) {
      isClosed = false;
      return false;
    }
    if (isNodeOfType(node, "Identifier")) {
      const reference = context.scopes.referenceFor(node);
      if (!reference) return;
      const symbol = reference.resolvedSymbol;
      if (
        (symbol && isErasedTypeScriptBinding(symbol) && node.name !== "window") ||
        NATIVE_LOCATION_PROTECTED_REFERENCE_NAMES.has(node.name)
      ) {
        isClosed = false;
        return false;
      }
      const root = findTransparentExpressionRoot(node);
      const member = root.parent;
      if (node.name === "window") {
        const locationRoot = member ? findTransparentExpressionRoot(member) : null;
        const search = locationRoot?.parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          !search ||
          !isNativeSearchRead(search, context.scopes)
        )
          isClosed = false;
      }
      if (
        node.name === "Object" &&
        (!context.scopes.isGlobalReference(node) ||
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          !isDirectMember(member, "keys") ||
          !isDirectMethodCall(member))
      )
        isClosed = false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const propertyName = getResolvedStaticPropertyName(node, context.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        propertyName === null ||
        NATIVE_LOCATION_FORBIDDEN_PROPERTY_NAMES.has(propertyName) ||
        (propertyName === "split" && !isDirectMethodCall(node))
      )
        isClosed = false;
    }
  });
  closedProgramByAnalysis.set(context.scopes, isClosed);
  return isClosed;
};

export const isNativeLocationQuestionSplitPart = (
  splitCall: EsTreeNode,
  partIndex: number,
  context: RuleContext,
): boolean => {
  if (
    partIndex !== NATIVE_LOCATION_QUERY_PART_INDEX ||
    !isNodeOfType(splitCall, "CallExpression") ||
    splitCall.optional ||
    splitCall.arguments.length !== NATIVE_LOCATION_SPLIT_ARGUMENT_COUNT ||
    !isQuestionLiteral(splitCall.arguments[0]) ||
    !isNodeOfType(splitCall.callee, "MemberExpression") ||
    !isDirectMember(splitCall.callee, "split")
  )
    return false;
  const receiver = stripParenExpression(splitCall.callee.object);
  return (
    isNodeOfType(receiver, "LogicalExpression") &&
    receiver.operator === "||" &&
    isQuestionLiteral(stripParenExpression(receiver.right)) &&
    isNativeSearchRead(receiver.left, context.scopes) &&
    hasClosedNativeProviders(context)
  );
};
