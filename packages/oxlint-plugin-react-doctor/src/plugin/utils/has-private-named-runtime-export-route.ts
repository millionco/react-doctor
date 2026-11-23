import * as path from "node:path";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { getImportedName } from "./get-imported-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { normalizeFilename } from "./normalize-filename.js";
import { walkAst } from "./walk-ast.js";

interface PrivateNamedExportRouteInput {
  // Use the effective package proof's index built with includeTestlikeSources.
  // The index construction and uniqueness callback record the filesystem probes,
  // including absence and recursive source membership.
  readonly index: SourceProjectIndex;
  readonly producer: SourceProjectModule;
  readonly publicEntryFilePaths: ReadonlySet<string>;
  readonly packageName: string | null;
  readonly exportedName: string;
  readonly hasUniqueRelativeRoute: (issuer: string, source: string, selected: string) => boolean;
  readonly isSafeReceiverUse: (identifier: EsTreeNode, module: SourceProjectModule) => boolean;
}

interface NamedExport {
  readonly filePath: string;
  readonly name: string;
}

const readName = (node: EsTreeNode | null | undefined): string | null => {
  if (isNodeOfType(node, "Identifier")) return node.name;
  return isNodeOfType(node, "Literal") && typeof node.value === "string" ? node.value : null;
};

const readSource = (node: EsTreeNode): string | null => {
  let value: EsTreeNode | null | undefined;
  if (
    isNodeOfType(node, "ImportDeclaration") ||
    isNodeOfType(node, "ExportNamedDeclaration") ||
    isNodeOfType(node, "ExportAllDeclaration") ||
    isNodeOfType(node, "ImportExpression")
  ) {
    value = node.source;
  } else if (
    isNodeOfType(node, "CallExpression") &&
    isNodeOfType(node.callee, "Identifier") &&
    node.callee.name === "require" &&
    node.arguments.length === 1
  ) {
    value = node.arguments[0];
  }
  return isNodeOfType(value, "Literal") && typeof value.value === "string" ? value.value : null;
};

const isRelativeSource = (source: string): boolean => /^\.\.?\//u.test(source);

const hasKnownSourceRoutes = (input: PrivateNamedExportRouteInput): boolean => {
  const { index, packageName } = input;
  if (index.hasOpaqueRuntimeConsumerSurface || index.hasOpaqueMdxConsumerSurface) return false;
  for (const source of index.unresolvedRuntimeSources) {
    if (
      source.startsWith(".") ||
      source.startsWith("#") ||
      source.startsWith("file:") ||
      path.isAbsolute(source) ||
      (packageName !== null && (source === packageName || source.startsWith(packageName + "/")))
    )
      return false;
  }
  const verifiedSourcesByIssuer = new Map<string, Map<string, string>>();
  for (const module of index.modulesByFilePath.values()) {
    recordContentProbe(module.filePath);
    let valid = true;
    walkAst(module.programNode, (node) => {
      if (!valid) return false;
      const selected = index.resolvedSourcePathByNode.get(node);
      if (selected === undefined) return;
      const source = readSource(node);
      if (source === null || !isRelativeSource(source)) {
        valid = false;
        return false;
      }
      // Deduplicate only within this invocation, after recording the route
      // once. The caller must replay the full probes if it caches the proof.
      let known = verifiedSourcesByIssuer.get(module.filePath);
      if (known === undefined) {
        known = new Map();
        verifiedSourcesByIssuer.set(module.filePath, known);
      }
      const previous = known.get(source);
      valid =
        previous === undefined
          ? input.hasUniqueRelativeRoute(module.filePath, source, selected)
          : previous === selected;
      if (valid) known.set(source, selected);
    });
    if (!valid) return false;
  }
  return true;
};

const collectBindingAliases = (
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
  enqueue: (name: string) => boolean,
  isSafeReceiverUse: PrivateNamedExportRouteInput["isSafeReceiverUse"],
): boolean => {
  const { programNode, scopes } = module;
  if (!hasCompleteSymbolReferences(symbol, programNode, scopes)) return false;
  for (const { flag, identifier } of symbol.references) {
    if (flag !== "read" || isWithinAssignmentTarget(identifier)) return false;
    const specifier = identifier.parent;
    if (isNodeOfType(specifier, "ExportSpecifier") && specifier.local === identifier) {
      const declaration = specifier.parent;
      if (!isNodeOfType(declaration, "ExportNamedDeclaration") || declaration.source) return false;
      if (specifier.exportKind === "type" || declaration.exportKind === "type") continue;
      const alias = readName(specifier.exported);
      if (alias === null || !enqueue(alias)) return false;
      continue;
    }
    if (!isSafeReceiverUse(identifier, module)) return false;
  }
  return true;
};

