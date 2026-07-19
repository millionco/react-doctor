import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectModule } from "./build-source-project-index.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findJsxAttribute } from "./find-jsx-attribute.js";
import { findProgramRoot } from "./find-program-root.js";
import { getImportBindingForName } from "./find-import-source-for-name.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { normalizeFilename } from "./normalize-filename.js";
import {
  resolveCrossFileFunctionExportWithFilePath,
  type ResolvedCrossFileFunctionExport,
} from "./resolve-cross-file-function-export.js";
import { resolveRemotionApi } from "./resolve-remotion-api.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface CompositionAttributeFunctionCache {
  readonly failedFilenames: Set<string>;
  functionKeys?: ReadonlySet<string>;
}

const compositionAttributeFunctionCacheBySettings = new WeakMap<
  object,
  Map<string, CompositionAttributeFunctionCache>
>();

const getFunctionExportKeys = (
  filePath: string,
  programNode: EsTreeNodeOfType<"Program">,
  functionNode: EsTreeNode,
): ReadonlyArray<string> =>
  getFunctionExportNames(programNode, functionNode).map(
    (exportedName) => `${normalizeFilename(filePath)}\0${exportedName}`,
  );

const resolveImportedCompositionFunction = (
  expression: EsTreeNode,
  module: SourceProjectModule,
): ResolvedCrossFileFunctionExport | null => {
  const unwrappedExpression = stripParenExpression(expression);
  let importReference: EsTreeNodeOfType<"Identifier">;
  let exportedName: string | null;

  if (isNodeOfType(unwrappedExpression, "Identifier")) {
    const symbol = module.scopes.symbolFor(unwrappedExpression);
    if (symbol?.kind !== "import") return null;
    importReference = unwrappedExpression;
    exportedName = getImportBindingForName(unwrappedExpression, symbol.name)?.exportedName ?? null;
  } else if (
    isNodeOfType(unwrappedExpression, "MemberExpression") &&
    isNodeOfType(stripParenExpression(unwrappedExpression.object), "Identifier")
  ) {
    const namespaceObject = stripParenExpression(unwrappedExpression.object);
    if (!isNodeOfType(namespaceObject, "Identifier")) return null;
    const symbol = module.scopes.symbolFor(namespaceObject);
    if (symbol?.kind !== "import") return null;
    const importBinding = getImportBindingForName(namespaceObject, symbol.name);
    if (!importBinding?.isNamespace) return null;
    importReference = namespaceObject;
    exportedName = getStaticPropertyKeyName(unwrappedExpression, { allowComputedString: true });
  } else {
    return null;
  }

  if (!exportedName) return null;
  const importBinding = getImportBindingForName(importReference, importReference.name);
  if (!importBinding) return null;
  return resolveCrossFileFunctionExportWithFilePath(
    module.filePath,
    importBinding.source,
    exportedName,
  );
};

const collectCompositionAttributeFunctionKeys = (
  context: RuleContext,
  currentProgram: EsTreeNodeOfType<"Program">,
  attributeName: string,
): ReadonlySet<string> | null => {
  const filename = context.filename ? normalizeFilename(context.filename) : "";
  const rootDirectorySetting = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const rootDirectory = rootDirectorySetting
    ? normalizeFilename(rootDirectorySetting).replace(/\/$/, "")
    : "";
  if (
    !filename ||
    !rootDirectory ||
    (filename !== rootDirectory && !filename.startsWith(`${rootDirectory}/`))
  ) {
    return null;
  }

  const projectIndex = buildSourceProjectIndex(
    rootDirectory,
    filename,
    currentProgram,
    context.scopes,
  );
  if (!projectIndex) return null;

  const functionKeys = new Set<string>();
  for (const module of projectIndex.modulesByFilePath.values()) {
    walkAst(module.programNode, (candidate) => {
      if (!isNodeOfType(candidate, "JSXOpeningElement")) return;
      const apiBinding = resolveRemotionApi(candidate.name, module.scopes);
      if (apiBinding?.apiName !== "Composition" || apiBinding.moduleSource !== "remotion") return;
      const functionAttribute = findJsxAttribute(candidate.attributes, attributeName);
      if (
        !functionAttribute?.value ||
        !isNodeOfType(functionAttribute.value, "JSXExpressionContainer") ||
        !functionAttribute.value.expression
      ) {
        return;
      }
      const resolvedFunction = resolveImportedCompositionFunction(
        functionAttribute.value.expression,
        module,
      );
      if (!resolvedFunction || !isNodeOfType(resolvedFunction.programNode, "Program")) return;
      for (const functionKey of getFunctionExportKeys(
        resolvedFunction.filePath,
        resolvedFunction.programNode,
        resolvedFunction.functionNode,
      )) {
        functionKeys.add(functionKey);
      }
    });
  }
  return functionKeys;
};

const createRemotionCompositionAttributeOwnershipAnalyzer = (
  context: RuleContext,
  attributeName: string,
): ((functionNode: EsTreeNode) => boolean) => {
  const settings = context.settings;
  return (functionNode) => {
    const currentProgram = findProgramRoot(functionNode);
    if (
      !currentProgram ||
      !isNodeOfType(currentProgram, "Program") ||
      !context.filename ||
      !settings
    ) {
      return false;
    }
    const currentFunctionKeys = getFunctionExportKeys(
      context.filename,
      currentProgram,
      functionNode,
    );
    if (currentFunctionKeys.length === 0) return false;
    let cacheByAttributeName = compositionAttributeFunctionCacheBySettings.get(settings);
    if (!cacheByAttributeName) {
      cacheByAttributeName = new Map();
      compositionAttributeFunctionCacheBySettings.set(settings, cacheByAttributeName);
    }
    let cache = cacheByAttributeName.get(attributeName);
    if (!cache) {
      cache = { failedFilenames: new Set() };
      cacheByAttributeName.set(attributeName, cache);
    }
    let functionKeys = cache.functionKeys;
    if (!functionKeys) {
      const filename = normalizeFilename(context.filename);
      if (cache.failedFilenames.has(filename)) return false;
      const collectedFunctionKeys = collectCompositionAttributeFunctionKeys(
        context,
        currentProgram,
        attributeName,
      );
      if (!collectedFunctionKeys) {
        cache.failedFilenames.add(filename);
        return false;
      }
      functionKeys = collectedFunctionKeys;
      cache.functionKeys = collectedFunctionKeys;
    }
    return currentFunctionKeys.some((functionKey) => functionKeys.has(functionKey));
  };
};

export const createRemotionCompositionOwnershipAnalyzer = (
  context: RuleContext,
): ((functionNode: EsTreeNode) => boolean) =>
  createRemotionCompositionAttributeOwnershipAnalyzer(context, "component");

export const createRemotionMetadataOwnershipAnalyzer = (
  context: RuleContext,
): ((functionNode: EsTreeNode) => boolean) =>
  createRemotionCompositionAttributeOwnershipAnalyzer(context, "calculateMetadata");
