import { COMMONJS_DEFINE_PROPERTY_ARITY } from "../constants/native-state-setter.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticObjectPropertyValue } from "./get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { parseSourceFile } from "./parse-source-file.js";
import { resolveCommonjsPackageFile } from "./resolve-commonjs-package-file.js";
import { walkAst } from "./walk-ast.js";

export interface ResolvedCommonjsDefaultFunctionExport {
  readonly filePath: string;
  readonly functionNode: EsTreeNode;
  readonly programNode: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

const isProgramOwnedDeclaration = (declaration: EsTreeNode, program: EsTreeNode): boolean =>
  isNodeOfType(declaration, "FunctionDeclaration")
    ? declaration.parent === program
    : isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.parent, "VariableDeclaration") &&
      declaration.parent.parent === program;

const getObjectProperty = (
  node: EsTreeNode | null | undefined,
  name: string,
): EsTreeNode | null => {
  if (
    !isNodeOfType(node, "ObjectExpression") ||
    node.properties.some(
      (property) =>
        !isNodeOfType(property, "Property") ||
        property.method ||
        property.kind !== "init" ||
        getStaticPropertyKeyName(property) === null,
    )
  ) {
    return null;
  }
  return getStaticObjectPropertyValue(node, name) ?? null;
};

const isGlobal = (node: EsTreeNode, name: string, scopes: ScopeAnalysis): boolean =>
  isNodeOfType(node, "Identifier") && node.name === name && scopes.isGlobalReference(node);

const getExportProperty = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    !isNodeOfType(node.callee, "MemberExpression") ||
    getStaticPropertyName(node.callee) !== "defineProperty" ||
    !isGlobal(node.callee.object, "Object", scopes) ||
    node.arguments.length !== COMMONJS_DEFINE_PROPERTY_ARITY ||
    !isGlobal(node.arguments[0], "exports", scopes) ||
    !isNodeOfType(node.arguments[1], "Literal") ||
    typeof node.arguments[1].value !== "string" ||
    !isNodeOfType(node.arguments[2], "ObjectExpression") ||
    !isNodeOfType(node.parent, "ExpressionStatement") ||
    !isNodeOfType(node.parent.parent, "Program")
  ) {
    return null;
  }
  return node;
};

const getTopLevelExpressions = (program: EsTreeNode): EsTreeNode[] =>
  isNodeOfType(program, "Program")
    ? program.body.flatMap((statement) =>
        isNodeOfType(statement, "ExpressionStatement") ? [statement.expression] : [],
      )
    : [];

const hasOpaqueExportsOrBuiltinAccess = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  permittedDefaultAssignment: EsTreeNode | null,
  permittedModuleMarker: EsTreeNode | null = null,
): boolean => {
  let hasOpaqueAccess = false;
  walkAst(program, (node) => {
    if (!isNodeOfType(node, "Identifier") || !scopes.isGlobalReference(node)) return;
    const parent = node.parent;
    if (node.name === "module" || node.name === "eval" || node.name === "arguments") {
      hasOpaqueAccess = true;
      return false;
    }
    if (node.name === "require") {
      if (
        !isNodeOfType(parent, "CallExpression") ||
        parent.callee !== node ||
        parent.optional ||
        parent.arguments.length !== 1 ||
        !isNodeOfType(parent.arguments[0], "Literal") ||
        typeof parent.arguments[0].value !== "string"
      ) {
        hasOpaqueAccess = true;
        return false;
      }
    }
    if (node.name === "Object") {
      if (
        !isNodeOfType(parent, "MemberExpression") ||
        parent.object !== node ||
        ((getStaticPropertyName(parent) === "defineProperty" ||
          getStaticPropertyName(parent) === null) &&
          (isWithinAssignmentTarget(parent) ||
            (isNodeOfType(parent.parent, "UnaryExpression") &&
              parent.parent.operator === "delete")))
      ) {
        hasOpaqueAccess = true;
        return false;
      }
    }
    if (node.name !== "exports") return;
    const exportProperty = isNodeOfType(parent, "CallExpression")
      ? getExportProperty(parent, scopes)
      : null;
    if (exportProperty) {
      const propertyName = exportProperty.arguments[1];
      if (
        !permittedDefaultAssignment ||
        (isNodeOfType(propertyName, "Literal") &&
          propertyName.value !== "default" &&
          propertyName.value !== "__esModule") ||
        exportProperty === permittedModuleMarker
      )
        return;
    }
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === node &&
      parent.parent === permittedDefaultAssignment
    ) {
      return;
    }
    hasOpaqueAccess = true;
    return false;
  });
  return hasOpaqueAccess;
};

