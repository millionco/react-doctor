import { CROSS_FILE_BARREL_FOLLOW_DEPTH } from "../constants/thresholds.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getStableLexicalBindingValue } from "./get-stable-lexical-binding-value.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import type {
  NamedViteSourceModule,
  NamedViteSourceProject,
} from "./read-named-vite8-callback-compiler.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";

interface VerifiedViteExport {
  readonly module: NamedViteSourceModule;
  readonly exportedNode: EsTreeNode;
  readonly bindingIdentity: EsTreeNode;
}

const resolveInModule = (
  project: NamedViteSourceProject,
  module: NamedViteSourceModule,
  exportedName: string,
  visited: ReadonlySet<string>,
): VerifiedViteExport | null | undefined => {
  const key = `${module.filePath}\0${exportedName}`;
  if (visited.has(key) || visited.size >= CROSS_FILE_BARREL_FOLLOW_DEPTH) return null;
  const nextVisited = new Set(visited).add(key);
  const entries = module.staticExports.filter((entry) => !entry.isType);
  const explicit = entries.filter((entry) =>
    entry.exportName.kind === "Default"
      ? exportedName === "default"
      : entry.exportName.kind === "Name" && entry.exportName.name === exportedName,
  );
  if (explicit.length > 1) return null;

  const follow = (specifier: string, name: string) => {
    const filePath = module.localImports.get(specifier);
    const target = filePath && project.modulesByFilePath.get(filePath);
    return target ? resolveInModule(project, target, name, nextVisited) : null;
  };

  const [direct] = explicit;
  if (direct) {
    if (direct.moduleRequest) {
      return direct.importName.kind === "Name" && direct.importName.name
        ? (follow(direct.moduleRequest.value, direct.importName.name) ?? null)
        : null;
    }
    const localName = direct.localName.name;
    if (localName) {
      const binding = module.scopes.rootScope.symbolsByName.get(localName);
      if (!binding || binding.references.some((reference) => reference.flag !== "read"))
        return null;
      if (binding.kind === "import" && direct.localName.kind === "Name") {
        const imported = resolveImportedApiReference(binding.bindingIdentifier, module.scopes);
        return imported?.importedName && !imported.isNamespace
          ? (follow(imported.source, imported.importedName) ?? null)
          : null;
      }
      const value = getStableLexicalBindingValue(binding, module.scopes);
      if (!value) return null;
      return {
        module,
        exportedNode: value,
        bindingIdentity: binding.bindingIdentifier,
      };
    }
    if (exportedName !== "default" || module.programNode.type !== "Program") return null;
    const declaration = module.programNode.body.find(
      (statement) => statement.type === "ExportDefaultDeclaration",
    );
    if (declaration?.type !== "ExportDefaultDeclaration") return null;
    return {
      module,
      exportedNode: stripParenExpression(declaration.declaration),
      bindingIdentity: declaration,
    };
  }

  if (exportedName === "default") return undefined;
  let resolved: VerifiedViteExport | undefined;
  for (const entry of entries) {
    if (entry.importName.kind !== "AllButDefault" || !entry.moduleRequest) continue;
    const result = follow(entry.moduleRequest.value, exportedName);
    if (
      result === null ||
      (resolved && result && resolved.bindingIdentity !== result.bindingIdentity)
    )
      return null;
    resolved ??= result;
  }
  return resolved;
};

export const resolveVerifiedViteExport = (
  project: NamedViteSourceProject,
  fromModule: NamedViteSourceModule,
  specifier: string,
  exportedName: string,
): VerifiedViteExport | null => {
  const path = fromModule.localImports.get(specifier);
  const target = path && project.modulesByFilePath.get(path);
  return target ? (resolveInModule(project, target, exportedName, new Set()) ?? null) : null;
};
