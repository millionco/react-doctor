import * as fs from "node:fs";
import * as path from "node:path";
import type { SymbolDescriptor } from "../semantic/scope-analysis.js";
import {
  NATIVE_LABEL_ATTRIBUTE_NAME,
  NATIVE_LABEL_CANONICAL_MODULE_SOURCES,
  NATIVE_LABEL_CONFIG_FILE_PATTERN,
  NATIVE_LABEL_CONTEXT_READ_APIS,
  NATIVE_LABEL_CONTEXT_SHORTHAND_MINIMUM_MAJOR_VERSION,
  NATIVE_LABEL_FORBIDDEN_PROP_NAMES,
  NATIVE_LABEL_REFUSED_GLOBAL_NAMES,
  NATIVE_LABEL_REFUSED_MODULE_SOURCES,
  NATIVE_LABEL_RESOLVER_NAMES,
  NATIVE_LABEL_SINGLE_VALUE_COUNT,
  NATIVE_LABEL_NODE_LOADER_MEMBER_NAMES,
  NATIVE_LABEL_RUNTIME_CAPABILITY_NAMES,
  NATIVE_LABEL_METRO_CONFIG_PATTERN,
  NATIVE_LABEL_METRO_MODULE_SOURCES,
  NATIVE_LABEL_PLATFORM_SUFFIX_PATTERN,
} from "../constants/react-native.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getImportedName } from "./get-imported-name.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportDeclaration, getValueImportSource } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasDynamicScopeAccess } from "./has-dynamic-scope-access.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasNativeLabelJsxConfiguration } from "./has-native-label-jsx-configuration.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { jsxAttributeMayHaveNonEmptyValue } from "./jsx-attribute-may-have-non-empty-value.js";
import { SOURCE_PROJECT_FILE_PATTERN } from "./list-production-source-files.js";
import { findNearestPackageDirectory } from "./read-nearest-package-manifest.js";
import { normalizeFilename } from "./normalize-filename.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolvePackageVersion } from "./resolve-package-version.js";
import {
  resolveCrossFileFunctionExportWithFilePath,
  resolveCrossFileValueExportWithFilePath,
} from "./resolve-cross-file-function-export.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface NativeLabelProviderExport {
  readonly filePath: string;
  readonly exportedName: string;
}

const isReadonlyBinding = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean =>
  !isErasedTypeScriptBinding(symbol) &&
  !hasSymbolBindingWrites(symbol) &&
  hasCompleteSymbolReferences(symbol, module.programNode, module.scopes);

const isJsxNameReference = (identifier: EsTreeNode): boolean => {
  const parent = identifier.parent;
  return (
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === identifier
  );
};

const hasReadonlyNativeHost = (module: SourceProjectModule): boolean => {
  for (const symbol of module.scopes.rootScope.symbols) {
    if (getValueImportSource(symbol) !== "react-native") continue;
    if (
      isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
      isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
    ) {
      return false;
    }
    if (getImportedName(symbol.declarationNode) !== "Pressable") continue;
    if (
      !isReadonlyBinding(symbol, module) ||
      !symbol.references.every(
        (reference) =>
          isNonReferenceIdentifier(reference.identifier) ||
          isTypeScriptTypePosition(reference.identifier) ||
          isJsxNameReference(reference.identifier),
      )
    )
      return false;
  }
  return true;
};