const isPureDefaultInterop = (node: EsTreeNode | null, scopes: ScopeAnalysis): boolean => {
  if (!isFunctionLike(node) || node.async || node.generator || node.params.length !== 1)
    return false;
  const parameter = node.params[0];
  if (!isNodeOfType(parameter, "Identifier")) return false;
  const parameterSymbol = scopes.symbolFor(parameter);
  const returned = getSingleReturnExpression(node);
  const isParameter = (candidate: EsTreeNode): boolean =>
    isNodeOfType(candidate, "Identifier") && scopes.symbolFor(candidate) === parameterSymbol;
  if (
    !parameterSymbol ||
    !isNodeOfType(returned, "ConditionalExpression") ||
    !isNodeOfType(returned.test, "LogicalExpression") ||
    returned.test.operator !== "&&" ||
    !isParameter(returned.test.left) ||
    !isNodeOfType(returned.test.right, "MemberExpression") ||
    getStaticPropertyName(returned.test.right) !== "__esModule" ||
    !isParameter(returned.test.right.object) ||
    !isParameter(returned.consequent) ||
    !isNodeOfType(returned.alternate, "ObjectExpression") ||
    returned.alternate.properties.length !== 1
  ) {
    return false;
  }
  const wrappedDefault = getObjectProperty(returned.alternate, "default");
  return Boolean(wrappedDefault && isParameter(wrappedDefault));
};

