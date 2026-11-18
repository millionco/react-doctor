import * as fs from "node:fs";
import * as path from "node:path";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const CONFIG_NAMES = ["next.config.js", "next.config.mjs", "next.config.ts"];
const RESOLUTION_NEUTRAL_OPTIONS = new Set([
  "assetPrefix",
  "basePath",
  "images",
  "reactStrictMode",
]);

const isEnvironmentValue = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  isNodeOfType(node.property, "Identifier") &&
  isNodeOfType(node.object, "MemberExpression") &&
  !node.object.computed &&
  isNodeOfType(node.object.object, "Identifier") &&
  node.object.object.name === "process" &&
  isNodeOfType(node.object.property, "Identifier") &&
  node.object.property.name === "env";

const isPlainConfigValue = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Literal") || isEnvironmentValue(value)) return true;
  if (isNodeOfType(value, "ArrayExpression")) {
    return value.elements.every(isPlainConfigValue);
  }
  return (
    isNodeOfType(value, "ObjectExpression") &&
    value.properties.every((property) => {
      if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed) {
        return false;
      }
      const key = getStaticPropertyKeyName(property);
      return key !== null && key !== "__proto__" && isPlainConfigValue(property.value);
    })
  );
};

const readConfigExport = (statement: EsTreeNode | undefined): EsTreeNode | null => {
  if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
    return stripParenExpression(statement.declaration);
  }
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const assignment = statement.expression;
  if (!isNodeOfType(assignment, "AssignmentExpression") || assignment.operator !== "=") {
    return null;
  }
  const target = assignment.left;
  return isNodeOfType(target, "MemberExpression") &&
    !target.computed &&
    isNodeOfType(target.object, "Identifier") &&
    target.object.name === "module" &&
    isNodeOfType(target.property, "Identifier") &&
    target.property.name === "exports"
    ? stripParenExpression(assignment.right)
    : null;
};

const readStaticConfigObject = (program: EsTreeNode): EsTreeNode | null => {
  if (!isNodeOfType(program, "Program")) return null;
  const statements = program.body.filter(
    (statement) =>
      !(isNodeOfType(statement, "ImportDeclaration") && statement.importKind === "type") &&
      !isNodeOfType(statement, "TSInterfaceDeclaration") &&
      !isNodeOfType(statement, "TSTypeAliasDeclaration"),
  );
  if (statements.length === 1) return readConfigExport(statements[0]);
  if (statements.length !== 2) return null;
  const [binding, declaration] = statements;
  const exported = readConfigExport(declaration);
  if (
    !isNodeOfType(exported, "Identifier") ||
    !isNodeOfType(binding, "VariableDeclaration") ||
    binding.kind !== "const" ||
    binding.declarations.length !== 1
  ) {
    return null;
  }
  const [initializer] = binding.declarations;
  if (
    !isNodeOfType(initializer, "VariableDeclarator") ||
    !isNodeOfType(initializer.id, "Identifier") ||
    initializer.id.name !== exported.name ||
    !initializer.init
  ) {
    return null;
  }
  return stripParenExpression(initializer.init);
};

export const hasStaticNextModuleResolution = (packageDirectory: string): boolean => {
  let configPath: string | null = null;
  for (const configName of CONFIG_NAMES) {
    const candidate = path.join(packageDirectory, configName);
    recordExistenceProbe(candidate);
    if (!fs.existsSync(candidate)) continue;
    if (configPath !== null) return false;
    configPath = candidate;
  }
  if (!configPath) return false;
  const program = parseSourceFile(configPath);
  const config = program && readStaticConfigObject(program);
  return (
    isNodeOfType(config, "ObjectExpression") &&
    config.properties.every((property) => {
      if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed) {
        return false;
      }
      const key = getStaticPropertyKeyName(property);
      return (
        key !== null && RESOLUTION_NEUTRAL_OPTIONS.has(key) && isPlainConfigValue(property.value)
      );
    })
  );
};
