import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isPathInside } from "./is-path-inside.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import {
  REFERENCED_VITE_CONFIG_FILENAMES,
  REFERENCED_VITE_WEBPACK_CONFIG_FILENAMES,
  REFERENCED_VITE_SINGLE_COUNT,
  REFERENCED_VITE_RESOLVE_ARGUMENT_COUNT,
} from "./constants.js";

interface ReferencedTsconfigViteAliasInput {
  readonly rootDirectory: string;
  readonly fromFilePath: string;
  readonly specifier: string;
  readonly resolvedFilePath: string;
  readonly aliasPattern: string;
  readonly targetPattern: string;
  readonly baseDirectory: string;
  readonly configPath: string;
}

export const isReferencedTsconfigAliasCongruentWithVite = ({
  rootDirectory,
  fromFilePath,
  specifier,
  resolvedFilePath,
  aliasPattern,
  targetPattern,
  baseDirectory,
  configPath,
}: ReferencedTsconfigViteAliasInput): boolean => {
  try {
    const root = path.resolve(rootDirectory);
    if (
      !isPathInside(fromFilePath, root) ||
      !isPathInside(configPath, root) ||
      findNearestPackageDirectory(fromFilePath) !== root ||
      !aliasPattern.endsWith("/*") ||
      !targetPattern.endsWith("/*")
    )
      return false;
    const prefix = aliasPattern.slice(0, -"/*".length);
    const targetPrefix = targetPattern.slice(0, -"/*".length);
    if (
      !prefix ||
      /^(?:react|react-dom)(?:\/|$)/u.test(prefix) ||
      prefix.includes("*") ||
      prefix.includes("..") ||
      prefix.endsWith("/") ||
      targetPrefix.includes("*") ||
      !specifier.startsWith(`${prefix}/`)
    )
      return false;
    const suffix = specifier.slice(`${prefix}/`.length);
    if (
      !suffix ||
      /[!?#\\]/u.test(suffix) ||
      suffix.split("/").some((segment) => !segment || segment === "." || segment === "..")
    )
      return false;
    const aliasRoot = path.resolve(baseDirectory, targetPrefix);
    if (!isPathInside(aliasRoot, root) || !isPathInside(resolvedFilePath, aliasRoot)) return false;
    const manifest = readPackageManifest(root);
    if (
      !manifest ||
      (manifest.scripts !== undefined &&
        (!manifest.scripts ||
          Array.isArray(manifest.scripts) ||
          typeof manifest.scripts !== "object"))
    )
      return false;
    const commands = manifest.scripts ?? {};
    if (
      [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
        manifest.optionalDependencies,
      ].some(
        (group) =>
          group &&
          (Array.isArray(group) ||
            typeof group !== "object" ||
            Object.keys(group).some((name) => /webpack/iu.test(name))),
      )
    )
      return false;
    for (const basename of REFERENCED_VITE_WEBPACK_CONFIG_FILENAMES) {
      const filename = path.join(root, basename);
      recordExistenceProbe(filename);
      if (fs.lstatSync(filename, { throwIfNoEntry: false })) return false;
    }
    const scripts = Object.values(commands);
    if (
      scripts.some((command) => typeof command !== "string" || /webpack/iu.test(command)) ||
      scripts.some(
        (command) =>
          typeof command === "string" && /\bvite\b[^\n]*--config(?:[=\s]|$)/u.test(command),
      )
    )
      return false;
    const candidates: string[] = [];
    for (const basename of REFERENCED_VITE_CONFIG_FILENAMES) {
      const filename = path.join(root, basename);
      recordExistenceProbe(filename);
      const info = fs.lstatSync(filename, { throwIfNoEntry: false });
      if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink() || fs.realpathSync(filename) !== filename)
        return false;
      candidates.push(filename);
    }
    if (!candidates.length) return true;
    if (
      candidates.length !== REFERENCED_VITE_SINGLE_COUNT ||
      commands.build !== "vite build" ||
      Object.hasOwn(commands, "prebuild") ||
      Object.hasOwn(commands, "postbuild")
    )
      return false;
    const filename = candidates.at(0);
    if (!filename) return false;
    const program = parseSourceFile(filename);
    if (!program || !isNodeOfType(program, "Program")) return false;
    const scopes = analyzeScopes(program);
    const exports = program.body.filter((statement) =>
      isNodeOfType(statement, "ExportDefaultDeclaration"),
    );
    if (exports.length !== REFERENCED_VITE_SINGLE_COUNT) return false;
    const exported = findExportedValue(program, "default");
    const value = exported ? stripParenExpression(exported) : null;
    if (
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      value.arguments.length !== REFERENCED_VITE_SINGLE_COUNT ||
      !isNodeOfType(value.callee, "Identifier") ||
      !isNodeOfType(findTransparentExpressionRoot(value).parent, "ExportDefaultDeclaration")
    )
      return false;
    const defineConfig = getImportBindingForName(value.callee, value.callee.name);
    const factorySymbol = scopes.symbolFor(value.callee);
    if (
      !factorySymbol ||
      defineConfig?.source !== "vite" ||
      defineConfig.exportedName !== "defineConfig" ||
      !hasOnlyAllowedSymbolReads({
        symbol: factorySymbol,
        allowedIdentifiers: new Set([value.callee]),
        program,
        scopes,
      })
    )
      return false;
    const argument = value.arguments.at(0);
    const properties = argument ? getOwnDataObjectProperties(stripParenExpression(argument)) : null;
    if (!properties || properties.has("root") || properties.has("configFile")) return false;
    const resolveNode = properties.get("resolve");
    const resolution = resolveNode
      ? getOwnDataObjectProperties(stripParenExpression(resolveNode))
      : null;
    if (!resolution || resolution.size !== REFERENCED_VITE_SINGLE_COUNT) return false;
    const aliasesNode = resolution.get("alias");
    const aliases = aliasesNode
      ? getOwnDataObjectProperties(stripParenExpression(aliasesNode))
      : null;
    if (!aliases || aliases.size !== REFERENCED_VITE_SINGLE_COUNT || !aliases.has(prefix))
      return false;
    const esbuildNode = properties.get("esbuild");
    if (esbuildNode) {
      const options = getOwnDataObjectProperties(stripParenExpression(esbuildNode));
      if (!options || [...options.keys()].some((name) => /^jsx/iu.test(name))) return false;
    }
    const defineNode = properties.get("define");
    if (defineNode) {
      const options = getOwnDataObjectProperties(stripParenExpression(defineNode));
      if (
        !options ||
        [...options.keys()].some((name) =>
          /^(?:React|__dirname|require|globalThis\.React)(?:\.|$)/u.test(name),
        )
      )
        return false;
    }
    const selected = aliases.get(prefix);
    const replacement = selected ? stripParenExpression(selected) : null;
    if (
      !isNodeOfType(replacement, "CallExpression") ||
      replacement.optional ||
      replacement.arguments.length !== REFERENCED_VITE_RESOLVE_ARGUMENT_COUNT ||
      !isNodeOfType(replacement.callee, "MemberExpression") ||
      replacement.callee.optional ||
      getStaticPropertyName(replacement.callee) !== "resolve" ||
      !isNodeOfType(replacement.callee.object, "Identifier")
    )
      return false;
    const [directory, relative] = replacement.arguments;
    if (
      !isNodeOfType(directory, "Identifier") ||
      directory.name !== "__dirname" ||
      !scopes.isGlobalReference(directory) ||
      !isNodeOfType(relative, "Literal") ||
      typeof relative.value !== "string" ||
      path.isAbsolute(relative.value) ||
      path.resolve(path.dirname(filename), relative.value) !== aliasRoot
    )
      return false;
    const pathSymbol = scopes.symbolFor(replacement.callee.object);
    if (!pathSymbol) return false;
    for (const symbol of scopes.rootScope.symbols) {
      if (symbol.kind !== "import") continue;
      const imported = getImportBindingForName(program, symbol.name);
      if (!imported || !["path", "node:path", "vite"].includes(imported.source)) continue;
      if (imported.source === "vite") {
        if (imported.isNamespace || imported.exportedName === "default") return false;
        if (
          imported.exportedName === "defineConfig" &&
          symbol !== factorySymbol &&
          !hasOnlyAllowedSymbolReads({ symbol, allowedIdentifiers: new Set(), program, scopes })
        )
          return false;
        continue;
      }
      if (!imported.isNamespace && imported.exportedName !== "default") return false;
      const allowed = new Set<EsTreeNode>();
      for (const reference of symbol.references) {
        const root = findTransparentExpressionRoot(reference.identifier);
        const member = root.parent;
        const call = member ? findTransparentExpressionRoot(member).parent : null;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          member.optional ||
          getStaticPropertyName(member) !== "resolve" ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.callee !== findTransparentExpressionRoot(member)
        )
          return false;
        allowed.add(reference.identifier);
      }
      if (!hasOnlyAllowedSymbolReads({ symbol, allowedIdentifiers: allowed, program, scopes }))
        return false;
    }
    const importedPath = getImportBindingForName(
      replacement.callee.object,
      replacement.callee.object.name,
    );
    if (
      pathSymbol.kind !== "import" ||
      !importedPath ||
      !["path", "node:path"].includes(importedPath.source) ||
      (!importedPath.isNamespace && importedPath.exportedName !== "default")
    )
      return false;
    let ordinaryDirectory = true;
    walkAst(program, (node) => {
      if (
        isNodeOfType(node, "ImportExpression") ||
        isNodeOfType(node, "TSImportEqualsDeclaration") ||
        (isNodeOfType(node, "Identifier") &&
          node.name === "require" &&
          scopes.isGlobalReference(node))
      )
        ordinaryDirectory = false;
      if (
        isNodeOfType(node, "ImportDeclaration") &&
        node.importKind !== "type" &&
        ["module", "node:module", "vm", "node:vm"].includes(node.source.value)
      )
        ordinaryDirectory = false;
      if (
        isNodeOfType(node, "Identifier") &&
        node.name === "__dirname" &&
        scopes.referenceFor(node)
      ) {
        const root = findTransparentExpressionRoot(node);
        const call = root.parent;
        if (
          !scopes.isGlobalReference(node) ||
          !isNodeOfType(call, "CallExpression") ||
          call.arguments.at(0) !== root ||
          !isNodeOfType(call.callee, "MemberExpression") ||
          getStaticPropertyName(call.callee) !== "resolve"
        )
          ordinaryDirectory = false;
      }
      return ordinaryDirectory;
    });
    return ordinaryDirectory;
  } catch {
    return false;
  }
};