export const resolveCommonjsDefaultFunctionExport = (
  entryPath: string,
  exportedName: string,
  packageDirectory: string,
): ResolvedCommonjsDefaultFunctionExport | null => {
  const entry = parseSourceFile(entryPath);
  if (!entry) return null;
  const scopes = analyzeScopes(entry);
  if (hasOpaqueExportsOrBuiltinAccess(entry, scopes, null)) return null;
  const exportCalls: EsTreeNodeOfType<"CallExpression">[] = [];
  for (const node of getTopLevelExpressions(entry)) {
    const exportCall = getExportProperty(node, scopes);
    if (
      exportCall &&
      isNodeOfType(exportCall.arguments[1], "Literal") &&
      exportCall.arguments[1].value === exportedName
    ) {
      exportCalls.push(exportCall);
    }
  }
  if (exportCalls.length !== 1) return null;
  const descriptor = exportCalls[0].arguments[2];
  const enumerable = getObjectProperty(descriptor, "enumerable");
  if (
    !isNodeOfType(descriptor, "ObjectExpression") ||
    descriptor.properties.length !== 2 ||
    !isNodeOfType(enumerable, "Literal") ||
    enumerable.value !== true
  ) {
    return null;
  }
  const getter = getObjectProperty(descriptor, "get");
  if (!isFunctionLike(getter) || getter.async || getter.generator || getter.params.length !== 0) {
    return null;
  }
  const projection = getSingleReturnExpression(getter);
  if (
    !isNodeOfType(projection, "MemberExpression") ||
    getStaticPropertyName(projection) !== "default" ||
    !isNodeOfType(projection.object, "Identifier")
  ) {
    return null;
  }
  const importedSymbol = scopes.symbolFor(projection.object);
  const initializer = importedSymbol?.initializer;
  if (
    !importedSymbol ||
    !isNodeOfType(importedSymbol.declarationNode, "VariableDeclarator") ||
    !isProgramOwnedDeclaration(importedSymbol.declarationNode, entry) ||
    importedSymbol.declarationNode.id !== importedSymbol.bindingIdentifier ||
    importedSymbol.references.some(
      (reference) =>
        reference.flag !== "read" ||
        isBindingAssignmentTarget(reference.identifier) ||
        reference.identifier.parent !== projection,
    ) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.optional ||
    initializer.arguments.length !== 1 ||
    !isNodeOfType(initializer.callee, "Identifier")
  ) {
    return null;
  }
  const interopSymbol = scopes.symbolFor(initializer.callee);
  if (
    !interopSymbol ||
    !isProgramOwnedDeclaration(interopSymbol.declarationNode, entry) ||
    !isPureDefaultInterop(interopSymbol.initializer, scopes) ||
    (interopSymbol.kind !== "function" &&
      interopSymbol.declarationNode.range[0] >= initializer.range[0]) ||
    interopSymbol.references.some(
      (reference) => reference.flag !== "read" || isBindingAssignmentTarget(reference.identifier),
    )
  ) {
    return null;
  }
  const requireCall = initializer.arguments[0];
  if (
    !isNodeOfType(requireCall, "CallExpression") ||
    requireCall.optional ||
    !isGlobal(requireCall.callee, "require", scopes) ||
    requireCall.arguments.length !== 1 ||
    !isNodeOfType(requireCall.arguments[0], "Literal") ||
    typeof requireCall.arguments[0].value !== "string" ||
    !requireCall.arguments[0].value.startsWith(".")
  ) {
    return null;
  }
  const filePath = resolveCommonjsPackageFile(
    entryPath,
    requireCall.arguments[0].value,
    packageDirectory,
  );
  if (!filePath) return null;
  const programNode = parseSourceFile(filePath);
  if (!programNode) return null;
  const helperScopes = analyzeScopes(programNode);
  const expressions = getTopLevelExpressions(programNode);
  const markers: EsTreeNode[] = [];
  for (const node of expressions) {
    const exportCall = getExportProperty(node, helperScopes);
    if (!exportCall || !isNodeOfType(exportCall.arguments[1], "Literal")) continue;
    const markerDescriptor = exportCall.arguments[2];
    const markerValue = getObjectProperty(markerDescriptor, "value");
    if (
      exportCall.arguments[1].value === "__esModule" &&
      isNodeOfType(markerDescriptor, "ObjectExpression") &&
      markerDescriptor.properties.length === 1 &&
      isNodeOfType(markerValue, "Literal") &&
      markerValue.value === true
    ) {
      markers.push(exportCall);
    }
  }
  const defaults = expressions.filter(
    (node) =>
      isNodeOfType(node, "AssignmentExpression") &&
      node.operator === "=" &&
      isNodeOfType(node.left, "MemberExpression") &&
      getStaticPropertyName(node.left) === "default" &&
      isGlobal(node.left.object, "exports", helperScopes),
  );
  if (markers.length !== 1 || defaults.length !== 1) return null;
  const assignment = defaults[0];
  if (
    !isNodeOfType(assignment, "AssignmentExpression") ||
    !isNodeOfType(assignment.right, "Identifier") ||
    hasOpaqueExportsOrBuiltinAccess(programNode, helperScopes, assignment, markers[0])
  ) {
    return null;
  }
  const functionSymbol = helperScopes.symbolFor(assignment.right);
  const functionNode = functionSymbol?.initializer;
  if (
    !functionSymbol ||
    !isProgramOwnedDeclaration(functionSymbol.declarationNode, programNode) ||
    !isFunctionLike(functionNode) ||
    (functionSymbol.kind !== "function" &&
      functionSymbol.declarationNode.range[0] >= assignment.range[0])
  ) {
    return null;
  }
  return { filePath, functionNode, programNode, scopes: helperScopes };
};
