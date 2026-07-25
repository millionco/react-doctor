import type { Reference } from "eslint-scope";
import { HOOKS_WITH_DEPS } from "../../../constants/react.js";
import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import { getDestructuredBindingPropertyName } from "../../../utils/get-destructured-binding-property-name.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { getTransparentReactCallbackWrapperArgument } from "../../../utils/get-transparent-react-callback-wrapper-argument.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { canNodeExecuteBefore } from "../../../utils/has-static-property-write-before.js";
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

interface RefCurrentCallbackResolution {
  callbackNames: ReadonlySet<string> | null;
  isReactRef: boolean;
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

export const getVariableForDeclarator = (
  analysis: ProgramAnalysis,
  declarator: EsTreeNode,
): NonNullable<Reference["resolved"]> | null => {
  for (const scope of analysis.scopeManager.scopes) {
    const variable = scope.variables.find((candidateVariable) =>
      candidateVariable.defs.some(
        (definition) => (definition.node as unknown as EsTreeNode) === declarator,
      ),
    );
    if (variable) return variable;
  }
  return null;
};

export const getRefAliasDeclarator = (
  identifier: EsTreeNode,
): EsTreeNodeOfType<"VariableDeclarator"> | null => {
  const initializer = findTransparentExpressionRoot(identifier);
  const declarator = initializer.parent;
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    declarator.init !== (initializer as unknown as typeof declarator.init) ||
    !isNodeOfType(declarator.id, "Identifier") ||
    getDeclarationKind(declarator) !== "const"
  ) {
    return null;
  }
  return declarator;
};

const getRefAliasVariables = (
  analysis: ProgramAnalysis,
  rootVariable: NonNullable<Reference["resolved"]>,
  scopes: ScopeAnalysis,
  snapshotReferenceNode: EsTreeNode | null,
): ReadonlySet<NonNullable<Reference["resolved"]>> | null => {
  const variables = new Set([rootVariable]);
  const pendingVariables = [rootVariable];
  while (pendingVariables.length > 0) {
    const variable = pendingVariables.pop();
    if (!variable) continue;
    for (const candidateReference of variable.references) {
      const candidateIdentifier = candidateReference.identifier as unknown as EsTreeNode;
      if (
        snapshotReferenceNode &&
        !canNodeExecuteBefore(candidateIdentifier, snapshotReferenceNode, scopes)
      ) {
        continue;
      }
      const aliasDeclarator = getRefAliasDeclarator(candidateIdentifier);
      if (!aliasDeclarator) continue;
      const aliasVariable = getVariableForDeclarator(analysis, aliasDeclarator);
      if (!aliasVariable || variables.has(aliasVariable)) continue;
      if (
        aliasVariable.references.some(
          (aliasReference) => aliasReference.isWrite() && !aliasReference.init,
        )
      ) {
        return null;
      }
      variables.add(aliasVariable);
      pendingVariables.push(aliasVariable);
    }
  }
  return variables;
};

export const isKnownReactHookDependencyReference = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const dependencyElement = findTransparentExpressionRoot(identifier);
  const dependencyArray = dependencyElement.parent;
  if (
    !dependencyArray ||
    !isNodeOfType(dependencyArray, "ArrayExpression") ||
    !dependencyArray.elements.includes(
      dependencyElement as unknown as (typeof dependencyArray.elements)[number],
    )
  ) {
    return false;
  }
  const hookCall = dependencyArray.parent;
  return Boolean(
    hookCall &&
    isNodeOfType(hookCall, "CallExpression") &&
    hookCall.arguments[1] === (dependencyArray as unknown as (typeof hookCall.arguments)[number]) &&
    isReactApiCall(hookCall, HOOKS_WITH_DEPS, scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
      resolveNamedAliases: true,
    }),
  );
};

const referenceResolvesToReactRef = (
  analysis: ProgramAnalysis,
  reference: Reference,
  scopes: ScopeAnalysis,
  visitedReferences: Set<NonNullable<Reference["resolved"]>>,
): boolean => {
  if (!reference.resolved || visitedReferences.has(reference.resolved)) return false;
  const declarator = getSingleConstDeclarator(reference);
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  visitedReferences.add(reference.resolved);
  const initializer = stripParenExpression(declarator.init as EsTreeNode);
  if (isNodeOfType(initializer, "Identifier")) {
    const aliasedReference = getRef(analysis, initializer);
    return Boolean(
      aliasedReference &&
      referenceResolvesToReactRef(analysis, aliasedReference, scopes, visitedReferences),
    );
  }
  return (
    isNodeOfType(initializer, "CallExpression") &&
    isReactApiCall(initializer, "useRef", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
    })
  );
};

