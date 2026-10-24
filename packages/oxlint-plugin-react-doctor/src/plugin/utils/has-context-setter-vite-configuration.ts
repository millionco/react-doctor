import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import {
  CONTEXT_SETTER_VITE_CONFIG_NAMES,
  CONTEXT_SETTER_VITE_PLUGIN_SOURCES,
  CONTEXT_SETTER_VITE_COMMAND_PATTERN,
  CONTEXT_SETTER_VITE_SCRIPT_NAME_PATTERN,
  CONTEXT_SETTER_DECLARED_PACKAGE_VERSION_PATTERN,
} from "../constants/context-state-setter.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES } from "./constants.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getStaticObjectPropertyValue } from "./get-static-object-property-value.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { parseSourceFile } from "./parse-source-file.js";
import { readPackageManifest } from "./read-nearest-package-manifest.js";
import { stripParenExpression } from "./strip-paren-expression.js";

const isPassiveConfigurationData = (node: EsTreeNode): boolean => {
  const value = stripParenExpression(node);
  if (isNodeOfType(value, "Literal")) return true;
  if (isNodeOfType(value, "ArrayExpression"))
    return value.elements.every(
      (element) =>
        element !== null &&
        !isNodeOfType(element, "SpreadElement") &&
        isPassiveConfigurationData(element),
    );
  return (
    isNodeOfType(value, "ObjectExpression") &&
    getOwnDataObjectProperties(value) !== null &&
    value.properties.every(
      (property) =>
        isNodeOfType(property, "Property") && isPassiveConfigurationData(property.value),
    )
  );
};

