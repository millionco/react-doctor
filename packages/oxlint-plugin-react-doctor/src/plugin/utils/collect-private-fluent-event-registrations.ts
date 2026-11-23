import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findProgramRoot } from "./find-program-root.js";
import { getImportedName } from "./get-imported-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasPrivateNamedRuntimeExportRoute } from "./has-private-named-runtime-export-route.js";
import { isNodeOfType } from "./is-node-of-type.js";
import {
  hasUniqueSourceResolution,
  hasUnmodifiedLocalCollections,
  readClosedPackageRuntimeSource,
} from "./is-private-imported-primitive-iterable.js";
import { normalizeFilename } from "./normalize-filename.js";
import { readPackageManifest } from "./read-nearest-package-manifest.js";
import {
  isDiscardedFluentEventReceiverUse,
  readBalancedPrivateFluentEventRegistrations,
  readPrivateFluentEventProviderMethods,
  readSelectedConstEnumPrimitive,
} from "./read-private-fluent-event-provider.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";

export const collectPrivateFluentEventRegistrations = (
  callback: EsTreeNode,
  { filename, scopes }: Pick<RuleContext, "filename" | "scopes">,
): ReadonlyArray<EsTreeNode> => {
  if (!filename || !isNodeOfType(callback, "ArrowFunctionExpression")) return [];
  const program = findProgramRoot(callback);
  if (!program) return [];
  const filePath = normalizeFilename(filename);
  const consumer = { filePath, programNode: program, scopes };
  let graph: ReturnType<typeof readClosedPackageRuntimeSource> | undefined;
  const readGraph = () => {
    if (graph === undefined) graph = readClosedPackageRuntimeSource(program, filename, scopes);
    return graph;
  };
  const resolveEdge = (binding: SymbolDescriptor) => {
    const declaration = getValueImportDeclaration(binding);
    if (!isNodeOfType(declaration, "ImportDeclaration")) return null;
    const source = declaration.source.value;
    const name = getImportedName(binding.declarationNode);
    if (typeof source !== "string" || !source.startsWith(".") || !name) return null;
    const project = readGraph();
    if (!project) return null;
    const selected = project.index.resolvedSourcePathByNode.get(declaration);
    if (!selected || !hasUniqueSourceResolution(filePath, source, selected)) return null;
    const module = project.index.modulesByFilePath.get(selected);
    return module ? { module, exportName: name, source, project } : null;
  };
  return readBalancedPrivateFluentEventRegistrations(callback, consumer, {
    readInlinedEnumKey: (expression) =>
      readSelectedConstEnumPrimitive(expression, consumer, resolveEdge),
    resolvePrivateProvider: (binding) => {
      const edge = resolveEdge(binding);
      if (!edge || !hasUnmodifiedLocalCollections(edge.project.index)) return null;
      const selected = resolveCrossFileValueExportWithFilePath(
        filePath,
        edge.source,
        edge.exportName,
      );
      if (!selected) return null;
      const module = edge.project.index.modulesByFilePath.get(normalizeFilename(selected.filePath));
      const declaration = module?.scopes.rootScope.symbols.find(
        (symbol) =>
          symbol.initializer && stripParenExpression(symbol.initializer) === selected.exportedNode,
      );
      if (!module || !declaration) return null;
      const provider = { module, exportName: declaration.name };
      const methods = readPrivateFluentEventProviderMethods(provider);
      if (!methods) return null;
      const packageName = readPackageManifest(edge.project.root)?.name;
      return hasPrivateNamedRuntimeExportRoute({
        index: edge.project.index,
        producer: module,
        publicEntryFilePaths: new Set([edge.project.entry]),
        packageName: typeof packageName === "string" ? packageName : null,
        exportedName: declaration.name,
        hasUniqueRelativeRoute: hasUniqueSourceResolution,
        isSafeReceiverUse: (identifier) => isDiscardedFluentEventReceiverUse(identifier, methods),
      })
        ? provider
        : null;
    },
  });
};
