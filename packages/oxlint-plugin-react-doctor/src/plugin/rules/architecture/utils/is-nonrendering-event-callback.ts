import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { functionContainsProvenReactHookCall } from "../../../utils/function-contains-proven-react-hook-call.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { functionBodyHasReturnWithValue } from "../../../utils/function-body-has-return-with-value.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isReactHookName } from "../../../utils/is-react-hook-name.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";

export const isNonrenderingEventCallback = (
  bindingIdentifier: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const declaration = bindingIdentifier.parent;
  const functionNode = isNodeOfType(declaration, "VariableDeclarator")
    ? declaration.init
    : declaration;
  if (
    !isFunctionLike(functionNode) ||
    !isNodeOfType(functionNode.body, "BlockStatement") ||
    functionBodyHasReturnWithValue(functionNode) ||
    functionContainsProvenReactHookCall(functionNode, scopes) ||
    scopes
      .ownScopeFor(functionNode)
      ?.symbols.some(
        (symbol) =>
          symbol.kind === "function" &&
          symbol.declarationNode === functionNode &&
          symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)),
      )
  ) {
    return false;
  }
  let hasComponentBody = false;
  walkOwnFunctionScope(functionNode, (node) => {
    if (node.type === "JSXElement" || node.type === "JSXFragment") {
      hasComponentBody = true;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    const callee = node.callee;
    const callName = isNodeOfType(callee, "Identifier")
      ? callee.name
      : isNodeOfType(callee, "MemberExpression")
        ? getStaticPropertyName(callee)
        : null;
    if (
      (callName && (isReactHookName(callName) || callName === "createElement")) ||
      isReactApiCall(node, "createElement", scopes, {
        allowGlobalReactNamespace: true,
        resolveNamedAliases: true,
        resolveConditionalAliases: true,
      })
    ) {
      hasComponentBody = true;
    }
  });
  if (hasComponentBody) return false;
  const symbols = getFunctionBindingSymbols(functionNode, scopes);
  if (
    symbols.length === 0 ||
    symbols.some((symbol) => symbol.kind !== "const" && symbol.kind !== "function")
  ) {
    return false;
  }
  const references = symbols.flatMap((symbol) => symbol.references);
  if (references.length === 0) return false;
  for (const reference of references) {
    const identifier = reference.identifier;
    const container = identifier.parent;
    const attribute = container?.parent;
    if (
      reference.flag !== "read" ||
      isWithinAssignmentTarget(identifier) ||
      !isNodeOfType(container, "JSXExpressionContainer") ||
      container.expression !== identifier ||
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.name, "JSXIdentifier") ||
      attribute.name.name !== "onClick"
    ) {
      return false;
    }
    const openingElement = attribute.parent;
    if (
      !isNodeOfType(openingElement, "JSXOpeningElement") ||
      !isNodeOfType(openingElement.name, "JSXIdentifier")
    ) {
      return false;
    }
    if (openingElement.name.name === "button") continue;
    const providerSymbol = scopes.symbolFor(openingElement.name);
    if (!providerSymbol) return false;
    const importDeclaration = getImportDeclarationForSymbol(providerSymbol);
    const importSpecifier = providerSymbol.declarationNode;
    if (
      !importDeclaration ||
      importDeclaration.importKind === "type" ||
      importDeclaration.source.value !== "antd" ||
      !isNodeOfType(importSpecifier, "ImportSpecifier") ||
      importSpecifier.importKind === "type" ||
      getImportedName(importSpecifier) !== "Button"
    ) {
      return false;
    }
    const program = scopes.rootScope.node;
    if (!isNodeOfType(program, "Program")) return false;
    for (const statement of program.body) {
      if (!isNodeOfType(statement, "ImportDeclaration") || statement.source.value !== "antd") {
        continue;
      }
      for (const specifier of statement.specifiers) {
        const importedSymbol = scopes.symbolFor(specifier.local);
        if (!importedSymbol) return false;
        const runtimeReferences = importedSymbol.references.filter(
          (importedReference) => !isTypeScriptTypePosition(importedReference.identifier),
        );
        if (runtimeReferences.length === 0) continue;
        if (
          statement.importKind === "type" ||
          (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
        ) {
          return false;
        }
        const importedName = getImportedName(specifier);
        if (importedName !== "Button") {
          if (!isNodeOfType(specifier, "ImportSpecifier") || importedName === "default") {
            return false;
          }
          continue;
        }
        if (
          runtimeReferences.some((providerReference) => {
            const providerIdentifier = providerReference.identifier;
            const providerParent = providerIdentifier.parent;
            return (
              providerReference.flag !== "read" ||
              isWithinAssignmentTarget(providerIdentifier) ||
              !(
                (isNodeOfType(providerParent, "JSXOpeningElement") ||
                  isNodeOfType(providerParent, "JSXClosingElement")) &&
                providerParent.name === providerIdentifier
              )
            );
          })
        ) {
          return false;
        }
      }
    }
  }
  let hasUnsupportedRuntime = false;
  walkAst(scopes.rootScope.node, (node) => {
    if (hasUnsupportedRuntime) return false;
    if (
      node.type === "WithStatement" ||
      node.type === "TSImportEqualsDeclaration" ||
      node.type === "TSExportAssignment" ||
      node.type === "TSParameterProperty" ||
      ((isNodeOfType(node, "TSEnumDeclaration") || isNodeOfType(node, "TSModuleDeclaration")) &&
        !("declare" in node && node.declare))
    ) {
      hasUnsupportedRuntime = true;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      node.name === "eval" &&
      scopes.isGlobalReference(node)
    ) {
      hasUnsupportedRuntime = true;
    }
  });
  return !hasUnsupportedRuntime;
};