const hasUnsupportedProviderCapability = (module: SourceProjectModule): boolean => {
  if (
    hasDynamicScopeAccess(module.scopes) ||
    !hasReadonlyNativeHost(module) ||
    ["createContext", ...NATIVE_LABEL_CONTEXT_READ_APIS].some((name) =>
      hasReactDefaultProviderMutation(name, module.scopes),
    )
  )
    return true;
  let unsupported = false;
  walkAst(module.programNode, (node) => {
    if (unsupported) return false;
    if (
      isNodeOfType(node, "Identifier") &&
      NATIVE_LABEL_RUNTIME_CAPABILITY_NAMES.has(node.name) &&
      module.scopes.referenceFor(node)
    ) {
      const binding = module.scopes.symbolFor(node);
      if (binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding)) {
        unsupported = true;
        return false;
      }
    }
    if (isProvenGlobalNamespaceReference(node, "module", module.scopes)) {
      const member = node.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        getStaticPropertyName(member) !== "exports"
      ) {
        unsupported = true;
        return false;
      }
    }
    if (isProvenGlobalNamespaceReference(node, "process", module.scopes)) {
      const member = node.parent;
      const name = isNodeOfType(member, "MemberExpression")
        ? getResolvedStaticPropertyName(member, module.scopes)
        : null;
      if (!name || NATIVE_LABEL_NODE_LOADER_MEMBER_NAMES.has(name)) {
        unsupported = true;
        return false;
      }
    }
    const source =
      getRuntimeStaticDependencySource(node) ?? getGlobalRequireModuleSource(node, module.scopes);
    const requireInvocation =
      isNodeOfType(node.parent, "CallExpression") && node.parent.callee === node
        ? node.parent
        : null;
    const requiredSource = requireInvocation
      ? getGlobalRequireModuleSource(requireInvocation, module.scopes)
      : null;
    if (
      (source !== null && NATIVE_LABEL_REFUSED_MODULE_SOURCES.has(source)) ||
      [...NATIVE_LABEL_REFUSED_GLOBAL_NAMES].some((name) =>
        isProvenGlobalNamespaceReference(node, name, module.scopes),
      ) ||
      (isProvenGlobalNamespaceReference(node, "require", module.scopes) &&
        (!requireInvocation ||
          requiredSource === null ||
          NATIVE_LABEL_CANONICAL_MODULE_SOURCES.has(requiredSource)))
    ) {
      unsupported = true;
      return false;
    }
    if (source && NATIVE_LABEL_CANONICAL_MODULE_SOURCES.has(source)) {
      if (isNodeOfType(node, "ExportAllDeclaration")) unsupported = true;
      if (isNodeOfType(node, "ExportNamedDeclaration")) {
        unsupported ||= node.specifiers.some(
          (specifier) =>
            isNodeOfType(specifier, "ExportSpecifier") &&
            specifier.exportKind !== "type" &&
            (getModuleSpecifierName(specifier.local) === "default" ||
              getModuleSpecifierName(specifier.local) === "Pressable" ||
              getModuleSpecifierName(specifier.local) === "createContext"),
        );
      }
      if (unsupported) return false;
    }
    if (isNodeOfType(node, "ImportExpression")) {
      const importedSource =
        isNodeOfType(node.source, "Literal") && typeof node.source.value === "string"
          ? node.source.value
          : null;
      if (
        !importedSource ||
        NATIVE_LABEL_CANONICAL_MODULE_SOURCES.has(importedSource) ||
        NATIVE_LABEL_REFUSED_MODULE_SOURCES.has(importedSource)
      ) {
        unsupported = true;
        return false;
      }
    }
    if (
      isNodeOfType(node, "MemberExpression") &&
      getResolvedStaticPropertyName(node, module.scopes) === "type"
    ) {
      unsupported = true;
      return false;
    }
    if (
      isNodeOfType(node, "Property") &&
      isNodeOfType(node.parent, "ObjectPattern") &&
      getStaticPropertyKeyName(node, { allowComputedString: true }) === "type"
    ) {
      unsupported = true;
      return false;
    }
    if (!NATIVE_LABEL_CONFIG_FILE_PATTERN.test(module.filePath)) return;
    if (
      NATIVE_LABEL_METRO_CONFIG_PATTERN.test(module.filePath) &&
      source &&
      !NATIVE_LABEL_METRO_MODULE_SOURCES.has(source)
    ) {
      unsupported = true;
      return false;
    }
    const propertyName = isNodeOfType(node, "MemberExpression")
      ? getResolvedStaticPropertyName(node, module.scopes)
      : isNodeOfType(node, "Property")
        ? getStaticPropertyKeyName(node, { allowComputedString: true })
        : null;
    if (
      (propertyName && NATIVE_LABEL_RESOLVER_NAMES.has(propertyName)) ||
      ((isNodeOfType(node, "MemberExpression") || isNodeOfType(node, "Property")) &&
        node.computed &&
        !propertyName)
    )
      unsupported = true;
  });
  return unsupported;
};