export const hasContextSetterViteConfiguration = (rootDirectory: string): boolean => {
  const manifest = readPackageManifest(rootDirectory);
  if (!manifest) return false;
  if (
    manifest.scripts &&
    Object.entries(manifest.scripts).some(
      ([name, command]) =>
        typeof command !== "string" ||
        ((CONTEXT_SETTER_VITE_SCRIPT_NAME_PATTERN.test(name) || /\bvite\b/.test(command)) &&
          !CONTEXT_SETTER_VITE_COMMAND_PATTERN.test(command)),
    )
  )
    return false;
  let filename: string | null = null;
  for (const name of CONTEXT_SETTER_VITE_CONFIG_NAMES) {
    const candidate = path.join(rootDirectory, name);
    recordExistenceProbe(candidate);
    recordContentProbe(candidate);
    try {
      const metadata = fs.lstatSync(candidate, { throwIfNoEntry: false });
      if (!metadata) continue;
      if (
        filename ||
        !metadata.isFile() ||
        metadata.size > SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES ||
        fs.realpathSync(candidate) !== path.resolve(candidate)
      )
        return false;
      filename = candidate;
    } catch {
      return false;
    }
  }
  if (!filename) return true;
  const program = parseSourceFile(filename);
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
  const scopes = analyzeScopes(program);
  const exports = program.body.filter((statement) =>
    isNodeOfType(statement, "ExportDefaultDeclaration"),
  );
  if (
    exports.length !== 1 ||
    program.body.some(
      (statement) =>
        !isNodeOfType(statement, "ImportDeclaration") &&
        !isNodeOfType(statement, "ExportDefaultDeclaration"),
    )
  )
    return false;
  for (const statement of program.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    const source = statement.source.value;
    if (
      typeof source !== "string" ||
      statement.importKind === "type" ||
      statement.specifiers.length !== 1 ||
      !["vite", "path", "node:path", ...CONTEXT_SETTER_VITE_PLUGIN_SOURCES].includes(source)
    )
      return false;
    if (source === "path" || source === "node:path") continue;
    const declarations = [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
    ];
    if (
      !declarations.some(
        (section) =>
          section &&
          typeof section[source] === "string" &&
          CONTEXT_SETTER_DECLARED_PACKAGE_VERSION_PATTERN.test(section[source]),
      )
    )
      return false;
  }
  const exported = exports[0];
  if (!isNodeOfType(exported, "ExportDefaultDeclaration")) return false;
  const factory = stripParenExpression(exported.declaration);
  if (
    !isNodeOfType(factory, "CallExpression") ||
    factory.optional ||
    factory.arguments.length !== 1 ||
    !isNodeOfType(factory.callee, "Identifier")
  )
    return false;
  const factorySymbol = scopes.symbolFor(factory.callee);
  const factoryImport = factorySymbol && getImportDeclarationForSymbol(factorySymbol);
  if (
    !factorySymbol ||
    !factoryImport ||
    factoryImport.source.value !== "vite" ||
    !isNodeOfType(factorySymbol.declarationNode, "ImportSpecifier") ||
    factorySymbol.declarationNode.importKind === "type" ||
    getImportedName(factorySymbol.declarationNode) !== "defineConfig"
  )
    return false;
  const configuration = factory.arguments[0];
  const keys = configuration && getOwnDataObjectProperties(configuration);
  if (
    !configuration ||
    !keys ||
    [...keys.keys()].some((key) => !["base", "resolve", "plugins"].includes(key))
  )
    return false;
  const base = getStaticObjectPropertyValue(configuration, "base");
  if (base !== undefined && (!isNodeOfType(base, "Literal") || typeof base.value !== "string"))
    return false;
  const resolve = getStaticObjectPropertyValue(configuration, "resolve");
  if (resolve !== undefined) {
    const resolveKeys = resolve && getOwnDataObjectProperties(resolve);
    if (!resolve || !resolveKeys || [...resolveKeys.keys()].some((key) => key !== "alias"))
      return false;
    const aliases = getStaticObjectPropertyValue(resolve, "alias");
    if (aliases !== undefined) {
      const aliasKeys = aliases && getOwnDataObjectProperties(aliases);
      if (!aliases || !aliasKeys || [...aliasKeys.keys()].some((key) => key !== "@")) return false;
      const target = getStaticObjectPropertyValue(aliases, "@");
      if (target !== undefined) {
        const call = target && stripParenExpression(target);
        if (
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.arguments.length !== 2 ||
          !isNodeOfType(call.callee, "MemberExpression") ||
          call.callee.computed ||
          call.callee.optional ||
          getStaticPropertyKeyName(call.callee) !== "resolve" ||
          !isNodeOfType(call.callee.object, "Identifier") ||
          !isNodeOfType(call.arguments[0], "Identifier") ||
          call.arguments[0].name !== "__dirname" ||
          !scopes.isGlobalReference(call.arguments[0]) ||
          !isNodeOfType(call.arguments[1], "Literal") ||
          call.arguments[1].value !== "./src"
        )
          return false;
        const receiver = scopes.symbolFor(call.callee.object);
        const imported = receiver && getImportDeclarationForSymbol(receiver);
        if (
          !receiver ||
          !imported ||
          !["path", "node:path"].includes(String(imported.source.value)) ||
          (!isNodeOfType(receiver.declarationNode, "ImportDefaultSpecifier") &&
            !isNodeOfType(receiver.declarationNode, "ImportNamespaceSpecifier"))
        )
          return false;
      }
    }
  }
  const plugins = getStaticObjectPropertyValue(configuration, "plugins");
  if (plugins !== undefined) {
    if (!isNodeOfType(plugins, "ArrayExpression")) return false;
    for (const plugin of plugins.elements) {
      if (
        !isNodeOfType(plugin, "CallExpression") ||
        plugin.optional ||
        !isNodeOfType(plugin.callee, "Identifier")
      )
        return false;
      const symbol = scopes.symbolFor(plugin.callee);
      const imported = symbol && getImportDeclarationForSymbol(symbol);
      const source = imported?.source.value;
      if (
        !symbol ||
        typeof source !== "string" ||
        !CONTEXT_SETTER_VITE_PLUGIN_SOURCES.includes(source)
      )
        return false;
      if (source === "vite-plugin-pwa") {
        if (
          !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
          getImportedName(symbol.declarationNode) !== "VitePWA" ||
          symbol.declarationNode.importKind === "type" ||
          plugin.arguments.length !== 1
        )
          return false;
        const options = plugin.arguments[0];
        const optionKeys = options && getOwnDataObjectProperties(options);
        if (
          !options ||
          !optionKeys ||
          [...optionKeys.keys()].some((key) => key !== "manifest") ||
          !isPassiveConfigurationData(options)
        )
          return false;
      } else if (
        !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier") ||
        plugin.arguments.length !== 0
      )
        return false;
    }
  }
  return true;
};
