import * as path from "node:path";
import type { ControlFlowAnalysis } from "../semantic/control-flow-graph.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasPossibleStaticPropertyMutationOrEscapeBefore } from "./has-static-property-write-before.js";
import { hasVisibleAmbientFunctionDeclaration } from "./has-visible-ambient-function-declaration.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenGlobalObjectReference } from "./is-proven-global-namespace-reference.js";
import { isProvenReactComponentSymbol } from "./is-proven-react-component-symbol.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface PropTypesObjectValidatorContext {
  readonly scopes: ScopeAnalysis;
  readonly cfg: ControlFlowAnalysis;
  readonly filename?: string;
}

const getValidatorImport = (
  objectReference: EsTreeNode,
  context: PropTypesObjectValidatorContext,
): SymbolDescriptor | null => {
  const { scopes, cfg } = context;
  if (
    !isNodeOfType(objectReference, "Identifier") ||
    objectReference.name !== "Object" ||
    !scopes.isGlobalReference(objectReference) ||
    hasVisibleAmbientFunctionDeclaration(scopes.scopeFor(objectReference), "Object")
  )
    return null;
  const argument = findTransparentExpressionRoot(objectReference);
  const invocation = argument.parent;
  if (!isNodeOfType(invocation, "CallExpression") || invocation.optional) return null;
  const [validator, ...extraArguments] = invocation.arguments;
  if (validator !== argument || extraArguments.length !== 0) return null;
  const callee = stripParenExpression(invocation.callee);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "arrayOf"
  )
    return null;
  const receiver = stripParenExpression(callee.object);
  const imported = isNodeOfType(receiver, "Identifier") ? scopes.symbolFor(receiver) : null;
  const declaration = imported && getImportDeclarationForSymbol(imported);
  if (
    !imported ||
    !declaration ||
    declaration.importKind === "type" ||
    declaration.source.value !== "prop-types" ||
    !isNodeOfType(imported.declarationNode, "ImportDefaultSpecifier")
  )
    return null;
  let result = findTransparentExpressionRoot(invocation);
  const required = result.parent;
  if (
    isNodeOfType(required, "MemberExpression") &&
    required.object === result &&
    !required.computed &&
    !required.optional &&
    isNodeOfType(required.property, "Identifier") &&
    required.property.name === "isRequired"
  )
    result = findTransparentExpressionRoot(required);
  const property = result.parent;
  const record = property?.parent;
  if (
    !isNodeOfType(property, "Property") ||
    property.value !== result ||
    property.kind !== "init" ||
    property.method ||
    property.computed ||
    !isNodeOfType(record, "ObjectExpression") ||
    record.properties.some(
      (entry) =>
        !isNodeOfType(entry, "Property") || entry.kind !== "init" || entry.method || entry.computed,
    )
  )
    return null;
  const recordRoot = findTransparentExpressionRoot(record);
  const assignment = recordRoot.parent;
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.right !== recordRoot ||
    !isNodeOfType(assignment.left, "MemberExpression") ||
    assignment.left.computed ||
    assignment.left.optional ||
    !isNodeOfType(assignment.left.property, "Identifier") ||
    assignment.left.property.name !== "propTypes"
  )
    return null;
  const statement = findTransparentExpressionRoot(assignment).parent;
  const component = stripParenExpression(assignment.left.object);
  const componentSymbol = isNodeOfType(component, "Identifier")
    ? scopes.symbolFor(component)
    : null;
  const program = findProgramRoot(objectReference);
  if (
    !program ||
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.parent !== program ||
    !componentSymbol ||
    componentSymbol.scope !== scopes.rootScope ||
    (componentSymbol.kind !== "const" && componentSymbol.kind !== "function") ||
    componentSymbol.declarationNode.range[1] >= assignment.range[0] ||
    !hasCompleteSymbolReferences(componentSymbol, program, scopes) ||
    componentSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    ) ||
    hasPossibleStaticPropertyMutationOrEscapeBefore(component, "propTypes", assignment, scopes) ||
    !isProvenReactComponentSymbol(componentSymbol, scopes, cfg, component)
  )
    return null;
  return imported;
};

const validatorReferencesByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<ControlFlowAnalysis, Map<string, ReadonlySet<EsTreeNode>>>
>();

const collectValidatorReferences = (
  program: EsTreeNode,
  context: PropTypesObjectValidatorContext,
): ReadonlySet<EsTreeNode> => {
  const { scopes } = context;
  const references = new Set<EsTreeNode>();
  for (const provider of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(provider);
    if (!declaration || declaration.source.value !== "prop-types") continue;
    if (
      declaration.importKind === "type" ||
      (isNodeOfType(provider.declarationNode, "ImportSpecifier") &&
        provider.declarationNode.importKind === "type")
    ) {
      if (provider.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)))
        return new Set();
      continue;
    }
    if (!hasCompleteSymbolReferences(provider, program, scopes)) return new Set();
    for (const reference of provider.references) {
      if (reference.flag !== "read" || isWithinAssignmentTarget(reference.identifier))
        return new Set();
      const receiver = findTransparentExpressionRoot(reference.identifier);
      const member = receiver.parent;
      const invocation = member && findTransparentExpressionRoot(member).parent;
      const argument = isNodeOfType(invocation, "CallExpression") ? invocation.arguments[0] : null;
      const objectReference = argument && stripParenExpression(argument);
      if (!objectReference || getValidatorImport(objectReference, context) !== provider)
        return new Set();
      references.add(objectReference);
    }
  }
  let unsupported = false;
  walkAst(program, (candidate) => {
    if (unsupported) return false;
    if (isTypeScriptTypePosition(candidate)) return false;
    if (
      (isNodeOfType(candidate, "ExportNamedDeclaration") ||
        isNodeOfType(candidate, "ExportAllDeclaration")) &&
      candidate.source?.value === "prop-types"
    ) {
      unsupported = true;
      return false;
    }
    if (!isNodeOfType(candidate, "Identifier") || isNonReferenceIdentifier(candidate)) return;
    if (
      isProvenGlobalObjectReference(candidate, scopes) ||
      (candidate.name === "Object" &&
        scopes.isGlobalReference(candidate) &&
        !references.has(candidate))
    )
      unsupported = true;
  });
  return unsupported ? new Set() : references;
};

export const isPropTypesObjectValidatorReference = (
  node: EsTreeNode,
  context: PropTypesObjectValidatorContext,
): boolean => {
  const objectReference = stripParenExpression(node);
  const program = findProgramRoot(objectReference);
  const { scopes, cfg, filename } = context;
  if (!program || !filename || !path.isAbsolute(filename)) return false;
  let referencesByControlFlow = validatorReferencesByScopes.get(scopes);
  if (!referencesByControlFlow) {
    referencesByControlFlow = new WeakMap();
    validatorReferencesByScopes.set(scopes, referencesByControlFlow);
  }
  let referencesByFilename = referencesByControlFlow.get(cfg);
  if (!referencesByFilename) {
    referencesByFilename = new Map();
    referencesByControlFlow.set(cfg, referencesByFilename);
  }
  let references = referencesByFilename.get(filename);
  if (!references) {
    references = collectValidatorReferences(program, context);
    referencesByFilename.set(filename, references);
  }
  return references.has(objectReference) && resolveModulePath(filename, "prop-types") === null;
};
