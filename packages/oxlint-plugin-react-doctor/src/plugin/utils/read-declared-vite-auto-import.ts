import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export interface DeclaredViteAutoImportAlias {
  readonly find: string;
  readonly relativeReplacement: string;
}

export interface DeclaredViteAutoImportConfig {
  readonly dirs: readonly string[];
  readonly aliases: readonly DeclaredViteAutoImportAlias[];
  readonly declarationPath: string;
}

const relativeDirectory = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/u;
const declarationFile = /^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.d\.ts$/u;
const localAliasPrefix = /^(?:~|@|src)\/?$/u;

const readFields = (
  node: EsTreeNode | null | undefined,
  required: readonly string[] | null,
): Map<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.computed ||
      property.method ||
      property.shorthand
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || fields.has(name) || (required && !required.includes(name))) return null;
    fields.set(name, property.value);
  }
  return required && required.length !== fields.size ? null : fields;
};

const stringLiteral = (node: EsTreeNode | null | undefined): string | null =>
  isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;

const directFactory = (
  node: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
  source: string,
  importedName: string,
  arity: number,
): node is Extract<EsTreeNode, { type: "CallExpression" }> => {
  if (
    !isNodeOfType(node, "CallExpression") ||
    node.optional ||
    node.arguments.length !== arity ||
    !isNodeOfType(node.callee, "Identifier")
  )
    return false;
  const binding = resolveImportedApiReference(node.callee, scopes);
  return binding?.source === source && binding.importedName === importedName;
};

const readRootRelativeAlias = (
  input: EsTreeNode,
  trailingSlash: boolean,
  scopes: ScopeAnalysis,
): string | null => {
  const expression = stripParenExpression(input);
  let candidate = expression;
  if (trailingSlash) {
    if (
      !isNodeOfType(expression, "TemplateLiteral") ||
      expression.expressions.length !== 1 ||
      expression.quasis.length !== 2 ||
      expression.quasis[0]?.value.cooked !== "" ||
      expression.quasis[1]?.value.cooked !== "/" ||
      !expression.expressions[0]
    )
      return null;
    candidate = stripParenExpression(expression.expressions[0]);
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    candidate.optional ||
    candidate.arguments.length !== 2
  )
    return null;
  const callee = candidate.callee;
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    callee.computed ||
    callee.optional ||
    !isNodeOfType(callee.property, "Identifier") ||
    callee.property.name !== "resolve" ||
    !isNodeOfType(callee.object, "Identifier")
  )
    return null;
  const binding = resolveImportedApiReference(callee.object, scopes);
  if (
    binding?.importedName !== "default" ||
    (binding.source !== "path" && binding.source !== "node:path")
  )
    return null;
  const [directory, replacement] = candidate.arguments;
  const relative = stringLiteral(replacement);
  return isNodeOfType(directory, "Identifier") &&
    directory.name === "__dirname" &&
    scopes.isGlobalReference(directory) &&
    relative !== null &&
    relativeDirectory.test(relative)
    ? relative
    : null;
};

const readAliases = (
  node: EsTreeNode | undefined,
  scopes: ScopeAnalysis,
): DeclaredViteAutoImportAlias[] | null => {
  const fields = readFields(readFields(node, ["alias"])?.get("alias"), null);
  if (!fields?.size) return null;
  const aliases: DeclaredViteAutoImportAlias[] = [];
  const seen = new Set<string>();
  for (const [rawFind, replacement] of fields) {
    if (!localAliasPrefix.test(rawFind)) return null;
    const hasTrailingSlash = rawFind.endsWith("/");
    const find = hasTrailingSlash ? rawFind.slice(0, -1) : rawFind;
    const relativeReplacement = readRootRelativeAlias(replacement, hasTrailingSlash, scopes);
    if (!relativeReplacement || seen.has(find)) return null;
    seen.add(find);
    aliases.push({ find, relativeReplacement });
  }
  return aliases;
};

const readScanDirectories = (node: EsTreeNode | undefined): string[] | null => {
  if (!isNodeOfType(node, "ArrayExpression") || node.elements.length === 0) return null;
  const dirs = new Set<string>();
  for (const element of node.elements) {
    const value = stringLiteral(element);
    if (!value || dirs.has(value) || !relativeDirectory.test(value.replace(/\/\*\*$/u, "")))
      return null;
    dirs.add(value);
  }
  return [...dirs];
};

/** Reads the local config declaration. Package selection and build/runtime ownership are separate. */
export const readDeclaredViteAutoImportConfig = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): DeclaredViteAutoImportConfig | null => {
  if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return null;
  const exported = program.body.at(-1);
  const imports = program.body.slice(0, -1);
  if (
    !isNodeOfType(exported, "ExportDefaultDeclaration") ||
    imports.length !== 5 ||
    !imports.every(
      (statement) =>
        isNodeOfType(statement, "ImportDeclaration") &&
        statement.importKind !== "type" &&
        statement.specifiers.length === 1 &&
        typeof statement.source.value === "string",
    )
  )
    return null;
  const factory = exported.declaration;
  if (!directFactory(factory, scopes, "vite", "defineConfig", 1)) return null;
  const options = readFields(factory.arguments[0], ["plugins", "resolve"]);
  const plugins = options?.get("plugins");
  if (!isNodeOfType(plugins, "ArrayExpression") || plugins.elements.length !== 3) return null;
  const [styles, react, autoImport] = plugins.elements;
  if (
    !directFactory(styles, scopes, "unocss/vite", "default", 0) ||
    !directFactory(react, scopes, "@vitejs/plugin-react", "default", 0) ||
    !directFactory(autoImport, scopes, "unplugin-auto-import/vite", "default", 1)
  )
    return null;
  const config = readFields(autoImport.arguments[0], ["dirs", "dts", "imports"]);
  const presets = config?.get("imports");
  if (
    !isNodeOfType(presets, "ArrayExpression") ||
    presets.elements.length !== 1 ||
    stringLiteral(presets.elements[0]) !== "react"
  )
    return null;
  const dirs = readScanDirectories(config?.get("dirs"));
  const declarationPath = stringLiteral(config?.get("dts"));
  const aliases = readAliases(options?.get("resolve"), scopes);
  return dirs && declarationPath && declarationFile.test(declarationPath) && aliases
    ? { dirs, aliases, declarationPath }
    : null;
};