const getReturnedElement = (functionNode: EsTreeNode): EsTreeNodeOfType<"JSXElement"> | null => {
  if (
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    ("generator" in functionNode && functionNode.generator)
  )
    return null;
  const body = functionNode.body;
  if (!isNodeOfType(body, "BlockStatement")) {
    const value = stripParenExpression(body);
    return isNodeOfType(value, "JSXElement") ? value : null;
  }
  const [returned, ...otherReturns] = collectFunctionReturnStatements(functionNode);
  if (!returned || otherReturns.length || body.body.at(-1) !== returned || !returned.argument)
    return null;
  const value = stripParenExpression(returned.argument);
  return isNodeOfType(value, "JSXElement") ? value : null;
};

const onlyElementChild = (
  element: EsTreeNodeOfType<"JSXElement">,
): EsTreeNodeOfType<"JSXElement"> | null => {
  const children = element.children.filter(
    (child) =>
      !(isNodeOfType(child, "JSXText") && child.value.trim() === "") &&
      !(
        isNodeOfType(child, "JSXExpressionContainer") &&
        isNodeOfType(child.expression, "JSXEmptyExpression")
      ),
  );
  const [child, ...otherChildren] = children;
  return !otherChildren.length && isNodeOfType(child, "JSXElement") ? child : null;
};

const contextUseIsReadonly = (identifier: EsTreeNode, module: SourceProjectModule): boolean => {
  if (isNonReferenceIdentifier(identifier) || isTypeScriptTypePosition(identifier)) return true;
  if (isJsxNameReference(identifier)) return true;
  const parent = identifier.parent;
  if (
    isNodeOfType(parent, "JSXMemberExpression") &&
    parent.object === identifier &&
    parent.property.name === "Provider" &&
    isJsxNameReference(parent)
  )
    return true;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  const [argument, ...otherArguments] = parent.arguments;
  return (
    argument === identifier &&
    !otherArguments.length &&
    !parent.optional &&
    isProvenUnmodifiedReactApiCall(parent, NATIVE_LABEL_CONTEXT_READ_APIS, module.scopes)
  );
};

