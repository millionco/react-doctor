import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getImportedName } from "./get-imported-name.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isTypeOnlyImport } from "./is-type-only-import.js";
import { walkAst } from "./walk-ast.js";

interface IncomingDefaultCallsInput {
  readonly index: SourceProjectIndex;
  readonly definingModule: SourceProjectModule;
  readonly functionNode: EsTreeNodeOfType<"FunctionDeclaration">;
  readonly parameterIndex: number;
}

interface IncomingDefaultCall {
  readonly filename: string;
  readonly line: number | null;
  readonly argumentCount: number;
}

interface IncomingDefaultCalls {
  readonly calls: readonly IncomingDefaultCall[];
  readonly carrierNames: ReadonlyMap<string, ReadonlySet<string>>;
}

type RuntimeImport = EsTreeNodeOfType<"ImportDeclaration">;
type RuntimeExport = EsTreeNodeOfType<"ExportAllDeclaration" | "ExportNamedDeclaration">;
type SourceTargetNames = (node: RuntimeImport | RuntimeExport) => ReadonlySet<string> | undefined;

const getImportedBindings = (
  module: SourceProjectModule,
  getTargetNames: SourceTargetNames,
  ownerBindings: readonly SymbolDescriptor[],
): Set<SymbolDescriptor> | null => {
  const bindings = new Set(ownerBindings);
  for (const declaration of module.programNode.body) {
    if (!isNodeOfType(declaration, "ImportDeclaration") || isTypeOnlyImport(declaration)) continue;
    const names = getTargetNames(declaration);
    if (!names?.size) continue;
    for (const specifier of declaration.specifiers) {
      if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) return null;
      if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") continue;
      const name = getImportedName(specifier);
      if (!name || !names.has(name)) continue;
      const binding = module.scopes.symbolFor(specifier.local);
      if (!binding) return null;
      bindings.add(binding);
    }
  }
  return bindings;
};

const addCarrierNames = (
  module: SourceProjectModule,
  bindings: ReadonlySet<SymbolDescriptor>,
  getTargetNames: SourceTargetNames,
  acceptedForwardingNodes: WeakSet<EsTreeNode>,
  track: (name: string) => void,
): boolean => {
  for (const statement of module.programNode.body) {
    if (isNodeOfType(statement, "ExportAllDeclaration") && statement.exportKind !== "type") {
      const names = getTargetNames(statement);
      if (!names?.size) continue;
      if (statement.exported) return false;
      for (const name of names) track(name);
    }
    if (!isNodeOfType(statement, "ExportNamedDeclaration") || statement.exportKind === "type")
      continue;
    const sourceNames = getTargetNames(statement);
    for (const specifier of statement.specifiers) {
      if (!isNodeOfType(specifier, "ExportSpecifier") || specifier.exportKind === "type") continue;
      const name = getModuleSpecifierName(specifier.local);
      const local = !statement.source ? module.scopes.symbolFor(specifier.local) : null;
      if (!(name && sourceNames?.has(name)) && !(local && bindings.has(local))) continue;
      const exported = getModuleSpecifierName(specifier.exported);
      if (!exported || exported === "default") return false;
      acceptedForwardingNodes.add(specifier.local);
      acceptedForwardingNodes.add(specifier.exported);
      track(exported);
    }
  }
  return true;
};

const hasOpaqueLoaderOrEvaluation = (node: EsTreeNode, module: SourceProjectModule): boolean =>
  isNodeOfType(node, "ImportExpression") ||
  isNodeOfType(node, "WithStatement") ||
  (isNodeOfType(node, "Identifier") &&
    (node.name === "eval" || node.name === "require") &&
    module.scopes.isGlobalReference(node));

export const readViteIncomingDefaultCalls = ({
  index,
  definingModule,
  functionNode,
  parameterIndex,
}: IncomingDefaultCallsInput): IncomingDefaultCalls | null => {
  if (index.hasOpaqueMdxConsumerSurface || index.hasOpaqueRuntimeConsumerSurface) return null;
  const ownerExports = getFunctionExportNames(definingModule.programNode, functionNode);
  if (ownerExports.length === 0 || ownerExports.includes("default")) return null;
  const outer = getFunctionBindingSymbols(functionNode, definingModule.scopes);
  if (outer.length !== 1) return null;
  const local = definingModule.scopes
    .ownScopeFor(functionNode)
    ?.symbols.find((candidate) => candidate.bindingIdentifier === outer[0]?.bindingIdentifier);
  const ownerBindings = local && !outer.includes(local) ? [...outer, local] : outer;
  const carrierNames = new Map([[definingModule.filePath, new Set(ownerExports)]]);
  const getTargetNames: SourceTargetNames = (node) => {
    const filename = index.resolvedSourcePathByNode.get(node);
    return filename === undefined ? undefined : carrierNames.get(filename);
  };
  const matchingForwardReferences = new WeakSet<EsTreeNode>();
  const rootBindingsFor = (module: SourceProjectModule) =>
    module === definingModule ? ownerBindings : [];
  let grew = true;
  while (grew) {
    grew = false;
    for (const module of index.modulesByFilePath.values()) {
      const matching = getImportedBindings(module, getTargetNames, rootBindingsFor(module));
      if (!matching) return null;
      const complete = addCarrierNames(
        module,
        matching,
        getTargetNames,
        matchingForwardReferences,
        (name) => {
          const previous = carrierNames.get(module.filePath) ?? new Set<string>();
          if (previous.has(name)) return;
          previous.add(name);
          carrierNames.set(module.filePath, previous);
          grew = true;
        },
      );
      if (!complete) return null;
    }
  }
  const possibleAutoImports = new Set([...carrierNames.values()].flatMap((names) => [...names]));
  const calls: IncomingDefaultCall[] = [];
  for (const module of index.modulesByFilePath.values()) {
    const matching = getImportedBindings(module, getTargetNames, rootBindingsFor(module));
    if (!matching) return null;
    for (const symbol of matching) {
      if (!hasCompleteSymbolReferences(symbol, module.programNode, module.scopes)) return null;
    }
    let proved = true;
    walkAst(module.programNode, (node) => {
      if (!proved) return false;
      if (hasOpaqueLoaderOrEvaluation(node, module)) {
        proved = false;
        return false;
      }
      if (
        (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) ||
        matchingForwardReferences.has(node)
      )
        return;
      const symbol = module.scopes.symbolFor(node);
      const candidate = symbol
        ? matching.has(symbol) &&
          node !== symbol.bindingIdentifier &&
          module.scopes.referenceFor(node)
        : possibleAutoImports.has(node.name) && module.scopes.isGlobalReference(node);
      if (!candidate) return;
      const reference = findTransparentExpressionRoot(node);
      const call = reference.parent;
      if (
        !isNodeOfType(call, "CallExpression") ||
        call.callee !== reference ||
        call.optional ||
        call.arguments.length > parameterIndex ||
        call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      ) {
        proved = false;
        return false;
      }
      calls.push({
        filename: module.filePath,
        line: node.loc?.start.line ?? null,
        argumentCount: call.arguments.length,
      });
    });
    if (!proved) return null;
  }
  return calls.length > 0 ? { calls, carrierNames } : null;
};
