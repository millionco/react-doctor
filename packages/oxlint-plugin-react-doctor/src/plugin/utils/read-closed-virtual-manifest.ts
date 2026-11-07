import {
  STATIC_VIRTUAL_MANIFEST_MAX_ID_CHARS,
  STATIC_VIRTUAL_MODULE_MAX_IDS,
  STATIC_VIRTUAL_MANIFEST_MAX_DATA_DEPTH,
  STATIC_VIRTUAL_MANIFEST_MAX_MODULES,
  STATIC_VIRTUAL_MANIFEST_MAX_EDGES,
  STATIC_VIRTUAL_MANIFEST_MAX_AST_NODES,
} from "../constants/thresholds.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import { createVirtualProviderGuard } from "./create-virtual-provider-guard.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getImportedName } from "./get-imported-name.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { walkAst } from "./walk-ast.js";

interface ReadClosedVirtualManifestInput {
  readonly entry: SourceProjectModule;
  readonly exportedName: string;
  readonly idProperty: string;
  readonly resolveLocalModule: (
    from: SourceProjectModule,
    specifier: string,
  ) => SourceProjectModule | null;
}

interface ModuleCensus {
  readonly module: SourceProjectModule;
  readonly exportNames: ReadonlySet<string>;
  readonly manifestIds: ReadonlyArray<string> | null;
  readonly factoryNames: ReadonlySet<string>;
}

interface ClosedVirtualManifest {
  readonly ids: ReadonlyArray<string>;
  readonly factoryNames: ReadonlySet<string>;
}

const LOCAL_ESM_SOURCE_PATTERN = /^\.\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.m?js$/u;
const MANIFEST_ID_PATTERN = /^[a-z0-9]+$/u;
const readOwnDataFields = (
  node: EsTreeNode | null | undefined,
): ReadonlyMap<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression")) return null;
  const fields = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      property.method ||
      property.computed ||
      property.shorthand
    ) {
      return null;
    }
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || fields.has(name)) return null;
    fields.set(name, property.value);
  }
  return fields;
};

const isLiteralData = (node: EsTreeNode | null, depth: number, scopes?: ScopeAnalysis): boolean => {
  if (!node || depth > STATIC_VIRTUAL_MANIFEST_MAX_DATA_DEPTH) return false;
  if (isNodeOfType(node, "Identifier"))
    return node.name === "undefined" && Boolean(scopes?.isGlobalReference(node));
  if (isNodeOfType(node, "Literal")) {
    return (
      (node.value === null && !("regex" in node) && !("bigint" in node)) ||
      typeof node.value === "string" ||
      typeof node.value === "boolean" ||
      (typeof node.value === "number" && Number.isFinite(node.value))
    );
  }
  if (isNodeOfType(node, "ArrayExpression")) {
    return node.elements.every((element) => isLiteralData(element, depth + 1, scopes));
  }
  const fields = readOwnDataFields(node);
  return (
    fields !== null &&
    [...fields.values()].every((value) => isLiteralData(value, depth + 1, scopes))
  );
};

const readReactContextFactory = (node: EsTreeNode, scopes: ScopeAnalysis) => {
  if (
    !isNodeOfType(node, "MemberExpression") ||
    node.optional ||
    getStaticPropertyKeyName(node) !== "createContext" ||
    !isNodeOfType(node.object, "Identifier")
  )
    return null;
  const binding = scopes.symbolFor(node.object);
  if (!binding || !isNodeOfType(binding.declarationNode, "ImportDefaultSpecifier")) return null;
  return getImportDeclarationForSymbol(binding)?.source.value === "react" ? binding : null;
};

const hasSafeProviderInitializer = (
  node: EsTreeNode | null,
  scopes: ScopeAnalysis,
  inertBindings: ReadonlySet<number>,
): boolean => {
  if (!node) return false;
  let call = node;
  if (isNodeOfType(node, "LogicalExpression") && node.operator === "&&") call = node.right;
  if (!isNodeOfType(call, "CallExpression") || call.optional || call.arguments.length !== 1)
    return false;
  const factory = readReactContextFactory(call.callee, scopes);
  if (
    !factory ||
    (isNodeOfType(node, "LogicalExpression") &&
      readReactContextFactory(node.left, scopes) !== factory)
  )
    return false;
  const argument = call.arguments[0];
  if (!argument) return false;
  const binding = isNodeOfType(argument, "Identifier") ? scopes.symbolFor(argument) : null;
  return isLiteralData(argument, 0, scopes) || Boolean(binding && inertBindings.has(binding.id));
};

