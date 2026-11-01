import { COMMONJS_ZERO_SEQUENCE_SIZE } from "../constants/native-state-setter.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getEquivalentSymbols } from "./get-equivalent-symbols.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

const getSequenceCallee = (expression: EsTreeNode): EsTreeNode | null => {
  const candidate = stripParenExpression(expression);
  if (!isNodeOfType(candidate, "SequenceExpression")) return candidate;
  if (
    candidate.expressions.length !== COMMONJS_ZERO_SEQUENCE_SIZE ||
    !isNodeOfType(candidate.expressions[0], "Literal") ||
    candidate.expressions[0].value !== 0
  ) {
    return null;
  }
  return stripParenExpression(candidate.expressions[1]);
};

const isDirectApiReference = (member: EsTreeNode): boolean => {
  if (isNonEscapingReactApiReference(member)) return true;
  const referenceRoot = findTransparentExpressionRoot(member);
  const sequence = referenceRoot.parent;
  if (!isNodeOfType(sequence, "SequenceExpression") || getSequenceCallee(sequence) !== member) {
    return false;
  }
  const sequenceRoot = findTransparentExpressionRoot(sequence);
  const invocation = sequenceRoot.parent;
  return isNodeOfType(invocation, "CallExpression") && invocation.callee === sequenceRoot;
};

export const isProvenCommonjsReactApiCall = (
  node: EsTreeNode,
  apiName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(node, "CallExpression") || node.optional) return false;
  const callee = getSequenceCallee(node.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== apiName ||
    !isNodeOfType(callee.object, "Identifier")
  ) {
    return false;
  }
  const provider = scopes.symbolFor(callee.object);
  const initializer = provider?.initializer;
  if (
    !provider ||
    !isNodeOfType(provider.declarationNode, "VariableDeclarator") ||
    provider.declarationNode.id !== provider.bindingIdentifier ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    !isNodeOfType(initializer.callee, "Identifier") ||
    initializer.callee.name !== "require" ||
    !scopes.isGlobalReference(initializer.callee) ||
    initializer.arguments.length !== 1 ||
    !isNodeOfType(initializer.arguments[0], "Literal") ||
    initializer.arguments[0].value !== "react" ||
    hasPossibleStaticPropertyMutationOrEscape(callee.object, apiName, scopes)
  ) {
    return false;
  }
  const aliases = getEquivalentSymbols(callee.object, scopes);
  if (
    aliases.length === 0 ||
    aliases.some((alias) =>
      alias.references.some((reference) => {
        if (reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier)) {
          return true;
        }
        const referenceRoot = findTransparentExpressionRoot(reference.identifier);
        const member = referenceRoot.parent;
        if (!isNodeOfType(member, "MemberExpression") || member.object !== referenceRoot) {
          return !(
            isNodeOfType(member, "VariableDeclarator") &&
            member.init === referenceRoot &&
            isNodeOfType(member.id, "Identifier") &&
            isNodeOfType(member.parent, "VariableDeclaration") &&
            member.parent.kind === "const"
          );
        }
        const propertyName = getStaticPropertyName(member);
        return propertyName === null || (propertyName === apiName && !isDirectApiReference(member));
      }),
    )
  ) {
    return false;
  }
  const program = findProgramRoot(node);
  if (!program) return false;
  let hasOpaqueLoaderAccess = false;
  walkAst(program, (candidate) => {
    if (!isNodeOfType(candidate, "Identifier") || !scopes.isGlobalReference(candidate)) return;
    if (candidate.name === "eval") {
      hasOpaqueLoaderAccess = true;
      return false;
    }
    if (candidate.name !== "require") return;
    const referenceRoot = findTransparentExpressionRoot(candidate);
    const invocation = referenceRoot.parent;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.callee !== referenceRoot ||
      invocation.optional ||
      invocation.arguments.length !== 1 ||
      !isNodeOfType(invocation.arguments[0], "Literal") ||
      typeof invocation.arguments[0].value !== "string"
    ) {
      hasOpaqueLoaderAccess = true;
      return false;
    }
  });
  return !hasOpaqueLoaderAccess;
};
