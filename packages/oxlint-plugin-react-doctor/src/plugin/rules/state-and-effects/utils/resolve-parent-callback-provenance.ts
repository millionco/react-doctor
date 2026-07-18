import type { Reference } from "eslint-scope";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../../utils/get-transparent-react-callback-wrapper-argument.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkInsideStatementBlocks } from "../../../utils/walk-inside-statement-blocks.js";
import { getRef } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isProp, isWholePropsObjectReference } from "./effect/react.js";
import { getStaticMemberPropertyName } from "./static-member-property-name.js";

interface ResolveParentCallbackOptions {
  analysis: ProgramAnalysis;
  expression: EsTreeNode;
  scopes: ScopeAnalysis;
}

const getDeclarationKind = (declarator: EsTreeNode): string | null => {
  const declaration = declarator.parent;
  return declaration && isNodeOfType(declaration, "VariableDeclaration") ? declaration.kind : null;
};

const hasMutableBindingWrite = (reference: Reference): boolean =>
  Boolean(
    reference.resolved?.references.some(
      (candidateReference) => candidateReference.isWrite() && !candidateReference.init,
    ),
  );

const mergeRequiredBranches = (
  leftNames: ReadonlySet<string> | null,
  rightNames: ReadonlySet<string> | null,
): ReadonlySet<string> | null => {
  if (!leftNames || !rightNames) return null;
  return new Set([...leftNames, ...rightNames]);
};

const getPropReferenceName = (analysis: ProgramAnalysis, identifier: EsTreeNode): string | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const reference = getRef(analysis, identifier);
  if (
    !reference ||
    !isProp(analysis, reference) ||
    isWholePropsObjectReference(analysis, reference)
  ) {
    return null;
  }
  const parameterDefinition = reference.resolved?.defs.find(
    (definition) => definition.type === "Parameter",
  );
  const bindingIdentifier = parameterDefinition?.name as unknown as EsTreeNode | undefined;
  return (
    (bindingIdentifier && getDestructuredBindingPropertyName(bindingIdentifier)) ?? identifier.name
  );
};

const getSingleConstDeclarator = (reference: Reference): EsTreeNode | null => {
  if (!reference.resolved || hasMutableBindingWrite(reference)) return null;
  const declarators = reference.resolved.defs
    .map((definition) => definition.node as unknown as EsTreeNode)
    .filter((definitionNode) => isNodeOfType(definitionNode, "VariableDeclarator"));
  if (declarators.length !== 1) return null;
  const declarator = declarators[0];
  if (!declarator || getDeclarationKind(declarator) !== "const") return null;
  return declarator;
};