const readManifestIds = (
  module: SourceProjectModule,
  declaration: EsTreeNodeOfType<"VariableDeclaration">,
  idProperty: string,
): ReadonlyArray<string> | null => {
  if (
    module.programNode.body.length !== 1 ||
    (declaration.kind !== "const" && declaration.kind !== "var") ||
    declaration.declarations.length !== 1
  ) {
    return null;
  }
  const binding = declaration.declarations[0];
  if (!binding || !isNodeOfType(binding.id, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(binding.id);
  const manifest = binding.init;
  if (
    !symbol ||
    symbol.references.length !== 0 ||
    !isNodeOfType(manifest, "ArrayExpression") ||
    manifest.elements.length === 0 ||
    manifest.elements.length > STATIC_VIRTUAL_MODULE_MAX_IDS
  ) {
    return null;
  }
  const ids = new Set<string>();
  for (const record of manifest.elements) {
    const fields = readOwnDataFields(record);
    const id = fields?.get(idProperty);
    if (
      !fields ||
      !isNodeOfType(id, "Literal") ||
      typeof id.value !== "string" ||
      id.value.length > STATIC_VIRTUAL_MANIFEST_MAX_ID_CHARS ||
      !MANIFEST_ID_PATTERN.test(id.value) ||
      ids.has(id.value) ||
      ![...fields.values()].every((value) => isLiteralData(value, 1))
    ) {
      return null;
    }
    ids.add(id.value);
  }
  return [...ids];
};

export const readClosedVirtualManifest = ({
  entry,
  exportedName,
  idProperty,
  resolveLocalModule,
}: ReadClosedVirtualManifestInput): ClosedVirtualManifest | null => {
  const visiting = new Set<string>();
  const completed = new Map<string, ModuleCensus>();
  let remainingNodes = STATIC_VIRTUAL_MANIFEST_MAX_AST_NODES;
  let remainingEdges = STATIC_VIRTUAL_MANIFEST_MAX_EDGES;

  const inspect = (module: SourceProjectModule): ModuleCensus | null => {
    const existing = completed.get(module.filePath);
    if (existing) {
      return existing.module.programNode === module.programNode &&
        existing.module.scopes === module.scopes
        ? existing
        : null;
    }
    if (
      visiting.has(module.filePath) ||
      visiting.size + completed.size >= STATIC_VIRTUAL_MANIFEST_MAX_MODULES
    )
      return null;
    visiting.add(module.filePath);
    const guard = createVirtualProviderGuard(module.scopes, exportedName);
    let hasOpaqueLoader = false;
    walkAst(module.programNode, (node) => {
      if (hasOpaqueLoader) return false;
      remainingNodes -= 1;
      if (remainingNodes < 0 || guard.hasOpaqueAccess(node)) {
        hasOpaqueLoader = true;
        return false;
      }
    });
    if (hasOpaqueLoader) return null;

    const inspectEdge = (source: string): ModuleCensus | null => {
      if (remainingEdges <= 0 || !LOCAL_ESM_SOURCE_PATTERN.test(source)) return null;
      remainingEdges -= 1;
      const resolved = resolveLocalModule(module, source);
      return resolved ? inspect(resolved) : null;
    };

    const exportNames = new Set<string>();
    const factoryNames = new Set<string>();
    const inertBindings = new Set<number>();
    let manifestIds: ReadonlyArray<string> | null = null;
    for (const statement of module.programNode.body) {
      if (isNodeOfType(statement, "ImportDeclaration")) {
        if (isTypeOnlyImport(statement) || statement.attributes?.length) return null;
        if (statement.source.value === "react") {
          if (
            statement.specifiers.length !== 1 ||
            !isNodeOfType(statement.specifiers[0], "ImportDefaultSpecifier")
          ) {
            return null;
          }
          continue;
        }
        const imported = inspectEdge(statement.source.value);
        if (
          !imported ||
          imported.exportNames.has(exportedName) ||
          statement.specifiers.length === 0 ||
          !statement.specifiers.every((specifier) => {
            const name = getImportedName(specifier);
            return (
              isNodeOfType(specifier, "ImportSpecifier") &&
              specifier.importKind !== "type" &&
              name !== undefined &&
              imported.exportNames.has(name)
            );
          })
        ) {
          return null;
        }
        continue;
      }
      if (isNodeOfType(statement, "ExportAllDeclaration")) {
        if (statement.exported || statement.exportKind === "type" || statement.attributes?.length)
          return null;
        const reexported = inspectEdge(statement.source.value);
        if (!reexported) return null;
        for (const name of reexported.exportNames) {
          if (exportNames.has(name)) return null;
          exportNames.add(name);
        }
        for (const name of reexported.factoryNames) factoryNames.add(name);
        if (reexported.manifestIds) manifestIds = reexported.manifestIds;
        continue;
      }
      const isExported = isNodeOfType(statement, "ExportNamedDeclaration");
      if (
        isExported &&
        (statement.source || statement.specifiers.length || statement.exportKind === "type")
      )
        return null;
      const declaration = isExported ? statement.declaration : statement;
      if (isNodeOfType(declaration, "FunctionDeclaration")) {
        if (!isExported) continue;
        const name = declaration.id?.name;
        if (!name || name === exportedName || exportNames.has(name)) return null;
        exportNames.add(name);
        const scope = module.scopes.scopeFor(declaration);
        const binding = scope.symbolsByName.get(name);
        if (binding?.initializer === declaration && guard.isLocalCallable(binding))
          factoryNames.add(name);
        continue;
      }
      if (!isNodeOfType(declaration, "VariableDeclaration")) return null;
      for (const binding of declaration.declarations) {
        if (!isNodeOfType(binding.id, "Identifier")) return null;
        if (isExported) {
          if (exportNames.has(binding.id.name)) return null;
          exportNames.add(binding.id.name);
        }
        if (isExported && binding.id.name === exportedName) {
          manifestIds = readManifestIds(module, declaration, idProperty);
          if (!manifestIds) return null;
        } else if (isLiteralData(binding.init, 0, module.scopes)) {
          const symbol = module.scopes.symbolFor(binding.id);
          if (!symbol || symbol.references.some(({ flag }) => flag !== "read")) return null;
          inertBindings.add(symbol.id);
        } else if (!hasSafeProviderInitializer(binding.init, module.scopes, inertBindings)) {
          return null;
        }
      }
    }
    visiting.delete(module.filePath);
    const census = { module, exportNames, manifestIds, factoryNames };
    completed.set(module.filePath, census);
    return census;
  };

  const result = inspect(entry);
  return result?.manifestIds
    ? { ids: result.manifestIds, factoryNames: result.factoryNames }
    : null;
};