const collectConsumerAliases = (
  module: SourceProjectModule,
  target: NamedExport,
  input: PrivateNamedExportRouteInput,
  enqueue: (name: string) => boolean,
): boolean => {
  let valid = true;
  walkAst(module.programNode, (node) => {
    if (!valid) return false;
    if (input.index.resolvedSourcePathByNode.get(node) !== target.filePath) return;
    if (isNodeOfType(node, "ImportDeclaration")) {
      if (isTypeOnlyImport(node)) return false;
      for (const specifier of node.specifiers) {
        if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) {
          valid = false;
          return false;
        }
        if (
          !isNodeOfType(specifier, "ImportSpecifier") ||
          specifier.importKind === "type" ||
          getImportedName(specifier) !== target.name
        )
          continue;
        const binding = module.scopes.symbolFor(specifier.local);
        if (!binding || !collectBindingAliases(binding, module, enqueue, input.isSafeReceiverUse)) {
          valid = false;
          return false;
        }
      }
      return false;
    }
    if (isNodeOfType(node, "ExportNamedDeclaration") && node.source) {
      if (node.exportKind === "type") return false;
      for (const specifier of node.specifiers) {
        if (!isNodeOfType(specifier, "ExportSpecifier")) {
          valid = false;
          return false;
        }
        if (specifier.exportKind === "type" || readName(specifier.local) !== target.name) continue;
        const alias = readName(specifier.exported);
        if (alias === null || !enqueue(alias)) {
          valid = false;
          return false;
        }
      }
      return false;
    }
    if (isNodeOfType(node, "ExportAllDeclaration")) {
      if (node.exportKind === "type") return false;
      // A named namespace export would expose every value through an object.
      valid = node.exported == null && enqueue(target.name);
      return false;
    }
    // Dynamic import/require of the selected module produces a namespace.
    valid = false;
    return false;
  });
  return valid;
};

export const hasPrivateNamedRuntimeExportRoute = (input: PrivateNamedExportRouteInput): boolean => {
  const { producer, index, exportedName } = input;
  const publicEntries = new Set([...input.publicEntryFilePaths].map(normalizeFilename));
  if (
    publicEntries.size === 0 ||
    [...publicEntries].some((filePath) => !index.modulesByFilePath.has(filePath)) ||
    index.modulesByFilePath.get(producer.filePath) !== producer ||
    publicEntries.has(producer.filePath) ||
    exportedName === "default" ||
    !hasKnownSourceRoutes(input)
  )
    return false;
  const initialBinding = producer.scopes.rootScope.symbolsByName.get(exportedName);
  if (
    !initialBinding ||
    !isNodeOfType(initialBinding.declarationNode.parent?.parent, "ExportNamedDeclaration")
  )
    return false;

  const pending: NamedExport[] = [];
  const seenByFile = new Map<string, Set<string>>();
  const enqueue = (filePath: string, name: string): boolean => {
    if (publicEntries.has(filePath) || name === "default") return false;
    let seen = seenByFile.get(filePath);
    if (seen === undefined) {
      seen = new Set();
      seenByFile.set(filePath, seen);
    }
    if (!seen.has(name)) {
      seen.add(name);
      pending.push({ filePath, name });
    }
    return true;
  };
  if (
    !enqueue(producer.filePath, exportedName) ||
    !collectBindingAliases(
      initialBinding,
      producer,
      (name) => enqueue(producer.filePath, name),
      input.isSafeReceiverUse,
    )
  )
    return false;
  for (const target of pending) {
    for (const consumer of index.consumerModulesByFilePath.get(target.filePath) ?? []) {
      if (
        index.modulesByFilePath.get(consumer.filePath) !== consumer ||
        !collectConsumerAliases(consumer, target, input, (name) => enqueue(consumer.filePath, name))
      )
        return false;
    }
  }
  return true;
};