export const createNativeLabelForwardingChecker = (context: RuleContext) => {
  const filename = context.filename ? normalizeFilename(path.resolve(context.filename)) : "";
  const rootSetting = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const packageDirectory = filename ? findNearestPackageDirectory(filename) : null;
  const rootDirectory = rootSetting
    ? normalizeFilename(path.resolve(rootSetting))
    : packageDirectory
      ? normalizeFilename(packageDirectory)
      : "";
  let project: SourceProjectIndex | null | undefined;
  const configurationByFile = new Map<string, boolean>();
  const providerProofs = new Map<EsTreeNode, boolean>();
  const configured = (module: SourceProjectModule): boolean => {
    const cached = configurationByFile.get(module.filePath);
    if (cached !== undefined) return cached;
    let sourceText: string | undefined;
    try {
      const stem = path.basename(module.filePath, path.extname(module.filePath));
      if (
        fs
          .readdirSync(path.dirname(module.filePath))
          .some(
            (entry) =>
              entry.startsWith(`${stem}.`) &&
              NATIVE_LABEL_PLATFORM_SUFFIX_PATTERN.test(entry.slice(stem.length)),
          )
      )
        return false;
      sourceText =
        module.programNode === context.scopes.rootScope.node
          ? context.sourceCode?.getText?.()
          : fs.readFileSync(module.filePath, "utf8");
    } catch {
      return false;
    }
    let hasExcludedRuntimeSource = false;
    walkAst(module.programNode, (node) => {
      const resolvedPath = project?.resolvedSourcePathByNode.get(node);
      if (
        resolvedPath &&
        SOURCE_PROJECT_FILE_PATTERN.test(resolvedPath) &&
        !project?.modulesByFilePath.has(resolvedPath)
      )
        hasExcludedRuntimeSource = true;
    });
    const result =
      !hasExcludedRuntimeSource &&
      sourceText !== undefined &&
      hasNativeLabelJsxConfiguration(module.filePath, rootDirectory) &&
      !hasJsxRuntimePragma({ program: module.programNode, filename: module.filePath, sourceText });
    configurationByFile.set(module.filePath, result);
    return result;
  };
  const isProviderReference = (
    symbol: SymbolDescriptor,
    module: SourceProjectModule,
    pending: NativeLabelProviderExport[],
    allowContextReads: boolean,
  ): boolean => {
    if (!isReadonlyBinding(symbol, module)) return false;
    return symbol.references.every((reference) => {
      const identifier = reference.identifier;
      const parent = identifier.parent;
      if (isNodeOfType(parent, "ExportSpecifier") && parent.local === identifier) {
        const name = getModuleSpecifierName(parent.exported);
        if (!name || !project) return false;
        pending.push({ filePath: module.filePath, exportedName: name });
        return true;
      }
      return allowContextReads
        ? contextUseIsReadonly(identifier, module)
        : isNonReferenceIdentifier(identifier) ||
            isTypeScriptTypePosition(identifier) ||
            isJsxNameReference(identifier);
    });
  };
  const hasClosedProvider = (
    origin: EsTreeNode,
    ownerModule: SourceProjectModule,
    allowContextReads: boolean,
  ): boolean => {
    const cached = providerProofs.get(origin);
    if (cached !== undefined) return cached;
    providerProofs.set(origin, false);
    if (!project || !configured(ownerModule)) return false;
    let symbols: readonly SymbolDescriptor[];
    if (allowContextReads) {
      if (!isNodeOfType(origin.parent, "VariableDeclarator")) return false;
      const binding = origin.parent.id;
      if (!isNodeOfType(binding, "Identifier")) return false;
      const symbol = ownerModule.scopes.symbolFor(binding);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        !isProvenUnmodifiedReactApiCall(origin, "createContext", ownerModule.scopes)
      )
        return false;
      symbols = [symbol];
    } else {
      symbols = getFunctionBindingSymbols(origin, ownerModule.scopes);
      if (!symbols.length) return false;
    }
    const pending = getFunctionExportNames(ownerModule.programNode, origin).map((exportedName) => ({
      filePath: ownerModule.filePath,
      exportedName,
    }));
    if (
      !symbols.every((symbol) =>
        isProviderReference(symbol, ownerModule, pending, allowContextReads),
      )
    )
      return false;
    const visited = new Set<string>();
    while (pending.length) {
      const item = pending.pop();
      if (!item) continue;
      const key = `${item.filePath}\0${item.exportedName}`;
      if (visited.has(key)) continue;
      visited.add(key);
      for (const module of project.modulesByFilePath.values()) {
        let opaqueLoad = false;
        walkAst(module.programNode, (node) => {
          if (
            (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "ImportExpression")) &&
            project?.resolvedSourcePathByNode.get(node) === item.filePath
          )
            opaqueLoad = true;
        });
        if (opaqueLoad) return false;
        for (const statement of module.programNode.body) {
          const target = project.resolvedSourcePathByNode.get(statement);
          if (target !== item.filePath) continue;
          if (isNodeOfType(statement, "ImportDeclaration")) {
            if (statement.importKind === "type") continue;
            for (const specifier of statement.specifiers) {
              if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) return false;
              if (isNodeOfType(specifier, "ImportDefaultSpecifier")) {
                if (item.exportedName !== "default") continue;
                const imported = module.scopes.symbolFor(specifier.local);
                if (
                  !imported ||
                  !configured(module) ||
                  !isProviderReference(imported, module, pending, allowContextReads)
                )
                  return false;
                continue;
              }
              if (
                !isNodeOfType(specifier, "ImportSpecifier") ||
                specifier.importKind === "type" ||
                getImportedName(specifier) !== item.exportedName
              )
                continue;
              const imported = module.scopes.symbolFor(specifier.local);
              if (
                !imported ||
                !configured(module) ||
                !isProviderReference(imported, module, pending, allowContextReads)
              )
                return false;
            }
          } else if (isNodeOfType(statement, "ExportAllDeclaration")) {
            if (statement.exportKind !== "type") {
              if (statement.exported) return false;
              pending.push({ filePath: module.filePath, exportedName: item.exportedName });
            }
          } else if (isNodeOfType(statement, "ExportNamedDeclaration")) {
            if (statement.exportKind === "type") continue;
            for (const specifier of statement.specifiers) {
              if (
                isNodeOfType(specifier, "ExportSpecifier") &&
                specifier.exportKind !== "type" &&
                getModuleSpecifierName(specifier.local) === item.exportedName
              ) {
                const name = getModuleSpecifierName(specifier.exported);
                if (!name) return false;
                pending.push({ filePath: module.filePath, exportedName: name });
              }
            }
          }
        }
      }
    }
    providerProofs.set(origin, true);
    return true;
  };
  const isTransparentContext = (
    element: EsTreeNodeOfType<"JSXElement">,
    module: SourceProjectModule,
  ): boolean => {
    const opening = element.openingElement;
    const attributes = opening.attributes;
    if (
      attributes.some(
        (attribute) =>
          !isNodeOfType(attribute, "JSXAttribute") ||
          !isNodeOfType(attribute.name, "JSXIdentifier") ||
          attribute.name.name !== "value",
      ) ||
      attributes.length > NATIVE_LABEL_SINGLE_VALUE_COUNT
    )
      return false;
    const name = opening.name;
    if (isNodeOfType(name, "JSXIdentifier")) {
      const reactVersion = resolvePackageVersion(module.filePath, "react")?.version;
      if (
        !reactVersion ||
        reactVersion.isPrerelease ||
        reactVersion.major < NATIVE_LABEL_CONTEXT_SHORTHAND_MINIMUM_MAJOR_VERSION
      )
        return false;
    }
    const identifier =
      isNodeOfType(name, "JSXMemberExpression") && name.property.name === "Provider"
        ? name.object
        : name;
    if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
    const symbol = module.scopes.symbolFor(identifier);
    if (!symbol || !isReadonlyBinding(symbol, module)) return false;
    const imported = getValueImportDeclaration(symbol);
    if (
      !imported ||
      !isNodeOfType(imported, "ImportDeclaration") ||
      !isNodeOfType(symbol.declarationNode, "ImportSpecifier")
    )
      return false;
    const importedName = getImportedName(symbol.declarationNode);
    if (!importedName || typeof imported.source.value !== "string") return false;
    const resolved = resolveCrossFileValueExportWithFilePath(
      module.filePath,
      imported.source.value,
      importedName,
      { requireCompleteReexports: true },
    );
    if (!resolved || !project) return false;
    if (
      !resolved.contexts?.every((entry) => {
        const traced = project?.modulesByFilePath.get(normalizeFilename(entry.filePath));
        return Boolean(traced && configured(traced));
      })
    )
      return false;
    const ownerModule = project.modulesByFilePath.get(normalizeFilename(resolved.filePath));
    return Boolean(
      ownerModule &&
      ownerModule.programNode === resolved.programNode &&
      hasClosedProvider(resolved.exportedNode, ownerModule, true),
    );
  };
  return (opening: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
    const attributes = opening.attributes;
    const labels = attributes.filter(
      (attribute) =>
        isNodeOfType(attribute, "JSXAttribute") &&
        isNodeOfType(attribute.name, "JSXIdentifier") &&
        attribute.name.name === NATIVE_LABEL_ATTRIBUTE_NAME,
    );
    const [label, ...otherLabels] = labels;
    if (
      !filename ||
      !rootDirectory ||
      !filename.startsWith(`${rootDirectory}/`) ||
      !label ||
      !isNodeOfType(label, "JSXAttribute") ||
      otherLabels.length ||
      attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          isNodeOfType(attribute.name, "JSXIdentifier") &&
          (attribute.name.name === "aria-label" || attribute.name.name === "aria-labelledby"),
      ) ||
      !jsxAttributeMayHaveNonEmptyValue(label, { scopes: context.scopes }) ||
      !isNodeOfType(opening.name, "JSXIdentifier")
    )
      return false;
    const program = context.scopes.rootScope.node;
    if (!isNodeOfType(program, "Program") || program.sourceType !== "module") return false;
    if (project === undefined) {
      project = buildSourceProjectIndex({
        rootDirectory,
        currentFilePath: filename,
        currentProgramNode: program,
        currentScopes: context.scopes,
        includeApplicationDirectories: true,
        sourceFileLimits: {
          maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
          maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
          maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
          maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
        },
      });
      if (project) {
        const indexedProject = project;
        if (
          indexedProject.hasOpaqueMdxConsumerSurface ||
          [...indexedProject.modulesByFilePath.values()].some(hasUnsupportedProviderCapability)
        )
          project = null;
      }
    }
    const consumer = project?.modulesByFilePath.get(filename);
    if (!project || !consumer || consumer.programNode !== program || !configured(consumer))
      return false;
    const symbol = resolveConstIdentifierAlias(opening.name, context.scopes);
    const imported = symbol && getValueImportDeclaration(symbol);
    if (
      !symbol ||
      !isReadonlyBinding(symbol, consumer) ||
      !imported ||
      !isNodeOfType(imported, "ImportDeclaration") ||
      !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
      typeof imported.source.value !== "string"
    )
      return false;
    const importedName = getImportedName(symbol.declarationNode);
    if (importedName !== "Button") return false;
    const resolved = resolveCrossFileFunctionExportWithFilePath(
      filename,
      imported.source.value,
      importedName,
      { requireCompleteReexports: true },
    );
    const module = resolved && project.modulesByFilePath.get(normalizeFilename(resolved.filePath));
    if (!resolved || !module || module.programNode !== resolved.programNode || !configured(module))
      return false;
    if (
      !resolved.contexts?.every((entry) => {
        const traced = project?.modulesByFilePath.get(normalizeFilename(entry.filePath));
        return Boolean(traced && configured(traced));
      })
    )
      return false;
    if (!hasClosedProvider(resolved.functionNode, module, false)) return false;
    const functionNode = resolved.functionNode;
    if (!isFunctionLike(functionNode)) return false;
    const [parameter, ...otherParameters] = functionNode.params;
    if (!isNodeOfType(parameter, "ObjectPattern") || otherParameters.length) return false;
    let forwarded: SymbolDescriptor | null = null;
    const propertyNames = new Set<string>();
    for (const property of parameter.properties) {
      if (isNodeOfType(property, "RestElement")) {
        if (forwarded || !isNodeOfType(property.argument, "Identifier")) return false;
        forwarded = module.scopes.symbolFor(property.argument);
        continue;
      }
      if (!isNodeOfType(property, "Property") || property.computed || property.method) return false;
      const name = getStaticPropertyKeyName(property);
      if (!name || propertyNames.has(name) || NATIVE_LABEL_FORBIDDEN_PROP_NAMES.has(name))
        return false;
      propertyNames.add(name);
    }
    if (!forwarded || !isReadonlyBinding(forwarded, module)) return false;
    let element = getReturnedElement(functionNode);
    while (element) {
      const name = element.openingElement.name;
      if (isNodeOfType(name, "JSXIdentifier")) {
        const native = module.scopes.symbolFor(name);
        if (
          native &&
          getValueImportSource(native) === "react-native" &&
          isNodeOfType(native.declarationNode, "ImportSpecifier") &&
          getImportedName(native.declarationNode) === "Pressable"
        )
          break;
      }
      if (!isTransparentContext(element, module)) return false;
      element = onlyElementChild(element);
    }
    if (!element) return false;
    let spread: EsTreeNode | null = null;
    for (const attribute of element.openingElement.attributes) {
      if (isNodeOfType(attribute, "JSXSpreadAttribute")) {
        if (spread || module.scopes.symbolFor(attribute.argument) !== forwarded) return false;
        spread = attribute;
      } else if (
        !isNodeOfType(attribute, "JSXAttribute") ||
        !isNodeOfType(attribute.name, "JSXIdentifier") ||
        NATIVE_LABEL_FORBIDDEN_PROP_NAMES.has(attribute.name.name)
      )
        return false;
    }
    if (!spread) return false;
    return forwarded.references.every((reference) => {
      const identifier = reference.identifier;
      if (isNonReferenceIdentifier(identifier) || isTypeScriptTypePosition(identifier)) return true;
      if (identifier.parent === spread) return true;
      const member = identifier.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== identifier ||
        member.optional ||
        member.computed ||
        isMemberMutationTarget(member)
      )
        return false;
      const name = getStaticPropertyName(member);
      const parent = member.parent;
      return Boolean(
        name &&
        !NATIVE_LABEL_FORBIDDEN_PROP_NAMES.has(name) &&
        !(isNodeOfType(parent, "CallExpression") && parent.callee === member) &&
        !(isNodeOfType(parent, "TaggedTemplateExpression") && parent.tag === member),
      );
    });
  };
};