const resolveParentCallbackPropNames = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedReferences: Set<NonNullable<Reference["resolved"]>>,
  allowFunctionForwarder = false,
): ReadonlySet<string> | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isFunctionLike(unwrappedExpression)) {
    if (!allowFunctionForwarder || Boolean((unwrappedExpression as { async?: boolean }).async)) {
      return null;
    }
    const callbackNames = new Set<string>();
    walkInsideStatementBlocks(unwrappedExpression.body as EsTreeNode, (child) => {
      if (!isNodeOfType(child, "CallExpression")) return;
      const resolvedNames = resolveParentCallbackPropNames(
        analysis,
        child.callee as EsTreeNode,
        scopes,
        new Set(visitedReferences),
        false,
      );
      if (!resolvedNames) return;
      for (const resolvedName of resolvedNames) callbackNames.add(resolvedName);
    });
    return callbackNames.size > 0 ? callbackNames : null;
  }
  if (isNodeOfType(unwrappedExpression, "ConditionalExpression")) {
    return mergeRequiredBranches(
      resolveParentCallbackPropNames(
        analysis,
        unwrappedExpression.consequent as EsTreeNode,
        scopes,
        new Set(visitedReferences),
        false,
      ),
      resolveParentCallbackPropNames(
        analysis,
        unwrappedExpression.alternate as EsTreeNode,
        scopes,
        new Set(visitedReferences),
        false,
      ),
    );
  }
  if (isNodeOfType(unwrappedExpression, "LogicalExpression")) {
    return mergeRequiredBranches(
      resolveParentCallbackPropNames(
        analysis,
        unwrappedExpression.left as EsTreeNode,
        scopes,
        new Set(visitedReferences),
        false,
      ),
      resolveParentCallbackPropNames(
        analysis,
        unwrappedExpression.right as EsTreeNode,
        scopes,
        new Set(visitedReferences),
      ),
    );
  }
  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const propName = getPropReferenceName(analysis, unwrappedExpression);
    if (propName) return new Set([propName]);
    const reference = getRef(analysis, unwrappedExpression);
    if (!reference?.resolved || visitedReferences.has(reference.resolved)) return null;
    const declarator = getSingleConstDeclarator(reference);
    if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
      return null;
    }
    visitedReferences.add(reference.resolved);
    const wrappedArgument = getTransparentReactCallbackWrapperArgument(
      declarator.init as EsTreeNode,
      scopes.symbolFor(unwrappedExpression),
      scopes,
    );
    const allowsFunctionForwarder = Boolean(
      wrappedArgument &&
      !isReactApiCall(declarator.init as EsTreeNode, "useCallback", scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
      }),
    );
    return resolveParentCallbackPropNames(
      analysis,
      wrappedArgument ?? (declarator.init as EsTreeNode),
      scopes,
      visitedReferences,
      allowsFunctionForwarder,
    );
  }
  if (!isNodeOfType(unwrappedExpression, "MemberExpression")) return null;
  const propertyName = getStaticMemberPropertyName(unwrappedExpression);
  if (!propertyName) return null;
  const receiver = stripParenExpression(unwrappedExpression.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return null;
  const receiverReference = getRef(analysis, receiver);
  if (!receiverReference?.resolved || visitedReferences.has(receiverReference.resolved))
    return null;
  if (isWholePropsObjectReference(analysis, receiverReference)) return new Set([propertyName]);
  const declarator = getSingleConstDeclarator(receiverReference);
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return null;
  }
  visitedReferences.add(receiverReference.resolved);
  const initializer = stripParenExpression(declarator.init as EsTreeNode);
  if (propertyName === "current" && isNodeOfType(initializer, "CallExpression")) {
    if (
      !isReactApiCall(initializer, "useRef", scopes, {
        allowGlobalReactNamespace: true,
        allowUnboundBareCalls: true,
      })
    ) {
      return null;
    }
    const callbackArgument = initializer.arguments[0] as EsTreeNode | undefined;
    if (!callbackArgument) return null;
    let callbackNames = resolveParentCallbackPropNames(
      analysis,
      callbackArgument,
      scopes,
      new Set(visitedReferences),
      false,
    );
    if (!callbackNames) return null;
    for (const candidateReference of receiverReference.resolved.references) {
      const candidateIdentifier = candidateReference.identifier as unknown as EsTreeNode;
      const candidateMember = candidateIdentifier.parent;
      if (
        !candidateMember ||
        !isNodeOfType(candidateMember, "MemberExpression") ||
        candidateMember.object !==
          (candidateIdentifier as unknown as typeof candidateMember.object) ||
        getStaticMemberPropertyName(candidateMember) !== "current"
      ) {
        continue;
      }
      const assignment = candidateMember.parent;
      if (
        !assignment ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.left !== (candidateMember as unknown as typeof assignment.left)
      ) {
        continue;
      }
      if (assignment.operator !== "=") return null;
      callbackNames = mergeRequiredBranches(
        callbackNames,
        resolveParentCallbackPropNames(
          analysis,
          assignment.right as EsTreeNode,
          scopes,
          new Set(visitedReferences),
          false,
        ),
      );
      if (!callbackNames) return null;
    }
    return callbackNames;
  }
  if (!isNodeOfType(initializer, "ObjectExpression")) return null;
  const property = initializer.properties.find(
    (candidateProperty) =>
      isNodeOfType(candidateProperty, "Property") &&
      getStaticPropertyKeyName(candidateProperty, { allowComputedString: true }) === propertyName,
  );
  if (!property || !isNodeOfType(property, "Property")) return null;
  return resolveParentCallbackPropNames(
    analysis,
    property.value as EsTreeNode,
    scopes,
    visitedReferences,
    false,
  );
};

export const getParentCallbackPropNames = ({
  analysis,
  expression,
  scopes,
}: ResolveParentCallbackOptions): ReadonlySet<string> | null =>
  resolveParentCallbackPropNames(analysis, expression, scopes, new Set(), false);