const resolveRefCurrentCallbackPropNames = (
  analysis: ProgramAnalysis,
  reference: Reference,
  scopes: ScopeAnalysis,
  visitedReferences: Set<NonNullable<Reference["resolved"]>>,
  snapshotReferenceNode: EsTreeNode | null,
): RefCurrentCallbackResolution => {
  if (!reference.resolved || visitedReferences.has(reference.resolved)) {
    return { callbackNames: null, isReactRef: false };
  }
  const declarator = getSingleConstDeclarator(reference);
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return { callbackNames: null, isReactRef: false };
  }
  visitedReferences.add(reference.resolved);
  const initializer = stripParenExpression(declarator.init as EsTreeNode);
  let callbackNames: ReadonlySet<string> | null = null;
  if (isNodeOfType(initializer, "Identifier")) {
    const aliasedReference = getRef(analysis, initializer);
    if (!aliasedReference) return { callbackNames: null, isReactRef: false };
    return resolveRefCurrentCallbackPropNames(
      analysis,
      aliasedReference,
      scopes,
      visitedReferences,
      snapshotReferenceNode,
    );
  } else if (
    isNodeOfType(initializer, "CallExpression") &&
    isReactApiCall(initializer, "useRef", scopes, {
      allowGlobalReactNamespace: true,
      allowUnboundBareCalls: true,
    })
  ) {
    const callbackArgument = initializer.arguments[0] as EsTreeNode | undefined;
    if (!callbackArgument) return { callbackNames: null, isReactRef: true };
    callbackNames = resolveParentCallbackPropNames(
      analysis,
      callbackArgument,
      scopes,
      new Set(visitedReferences),
      false,
    );
  } else {
    return { callbackNames: null, isReactRef: false };
  }
  if (!callbackNames) return { callbackNames: null, isReactRef: true };
  const aliasVariables = getRefAliasVariables(
    analysis,
    reference.resolved,
    scopes,
    snapshotReferenceNode,
  );
  if (!aliasVariables) return { callbackNames: null, isReactRef: true };
  for (const aliasVariable of aliasVariables) {
    for (const candidateReference of aliasVariable.references) {
      const candidateIdentifier = candidateReference.identifier as unknown as EsTreeNode;
      if (
        snapshotReferenceNode &&
        !canNodeExecuteBefore(candidateIdentifier, snapshotReferenceNode, scopes)
      ) {
        continue;
      }
      if (candidateReference.init) continue;
      if (getRefAliasDeclarator(candidateIdentifier)) continue;
      if (isKnownReactHookDependencyReference(candidateIdentifier, scopes)) continue;
      const candidateReceiver = findTransparentExpressionRoot(candidateIdentifier);
      const candidateMember = candidateReceiver.parent;
      if (
        !candidateMember ||
        !isNodeOfType(candidateMember, "MemberExpression") ||
        candidateMember.object !==
          (candidateReceiver as unknown as typeof candidateMember.object) ||
        getStaticMemberPropertyName(candidateMember) !== "current"
      ) {
        return { callbackNames: null, isReactRef: true };
      }
      const memberRoot = findTransparentExpressionRoot(candidateMember);
      const assignment = memberRoot.parent;
      if (
        !assignment ||
        !isNodeOfType(assignment, "AssignmentExpression") ||
        assignment.left !== (memberRoot as unknown as typeof assignment.left)
      ) {
        continue;
      }
      if (assignment.operator !== "=") return { callbackNames: null, isReactRef: true };
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
      if (!callbackNames) return { callbackNames: null, isReactRef: true };
    }
  }
  return { callbackNames, isReactRef: true };
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
  if (propertyName === "current") {
    const expressionRoot = findTransparentExpressionRoot(unwrappedExpression);
    const expressionParent = expressionRoot.parent;
    const snapshotReferenceNode =
      expressionParent &&
      isNodeOfType(expressionParent, "VariableDeclarator") &&
      expressionParent.init === (expressionRoot as unknown as typeof expressionParent.init) &&
      getDeclarationKind(expressionParent) === "const"
        ? unwrappedExpression
        : null;
    const refResolution = resolveRefCurrentCallbackPropNames(
      analysis,
      receiverReference,
      scopes,
      new Set(visitedReferences),
      snapshotReferenceNode,
    );
    if (refResolution.isReactRef) return refResolution.callbackNames;
  }
  const declarator = getSingleConstDeclarator(receiverReference);
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return null;
  }
  visitedReferences.add(receiverReference.resolved);
  const initializer = stripParenExpression(declarator.init as EsTreeNode);
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

const resolvesThroughProvenReactRefCurrentSnapshot = (
  analysis: ProgramAnalysis,
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedReferences: Set<NonNullable<Reference["resolved"]>>,
): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    isNodeOfType(unwrappedExpression, "MemberExpression") &&
    getStaticMemberPropertyName(unwrappedExpression) === "current"
  ) {
    return isProvenReactRefCurrentExpression({
      analysis,
      expression: unwrappedExpression,
      scopes,
    });
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return false;
  const reference = getRef(analysis, unwrappedExpression);
  if (!reference?.resolved || visitedReferences.has(reference.resolved)) return false;
  const declarator = getSingleConstDeclarator(reference);
  if (
    !declarator ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !declarator.init
  ) {
    return false;
  }
  visitedReferences.add(reference.resolved);
  return resolvesThroughProvenReactRefCurrentSnapshot(
    analysis,
    declarator.init as EsTreeNode,
    scopes,
    visitedReferences,
  );
};

export const getParentCallbackPropNames = ({
  analysis,
  expression,
  scopes,
}: ResolveParentCallbackOptions): ReadonlySet<string> | null =>
  resolveParentCallbackPropNames(analysis, expression, scopes, new Set(), false);

export const isProvenReactRefCurrentSnapshotExpression = ({
  analysis,
  expression,
  scopes,
}: ResolveParentCallbackOptions): boolean =>
  resolvesThroughProvenReactRefCurrentSnapshot(analysis, expression, scopes, new Set());

export const isProvenReactRefCurrentExpression = ({
  analysis,
  expression,
  scopes,
}: ResolveParentCallbackOptions): boolean => {
  const unwrappedExpression = stripParenExpression(expression);
  if (
    !isNodeOfType(unwrappedExpression, "MemberExpression") ||
    getStaticMemberPropertyName(unwrappedExpression) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(unwrappedExpression.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverReference = getRef(analysis, receiver);
  return Boolean(
    receiverReference &&
    referenceResolvesToReactRef(analysis, receiverReference, scopes, new Set()),
  );
};
