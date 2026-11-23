import type { EsTreeNode } from "./es-tree-node.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";

export interface DeclaredElectronRendererConfig {
  readonly rendererSourceAlias: {
    readonly find: string;
    readonly relativeReplacement: string;
  } | null;
}

// A static selector, not a provider certificate. The caller must independently
// verify the selected launcher, installed compiler, defaults and source reachability.
export const readDeclaredElectronRendererConfig = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): DeclaredElectronRendererConfig | null => {
  if (!isNodeOfType(program, "Program") || (program.body.length !== 3 && program.body.length !== 4))
    return null;
  const roles = new Map<string, SymbolDescriptor>();
  const used = new Set<EsTreeNode>();
  const addImport = (binding: EsTreeNode, role: string): boolean => {
    const symbol = scopes.symbolFor(binding);
    if (!symbol || symbol.kind !== "import" || roles.has(role)) return false;
    roles.set(role, symbol);
    return true;
  };
  let exported: EsTreeNode | undefined;
  for (const statement of program.body) {
    if (isNodeOfType(statement, "ExportDefaultDeclaration")) {
      if (exported) return null;
      exported = statement.declaration;
      continue;
    }
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      statement.specifiers.length === 0 ||
      statement.attributes?.length
    )
      return null;
    const source = statement.source.value;
    for (const specifier of statement.specifiers) {
      if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
        if (source !== "@vitejs/plugin-react" || !addImport(specifier.local, "react")) return null;
      } else if (
        isNodeOfType(specifier, "ImportSpecifier") &&
        specifier.importKind !== "type" &&
        isNodeOfType(specifier.imported, "Identifier")
      ) {
        const name = specifier.imported.name;
        if ((source === "path" || source === "node:path") && name === "resolve") {
          if (!addImport(specifier.local, "resolve")) return null;
        } else if (
          source === "electron-vite" &&
          (name === "defineConfig" || name === "externalizeDepsPlugin")
        ) {
          if (!addImport(specifier.local, name)) return null;
        } else return null;
      } else return null;
    }
  }
  if (
    (roles.size !== 3 && roles.size !== 4) ||
    !roles.has("react") ||
    !roles.has("defineConfig") ||
    !roles.has("externalizeDepsPlugin") ||
    !exported
  )
    return null;
  const isRoleCall = (value: EsTreeNode, role: string, count: number): boolean => {
    if (
      !isNodeOfType(value, "CallExpression") ||
      value.optional ||
      value.arguments.length !== count ||
      !isNodeOfType(value.callee, "Identifier") ||
      scopes.symbolFor(value.callee) !== roles.get(role)
    )
      return false;
    used.add(value.callee);
    return true;
  };
  const fields = (value: EsTreeNode): Map<string, EsTreeNode> | null => {
    if (!isNodeOfType(value, "ObjectExpression")) return null;
    const result = new Map<string, EsTreeNode>();
    for (const property of value.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.kind !== "init" ||
        property.computed ||
        property.method ||
        property.shorthand
      )
        return null;
      const name = isNodeOfType(property.key, "Identifier")
        ? property.key.name
        : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
          ? property.key.value
          : null;
      if (name === null || result.has(name)) return null;
      result.set(name, property.value);
    }
    return result;
  };
  const pluginList = (value: EsTreeNode | undefined, role: string): boolean =>
    isNodeOfType(value, "ArrayExpression") &&
    value.elements.length === 1 &&
    value.elements[0] !== null &&
    isRoleCall(value.elements[0], role, 0);
  if (!isRoleCall(exported, "defineConfig", 1) || !isNodeOfType(exported, "CallExpression"))
    return null;
  const root = fields(exported.arguments[0]);
  if (!root || root.size !== 3) return null;
  for (const scope of ["main", "preload"]) {
    const value = root.get(scope);
    const scoped = value ? fields(value) : null;
    if (!scoped || scoped.size !== 1 || !pluginList(scoped.get("plugins"), "externalizeDepsPlugin"))
      return null;
  }
  const rendererValue = root.get("renderer");
  const renderer = rendererValue ? fields(rendererValue) : null;
  if (
    !renderer ||
    renderer.size < 1 ||
    renderer.size > 2 ||
    !pluginList(renderer.get("plugins"), "react")
  )
    return null;
  let rendererSourceAlias: DeclaredElectronRendererConfig["rendererSourceAlias"] = null;
  if (renderer.size === 2) {
    const resolveValue = renderer.get("resolve");
    const resolve = resolveValue ? fields(resolveValue) : null;
    const aliasValue = resolve?.get("alias");
    const alias = aliasValue ? fields(aliasValue) : null;
    if (!resolve || resolve.size !== 1 || !alias || alias.size !== 1) return null;
    const [[find, replacement]] = alias;
    if (
      !/^@[A-Za-z][A-Za-z0-9_-]*$/u.test(find) ||
      !isRoleCall(replacement, "resolve", 1) ||
      !isNodeOfType(replacement, "CallExpression")
    )
      return null;
    const relative = replacement.arguments[0];
    if (
      !isNodeOfType(relative, "Literal") ||
      typeof relative.value !== "string" ||
      !/^src\/renderer\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/u.test(relative.value)
    )
      return null;
    rendererSourceAlias = { find, relativeReplacement: relative.value };
  }
  // Bindings may be renamed, but they cannot escape, be replaced, or acquire
  // extra runtime uses elsewhere in the config module.
  for (const symbol of roles.values()) {
    if (
      !hasCompleteSymbolReferences(symbol, program, scopes) ||
      !symbol.references.every(({ identifier }) => used.has(identifier))
    )
      return null;
    if (symbol.references.length === 0) return null;
  }
  return { rendererSourceAlias };
};
