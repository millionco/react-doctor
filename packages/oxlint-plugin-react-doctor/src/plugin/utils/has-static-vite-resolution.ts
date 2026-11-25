import { analyzeScopes, type ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isEnvironmentRead = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || node.computed || node.optional) return false;
  const receiver = node.object;
  return (
    isNodeOfType(receiver, "MemberExpression") &&
    !receiver.computed &&
    !receiver.optional &&
    isNodeOfType(receiver.property, "Identifier") &&
    receiver.property.name === "env" &&
    isNodeOfType(receiver.object, "Identifier") &&
    receiver.object.name === "process" &&
    scopes.isGlobalReference(receiver.object)
  );
};

const isStaticOption = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  environmentBindings: ReadonlySet<number>,
): boolean => {
  if (isNodeOfType(node, "Literal")) return true;
  if (isNodeOfType(node, "Identifier")) {
    const symbol = scopes.symbolFor(node);
    return symbol ? environmentBindings.has(symbol.id) : node.name === "undefined";
  }
  if (isNodeOfType(node, "ObjectExpression")) {
    return node.properties.every(
      (property) =>
        isNodeOfType(property, "Property") &&
        property.kind === "init" &&
        !property.computed &&
        !property.method &&
        isStaticOption(property.value, scopes, environmentBindings),
    );
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    return node.elements.every((item) => item && isStaticOption(item, scopes, environmentBindings));
  }
  if (isNodeOfType(node, "LogicalExpression")) {
    return (
      isStaticOption(node.left, scopes, environmentBindings) &&
      isStaticOption(node.right, scopes, environmentBindings)
    );
  }
  if (isNodeOfType(node, "ConditionalExpression")) {
    return (
      isStaticOption(node.test, scopes, environmentBindings) &&
      isStaticOption(node.consequent, scopes, environmentBindings) &&
      isStaticOption(node.alternate, scopes, environmentBindings)
    );
  }
  return false;
};

const isStockReactPlugin = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== 0 ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const imported = scopes.symbolFor(node.callee);
  return Boolean(
    imported &&
    isNodeOfType(imported.declarationNode, "ImportDefaultSpecifier") &&
    getImportDeclarationForSymbol(imported)?.source.value === "@vitejs/plugin-react",
  );
};

export const hasStaticViteResolution = (filename: string): boolean => {
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program")) return false;
  const scopes = analyzeScopes(program);
  const environmentBindings = new Set<number>();
  const exportStatement = program.body.at(-1);
  if (!isNodeOfType(exportStatement, "ExportDefaultDeclaration")) return false;
  for (const statement of program.body.slice(0, -1)) {
    if (isNodeOfType(statement, "ImportDeclaration")) {
      const provider = statement.source.value;
      if (provider !== "vite" && provider !== "@vitejs/plugin-react") return false;
      continue;
    }
    if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const") return false;
    for (const declaration of statement.declarations) {
      if (
        !isNodeOfType(declaration.id, "Identifier") ||
        !declaration.init ||
        !isEnvironmentRead(declaration.init, scopes)
      )
        return false;
      const binding = scopes.symbolFor(declaration.id);
      if (!binding) return false;
      environmentBindings.add(binding.id);
    }
  }
  const definition = stripParenExpression(exportStatement.declaration);
  if (
    !isNodeOfType(definition, "CallExpression") ||
    definition.optional ||
    definition.arguments.length !== 1 ||
    !isNodeOfType(definition.callee, "Identifier")
  )
    return false;
  const imported = scopes.symbolFor(definition.callee);
  if (
    !imported ||
    !isNodeOfType(imported.declarationNode, "ImportSpecifier") ||
    !isNodeOfType(imported.declarationNode.imported, "Identifier") ||
    imported.declarationNode.imported.name !== "defineConfig" ||
    getImportDeclarationForSymbol(imported)?.source.value !== "vite"
  )
    return false;
  const argument = stripParenExpression(definition.arguments[0]);
  const options =
    isNodeOfType(argument, "ArrowFunctionExpression") && argument.params.length === 0
      ? stripParenExpression(argument.body)
      : argument;
  if (!isNodeOfType(options, "ObjectExpression")) return false;
  return options.properties.every((property) => {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method
    )
      return false;
    switch (getStaticPropertyKeyName(property)) {
      case "plugins":
        return (
          isNodeOfType(property.value, "ArrayExpression") &&
          property.value.elements.length === 1 &&
          Boolean(
            property.value.elements[0] && isStockReactPlugin(property.value.elements[0], scopes),
          )
        );
      case "clearScreen":
      case "server":
        return isStaticOption(property.value, scopes, environmentBindings);
      default:
        return false;
    }
  });
};
