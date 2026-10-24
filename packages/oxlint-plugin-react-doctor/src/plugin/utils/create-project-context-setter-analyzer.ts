import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import { collectFunctionReturnStatements } from "./collect-function-return-statements.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getReactDoctorStringSetting } from "./get-react-doctor-setting.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { hasContextSetterViteConfiguration } from "./has-context-setter-vite-configuration.js";
import { hasLexicalReceiverReference } from "./has-lexical-receiver-reference.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { isNonEscapingReactApiReference } from "./is-non-escaping-react-api-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isResultDiscardedCall } from "./is-result-discarded-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { hasStandardReactJsxConfiguration } from "./resolve-tsconfig-alias.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { recordContentProbe } from "./cross-file-probe-recorder.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { normalizeFilename } from "./normalize-filename.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import {
  CONTEXT_SETTER_HTML_FORBIDDEN_PATTERN,
  CONTEXT_SETTER_HTML_SCRIPT_PATTERN,
  CONTEXT_SETTER_HTML_SCRIPT_START_PATTERN,
  CONTEXT_SETTER_PASSIVE_ASSET_PATTERN,
  CONTEXT_SETTER_PUBLIC_MANIFEST_FIELDS,
  CONTEXT_SETTER_REACT_NAMESPACE_CALLS,
  CONTEXT_SETTER_CANONICAL_MODULE_SOURCES,
  CONTEXT_SETTER_REFUSED_GLOBAL_NAMES,
  CONTEXT_SETTER_REFUSED_MEMBER_NAMES,
  CONTEXT_SETTER_REFUSED_MODULE_SOURCES,
  CONTEXT_SETTER_PASSIVE_OBJECT_METHOD_NAMES,
  CONTEXT_SETTER_DECLARED_PACKAGE_VERSION_PATTERN,
} from "../constants/context-state-setter.js";

interface ContextSetterCandidate {
  readonly symbol: SymbolDescriptor;
  readonly propertyName: string;
  readonly hookCall: EsTreeNodeOfType<"CallExpression">;
}

interface ContextSetterOrigin {
  readonly module: SourceProjectModule;
  readonly value: EsTreeNode;
}

const runtimeReferences = (symbol: SymbolDescriptor): ReadonlyArray<EsTreeNode> =>
  symbol.references
    .map((reference) => reference.identifier)
    .filter((identifier) => {
      if (isTypeScriptTypePosition(identifier) || isNonReferenceIdentifier(identifier))
        return false;
      const parent = identifier.parent;
      return !(
        isNodeOfType(parent, "Property") &&
        !parent.computed &&
        parent.key === identifier &&
        parent.value !== identifier
      );
    });

const readonlyBinding = (symbol: SymbolDescriptor, module: SourceProjectModule): boolean =>
  hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) &&
  symbol.references.every(
    (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
  );

const staticPattern = (expression: EsTreeNode): EsTreeNodeOfType<"ObjectPattern"> | null => {
  if (!isNodeOfType(expression, "ObjectPattern")) return null;
  const names = new Set<string>();
  for (const property of expression.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !isNodeOfType(property.value, "Identifier")
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (name === null || name === "__proto__" || names.has(name)) return null;
    names.add(name);
  }
  return expression;
};

const literalProperty = (expression: EsTreeNode, name: string): EsTreeNode | null =>
  getOwnDataObjectProperties(stripParenExpression(expression))?.get(name) ?? null;

export const getProjectContextSetterCandidate = (
  call: EsTreeNode,
  scopes: ScopeAnalysis,
): ContextSetterCandidate | null => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier")
  )
    return null;
  const symbol = scopes.symbolFor(call.callee);
  const declarator = symbol?.declarationNode;
  if (!symbol || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) return null;
  const pattern = staticPattern(declarator.id);
  const hookCall = stripParenExpression(declarator.init);
  if (
    !pattern ||
    !isNodeOfType(hookCall, "CallExpression") ||
    hookCall.optional ||
    hookCall.arguments.length !== 0
  )
    return null;
  const property = pattern.properties.find(
    (candidate) =>
      isNodeOfType(candidate, "Property") && candidate.value === symbol.bindingIdentifier,
  );
  if (!property || !isNodeOfType(property, "Property")) return null;
  const propertyName = getStaticPropertyKeyName(property);
  return propertyName === null ? null : { symbol, propertyName, hookCall };
};

export const mayUseProjectContextSetter = (program: EsTreeNode): boolean => {
  let candidate = false;
  walkAst(program, (node) => {
    if (candidate) return false;
    candidate =
      isNodeOfType(node, "VariableDeclarator") &&
      isNodeOfType(node.id, "ObjectPattern") &&
      Boolean(node.init && isNodeOfType(stripParenExpression(node.init), "CallExpression"));
  });
  return candidate;
};

const patternProjectsOwnKeys = (pattern: EsTreeNode, expression: EsTreeNode): boolean => {
  const projection = staticPattern(pattern);
  const ownKeys = getOwnDataObjectProperties(stripParenExpression(expression));
  return Boolean(
    projection &&
    ownKeys &&
    projection.properties.every((property) => {
      const name = getStaticPropertyKeyName(property);
      return name !== null && ownKeys.has(name);
    }),
  );
};

const isRuntimeReactCall = (
  call: EsTreeNode,
  api: string,
  module: SourceProjectModule,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isReactApiCall(call, api, module.scopes) ||
    resolveModulePath(module.filePath, "react") !== null ||
    !isProvenUnmodifiedReactApiCall(call, api, module.scopes) ||
    hasReactDefaultProviderMutation(api, module.scopes)
  )
    return false;
  const callee = stripParenExpression(call.callee);
  const receiver = isNodeOfType(callee, "MemberExpression")
    ? stripParenExpression(callee.object)
    : callee;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = module.scopes.symbolFor(receiver);
  const declaration = symbol && getImportDeclarationForSymbol(symbol);
  if (
    !symbol ||
    !declaration ||
    declaration.importKind === "type" ||
    declaration.source.value !== "react" ||
    !readonlyBinding(symbol, module)
  )
    return false;
  const specifier = symbol.declarationNode;
  if (isNodeOfType(callee, "Identifier"))
    return (
      isNodeOfType(specifier, "ImportSpecifier") &&
      specifier.importKind !== "type" &&
      getImportedName(specifier) === api
    );
  return (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    !callee.optional &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === api &&
    (isNodeOfType(specifier, "ImportDefaultSpecifier") ||
      isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
      getImportedName(specifier) === "default")
  );
};

const contextKey = (origin: ContextSetterOrigin): string | null => {
  const value = stripParenExpression(origin.value);
  if (
    !isNodeOfType(value, "CallExpression") ||
    !isRuntimeReactCall(value, "createContext", origin.module) ||
    value.arguments.length !== 1 ||
    !isNodeOfType(value.arguments[0], "Literal") ||
    value.arguments[0].value !== null
  )
    return null;
  const declaration = value.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return null;
  const symbol = origin.module.scopes.symbolFor(declaration.id);
  return symbol?.kind === "const" && readonlyBinding(symbol, origin.module)
    ? `${origin.module.filePath}\0${declaration.range[0]}`
    : null;
};

const hasCanonicalConfiguration = (filename: string, rootDirectory: string): boolean =>
  hasStandardReactJsxConfiguration(filename, {
    requireUnaliasedReact: true,
    allowSourceDirectoryAlias: true,
    sourceDirectoryAliasRoot: rootDirectory,
  }) &&
  CONTEXT_SETTER_CANONICAL_MODULE_SOURCES.every(
    (source) =>
      !resolveWebpackAliasPath(filename, source)?.declared && !resolveModulePath(filename, source),
  );

const hasStandardModuleSource = (module: SourceProjectModule, context: RuleContext): boolean => {
  try {
    const sourceText =
      module.programNode === context.scopes.rootScope.node
        ? context.sourceCode?.getText?.()
        : (recordContentProbe(module.filePath), fs.readFileSync(module.filePath, "utf8"));
    return (
      sourceText !== undefined &&
      !hasJsxRuntimePragma({
        program: module.programNode,
        filename: module.filePath,
        sourceText,
      })
    );
  } catch {
    return false;
  }
};

const hasPassiveObjectUse = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  const member = root.parent;
  const call = member && findTransparentExpressionRoot(member).parent;
  return Boolean(
    isNodeOfType(member, "MemberExpression") &&
    member.object === root &&
    !member.computed &&
    !member.optional &&
    CONTEXT_SETTER_PASSIVE_OBJECT_METHOD_NAMES.has(getStaticPropertyKeyName(member) ?? "") &&
    isNodeOfType(call, "CallExpression") &&
    !call.optional &&
    call.callee === findTransparentExpressionRoot(member) &&
    call.arguments.length > 0 &&
    call.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement")),
  );
};

const isNativeRootDocumentLookup = (node: EsTreeNode, module: SourceProjectModule): boolean => {
  const member = findTransparentExpressionRoot(node).parent;
  const lookup = member && findTransparentExpressionRoot(member).parent;
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    getStaticPropertyKeyName(member) !== "getElementById" ||
    !isNodeOfType(lookup, "CallExpression") ||
    lookup.optional ||
    lookup.callee !== findTransparentExpressionRoot(member) ||
    lookup.arguments.length !== 1 ||
    !isNodeOfType(lookup.arguments[0], "Literal") ||
    typeof lookup.arguments[0].value !== "string"
  )
    return false;
  const root = findTransparentExpressionRoot(lookup);
  const factory = root.parent;
  if (
    !isNodeOfType(factory, "CallExpression") ||
    factory.optional ||
    factory.arguments.length !== 1 ||
    factory.arguments[0] !== root
  )
    return false;
  const callee = stripParenExpression(factory.callee);
  const receiver = isNodeOfType(callee, "Identifier")
    ? callee
    : isNodeOfType(callee, "MemberExpression") &&
        !callee.computed &&
        !callee.optional &&
        getStaticPropertyKeyName(callee) === "createRoot"
      ? callee.object
      : null;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = module.scopes.symbolFor(receiver);
  const imported = symbol && getImportDeclarationForSymbol(symbol);
  return Boolean(
    symbol &&
    imported &&
    ["react-dom", "react-dom/client"].includes(String(imported.source.value)) &&
    readonlyBinding(symbol, module) &&
    (isNodeOfType(callee, "MemberExpression") ||
      getImportedName(symbol.declarationNode) === "createRoot"),
  );
};

const hasReadonlyExternalProviders = (module: SourceProjectModule): boolean => {
  for (const statement of module.programNode.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    if (
      statement.source.value !== "react-dom/client" &&
      statement.source.value !== "react-dom" &&
      statement.source.value !== "@mui/material" &&
      statement.source.value !== "@mui/material/styles"
    )
      continue;
    for (const specifier of statement.specifiers) {
      const symbol = module.scopes.symbolFor(specifier.local);
      if (!symbol || !readonlyBinding(symbol, module)) return false;
      if (
        statement.importKind === "type" ||
        (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
      ) {
        if (runtimeReferences(symbol).length > 0) return false;
        continue;
      }
      if (
        statement.source.value === "@mui/material" ||
        statement.source.value === "@mui/material/styles"
      ) {
        if (
          isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
          isNodeOfType(specifier, "ImportDefaultSpecifier")
        )
          return false;
        if (getImportedName(specifier) !== "ThemeProvider") continue;
        if (!runtimeReferences(symbol).every((reference) => isJsxNameReference(reference)))
          return false;
      } else if (
        !runtimeReferences(symbol).every((reference) => {
          const receiver = findTransparentExpressionRoot(reference);
          const member = receiver.parent;
          const direct =
            isNodeOfType(specifier, "ImportSpecifier") &&
            getImportedName(specifier) === "createRoot";
          const callee = direct ? receiver : member;
          if (!callee) return false;
          const invocation = findTransparentExpressionRoot(callee).parent;
          return Boolean(
            (direct ||
              (isNodeOfType(member, "MemberExpression") &&
                member.object === receiver &&
                !member.computed &&
                !member.optional &&
                getStaticPropertyKeyName(member) === "createRoot")) &&
            isNodeOfType(invocation, "CallExpression") &&
            !invocation.optional &&
            invocation.callee === findTransparentExpressionRoot(callee),
          );
        })
      )
        return false;
    }
  }
  return true;
};

const isJsxNameReference = (reference: EsTreeNode): boolean => {
  const parent = reference.parent;
  return (
    isNodeOfType(reference, "JSXIdentifier") &&
    (isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) &&
    parent.name === reference &&
    (!isNodeOfType(parent, "JSXOpeningElement") ||
      parent.attributes.every(
        (attribute) =>
          !isNodeOfType(attribute, "JSXSpreadAttribute") &&
          (!isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.name, "JSXIdentifier") ||
            attribute.name.name !== "ref"),
      ))
  );
};

const rootedProductionIndex = (
  index: SourceProjectIndex,
  rootDirectory: string,
  context: RuleContext,
): SourceProjectIndex | null => {
  if (index.htmlFilePaths.length === 0) return null;
  const pending: string[] = [];
  try {
    for (const filename of index.htmlFilePaths) {
      recordContentProbe(filename);
      const contents = fs.readFileSync(filename, "utf8");
      if (CONTEXT_SETTER_HTML_FORBIDDEN_PATTERN.test(contents)) return null;
      const scripts = [...contents.matchAll(CONTEXT_SETTER_HTML_SCRIPT_PATTERN)];
      if (
        scripts.length !== [...contents.matchAll(CONTEXT_SETTER_HTML_SCRIPT_START_PATTERN)].length
      )
        return null;
      for (const script of scripts) {
        const source = script.groups?.typeFirstSource ?? script.groups?.sourceFirstSource;
        if (!source || /[?#\\]|^(?:[a-z]+:|\/\/)/i.test(source)) return null;
        const target = normalizeFilename(
          source.startsWith("/")
            ? path.join(rootDirectory, source.slice(1))
            : path.resolve(path.dirname(filename), source),
        );
        if (!index.modulesByFilePath.has(target)) return null;
        pending.push(target);
      }
    }
  } catch {
    return null;
  }
  if (pending.length === 0) return null;
  const reached = new Map<string, SourceProjectModule>();
  while (pending.length > 0) {
    const filename = pending.pop();
    if (!filename || reached.has(filename)) continue;
    const module = index.modulesByFilePath.get(filename);
    if (
      !module ||
      findNearestPackageDirectory(filename) !== rootDirectory ||
      !hasCanonicalConfiguration(filename, rootDirectory) ||
      !hasStandardModuleSource(module, context) ||
      !hasReadonlyExternalProviders(module)
    )
      return null;
    reached.set(filename, module);
    let closed = true;
    walkAst(module.programNode, (node) => {
      if (!closed || isTypeScriptTypePosition(node)) return false;
      if (
        node.type === "WithStatement" ||
        node.type === "MetaProperty" ||
        node.type === "TSImportEqualsDeclaration" ||
        node.type === "TSExportAssignment"
      )
        closed = false;
      for (const name of CONTEXT_SETTER_REFUSED_GLOBAL_NAMES) {
        if (isProvenGlobalNamespaceReference(node, name, module.scopes)) closed = false;
        if (
          isNodeOfType(node, "Identifier") &&
          node.name === name &&
          !isNonReferenceIdentifier(node) &&
          module.scopes.referenceFor(node)
        ) {
          const binding = module.scopes.symbolFor(node);
          if (binding && isErasedTypeScriptBinding(binding) && !hasRuntimeValueBinding(binding))
            closed = false;
        }
      }
      if (
        isProvenGlobalNamespaceReference(node, "document", module.scopes) &&
        !isNativeRootDocumentLookup(node, module)
      )
        closed = false;
      if (
        isNodeOfType(node, "CallExpression") &&
        node.arguments[0] &&
        (isNodeOfType(node.arguments[0], "Literal") ||
          isNodeOfType(node.arguments[0], "TemplateLiteral")) &&
        ["setTimeout", "setInterval"].some((name) =>
          isProvenGlobalNamespaceReference(node.callee, name, module.scopes),
        )
      )
        closed = false;
      if (
        isProvenGlobalNamespaceReference(node, "Object", module.scopes) &&
        !isNonReferenceIdentifier(node) &&
        !hasPassiveObjectUse(node)
      )
        closed = false;
      if (isNodeOfType(node, "MemberExpression")) {
        const name = getResolvedStaticPropertyName(node, module.scopes);
        if (
          node.computed &&
          name === null &&
          isProvenGlobalObjectReference(node.object, module.scopes)
        )
          closed = false;
        if (name && (CONTEXT_SETTER_REFUSED_MEMBER_NAMES.has(name) || name === "props"))
          closed = false;
        if (name === "type") {
          const parent = findTransparentExpressionRoot(node).parent;
          if (
            isNodeOfType(parent, "CallExpression") ||
            isNodeOfType(parent, "NewExpression") ||
            isNodeOfType(parent, "TaggedTemplateExpression") ||
            isNodeOfType(parent, "VariableDeclarator") ||
            isNodeOfType(parent, "AssignmentExpression") ||
            isWithinAssignmentTarget(node)
          )
            closed = false;
        }
        if (name === "Provider" && isWithinAssignmentTarget(node)) closed = false;
      }
      if (
        isNodeOfType(node, "ObjectPattern") &&
        node.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            ["props", "type"].includes(getStaticPropertyKeyName(property) ?? ""),
        )
      )
        closed = false;
      if (isNodeOfType(node, "ImportDeclaration") && node.source.value === "react") {
        for (const specifier of node.specifiers) {
          const symbol = module.scopes.symbolFor(specifier.local);
          if (!symbol || !readonlyBinding(symbol, module)) {
            closed = false;
            break;
          }
          const references = runtimeReferences(symbol);
          if (
            node.importKind === "type" ||
            (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type")
          ) {
            if (references.length > 0) closed = false;
            continue;
          }
          const importedName = getImportedName(specifier);
          if (
            isNodeOfType(specifier, "ImportDefaultSpecifier") ||
            isNodeOfType(specifier, "ImportNamespaceSpecifier") ||
            importedName === "default"
          ) {
            if (
              !references.every((reference) => {
                const receiver = findTransparentExpressionRoot(reference);
                const member = receiver.parent;
                const invocation = member && findTransparentExpressionRoot(member).parent;
                return (
                  isNodeOfType(member, "MemberExpression") &&
                  member.object === receiver &&
                  !member.computed &&
                  !member.optional &&
                  CONTEXT_SETTER_REACT_NAMESPACE_CALLS.has(
                    getStaticPropertyKeyName(member) ?? "",
                  ) &&
                  isNonEscapingReactApiReference(member) &&
                  !isWithinAssignmentTarget(member) &&
                  isNodeOfType(invocation, "CallExpression") &&
                  !invocation.optional &&
                  invocation.callee === findTransparentExpressionRoot(member)
                );
              })
            )
              closed = false;
          } else if (
            importedName &&
            ["cloneElement", "createElement", "Children"].includes(importedName)
          ) {
            if (references.length > 0) closed = false;
          }
        }
      }
      if (
        (isNodeOfType(node, "ExportNamedDeclaration") ||
          isNodeOfType(node, "ExportAllDeclaration")) &&
        node.exportKind !== "type" &&
        node.source?.value === "react"
      )
        closed = false;
      const staticSource = getRuntimeStaticDependencySource(node);
      const source =
        staticSource ??
        (isNodeOfType(node, "ImportExpression") &&
        isNodeOfType(node.source, "Literal") &&
        typeof node.source.value === "string"
          ? node.source.value
          : null);
      if (
        isNodeOfType(node, "ImportExpression") &&
        (!source || CONTEXT_SETTER_CANONICAL_MODULE_SOURCES.includes(source))
      )
        closed = false;
      if (!source) return;
      if (CONTEXT_SETTER_CANONICAL_MODULE_SOURCES.includes(source)) {
        const packageName = source.startsWith("react-dom")
          ? "react-dom"
          : source.startsWith("@mui/material")
            ? "@mui/material"
            : "react";
        const manifest = readPackageManifest(rootDirectory);
        const sections = manifest && [
          manifest.dependencies,
          manifest.devDependencies,
          manifest.peerDependencies,
        ];
        if (
          !sections ||
          !sections.some(
            (section) =>
              section &&
              Object.hasOwn(section, packageName) &&
              typeof section[packageName] === "string" &&
              CONTEXT_SETTER_DECLARED_PACKAGE_VERSION_PATTERN.test(section[packageName]),
          )
        )
          closed = false;
      }
      if (CONTEXT_SETTER_REFUSED_MODULE_SOURCES.has(source)) {
        closed = false;
        return;
      }
      const target = index.resolvedSourcePathByNode.get(node);
      if (target && index.modulesByFilePath.has(target)) pending.push(target);
      else if (target && CONTEXT_SETTER_PASSIVE_ASSET_PATTERN.test(target)) return;
      else if (
        target ||
        source.startsWith(".") ||
        source.startsWith("/") ||
        source.startsWith("@/") ||
        source.startsWith("#")
      )
        closed = false;
    });
    if (!closed) return null;
  }
  return { ...index, modulesByFilePath: reached };
};

export const createProjectContextSetterAnalyzer = (
  context: RuleContext,
): ((call: EsTreeNode) => boolean) => {
  let index: SourceProjectIndex | null | undefined;
  const filename = context.filename ? normalizeFilename(path.resolve(context.filename)) : "";
  const rootSetting = getReactDoctorStringSetting(context.settings, "rootDirectory");
  const rootDirectory = rootSetting
    ? normalizeFilename(path.resolve(rootSetting)).replace(/\/$/, "")
    : "";

  const projectIndex = (program: EsTreeNode): SourceProjectIndex | null => {
    if (index !== undefined) return index;
    index = null;
    if (
      !filename ||
      !rootDirectory ||
      !filename.startsWith(`${rootDirectory}/`) ||
      findNearestPackageDirectory(filename) !== rootDirectory ||
      !isNodeOfType(program, "Program") ||
      program !== context.scopes.rootScope.node ||
      program.sourceType !== "module"
    )
      return null;
    const manifest = readPackageManifest(rootDirectory);
    if (
      !manifest ||
      manifest.private !== true ||
      CONTEXT_SETTER_PUBLIC_MANIFEST_FIELDS.some((field) => field in manifest) ||
      !hasContextSetterViteConfiguration(rootDirectory)
    )
      return null;
    const built = buildSourceProjectIndex({
      rootDirectory,
      currentFilePath: filename,
      currentProgramNode: program,
      currentScopes: context.scopes,
      sourceFileLimits: {
        maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
        maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
        maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
        maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
      },
    });
    if (!built || built.modulesByFilePath.get(filename)?.programNode !== program) return null;
    index = rootedProductionIndex(built, rootDirectory, context);
    return index;
  };

  const resolveValue = (
    value: EsTreeNode,
    module: SourceProjectModule,
    project: SourceProjectIndex,
    visited = new Set<string>(),
    requireReadonly = true,
  ): ContextSetterOrigin | null => {
    const expression = stripParenExpression(value);
    if (!isNodeOfType(expression, "Identifier") && !isNodeOfType(expression, "JSXIdentifier"))
      return { module, value: expression };
    const symbol = module.scopes.symbolFor(expression);
    if (!symbol || (requireReadonly && !readonlyBinding(symbol, module))) return null;
    const key = `${module.filePath}\0${symbol.bindingIdentifier.range[0]}`;
    if (visited.has(key)) return null;
    visited.add(key);
    if (symbol.kind === "import") {
      const declaration = getImportDeclarationForSymbol(symbol);
      const importedName = isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")
        ? "default"
        : getImportedName(symbol.declarationNode);
      if (
        !declaration ||
        !importedName ||
        typeof declaration.source.value !== "string" ||
        isNodeOfType(symbol.declarationNode, "ImportNamespaceSpecifier") ||
        (requireReadonly &&
          (declaration.importKind === "type" ||
            (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
              symbol.declarationNode.importKind === "type")))
      )
        return null;
      const immediatePath = resolveModulePath(module.filePath, declaration.source.value);
      if (!immediatePath || !project.modulesByFilePath.has(normalizeFilename(immediatePath)))
        return null;
      const resolved = resolveCrossFileValueExportWithFilePath(
        module.filePath,
        declaration.source.value,
        importedName,
        { requireCompleteReexports: true },
      );
      if (
        !resolved ||
        normalizeFilename(resolved.filePath) === filename ||
        resolved.contexts?.some(
          (entry) =>
            normalizeFilename(entry.filePath) === filename ||
            !project.modulesByFilePath.has(normalizeFilename(entry.filePath)),
        )
      )
        return null;
      const target = project.modulesByFilePath.get(normalizeFilename(resolved.filePath));
      if (!target) return null;
      let corresponding: EsTreeNode | null = null;
      walkAst(target.programNode, (node) => {
        if (corresponding) return false;
        if (
          node.type === resolved.exportedNode.type &&
          node.range[0] === resolved.exportedNode.range[0] &&
          node.range[1] === resolved.exportedNode.range[1]
        )
          corresponding = node;
      });
      return corresponding
        ? resolveValue(corresponding, target, project, visited, requireReadonly)
        : null;
    }
    if (isNodeOfType(symbol.declarationNode, "FunctionDeclaration"))
      return { module, value: symbol.declarationNode };
    return symbol.kind === "const" && symbol.initializer
      ? resolveValue(symbol.initializer, module, project, visited, requireReadonly)
      : null;
  };

  const sameOrigin = (first: ContextSetterOrigin, second: ContextSetterOrigin): boolean =>
    first.module.filePath === second.module.filePath && first.value === second.value;

  const isChildSlot = (node: EsTreeNode): boolean => {
    const root = findTransparentExpressionRoot(node);
    const container = root.parent;
    return (
      isNodeOfType(container, "JSXExpressionContainer") &&
      container.expression === root &&
      (isNodeOfType(container.parent, "JSXElement") ||
        isNodeOfType(container.parent, "JSXFragment"))
    );
  };

  const hasPassiveChildrenParameter = (owner: ContextSetterOrigin): boolean => {
    if (!isFunctionLike(owner.value)) return false;
    for (const parameter of owner.value.params) {
      if (isNodeOfType(parameter, "Identifier")) {
        const symbol = owner.module.scopes.symbolFor(parameter);
        if (!symbol || !readonlyBinding(symbol, owner.module)) return false;
        if (
          !runtimeReferences(symbol).every((reference) => {
            const root = findTransparentExpressionRoot(reference);
            const member = root.parent;
            return (
              isNodeOfType(member, "MemberExpression") &&
              member.object === root &&
              !member.computed &&
              !member.optional &&
              !isWithinAssignmentTarget(member) &&
              (getStaticPropertyKeyName(member) !== "children" || isChildSlot(member))
            );
          })
        )
          return false;
      } else if (isNodeOfType(parameter, "ObjectPattern")) {
        if (!staticPattern(parameter)) return false;
        for (const property of parameter.properties) {
          if (
            !isNodeOfType(property, "Property") ||
            getStaticPropertyKeyName(property) !== "children"
          )
            continue;
          const symbol = owner.module.scopes.symbolFor(property.value);
          if (
            !symbol ||
            !readonlyBinding(symbol, owner.module) ||
            !runtimeReferences(symbol).every(isChildSlot)
          )
            return false;
        }
      } else return false;
    }
    return true;
  };

  const isCanonicalRootRender = (element: EsTreeNode, module: SourceProjectModule): boolean => {
    const root = findTransparentExpressionRoot(element);
    const invocation = root.parent;
    if (
      !isNodeOfType(invocation, "CallExpression") ||
      invocation.optional ||
      invocation.arguments.length !== 1 ||
      invocation.arguments[0] !== root ||
      !isNodeOfType(invocation.callee, "MemberExpression") ||
      invocation.callee.computed ||
      invocation.callee.optional ||
      getStaticPropertyKeyName(invocation.callee) !== "render" ||
      !isNodeOfType(invocation.callee.object, "Identifier")
    )
      return false;
    const rootSymbol = module.scopes.symbolFor(invocation.callee.object);
    const declaration = rootSymbol?.declarationNode;
    if (
      !rootSymbol ||
      rootSymbol.kind !== "const" ||
      !readonlyBinding(rootSymbol, module) ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      declaration.id !== rootSymbol.bindingIdentifier ||
      !isNodeOfType(declaration.init, "CallExpression") ||
      declaration.init.optional
    )
      return false;
    const factory = declaration.init.callee;
    const provider = isNodeOfType(factory, "Identifier")
      ? factory
      : isNodeOfType(factory, "MemberExpression") &&
          !factory.computed &&
          !factory.optional &&
          getStaticPropertyKeyName(factory) === "createRoot" &&
          isNodeOfType(factory.object, "Identifier")
        ? factory.object
        : null;
    const providerSymbol = provider && module.scopes.symbolFor(provider);
    const imported = providerSymbol && getImportDeclarationForSymbol(providerSymbol);
    if (
      !providerSymbol ||
      !imported ||
      imported.importKind === "type" ||
      !["react-dom/client", "react-dom"].includes(String(imported.source.value)) ||
      !readonlyBinding(providerSymbol, module)
    )
      return false;
    if (
      isNodeOfType(factory, "Identifier") &&
      (!isNodeOfType(providerSymbol.declarationNode, "ImportSpecifier") ||
        providerSymbol.declarationNode.importKind === "type" ||
        getImportedName(providerSymbol.declarationNode) !== "createRoot")
    )
      return false;
    return runtimeReferences(rootSymbol).every((reference) => {
      const member = reference.parent;
      const call = member && findTransparentExpressionRoot(member).parent;
      return (
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference &&
        !member.computed &&
        !member.optional &&
        getStaticPropertyKeyName(member) === "render" &&
        isNodeOfType(call, "CallExpression") &&
        call.callee === findTransparentExpressionRoot(member) &&
        !call.optional &&
        call.arguments.length === 1 &&
        isNodeOfType(call.arguments[0], "JSXElement")
      );
    });
  };

  const hasDirectOrdinaryReturn = (
    owner: ContextSetterOrigin,
    project: SourceProjectIndex,
    visited = new Set<EsTreeNode>(),
  ): boolean => {
    if (
      visited.has(owner.value) ||
      !isFunctionLike(owner.value) ||
      isNodeOfType(owner.value, "FunctionExpression") ||
      owner.value.async ||
      (isNodeOfType(owner.value, "FunctionDeclaration") && owner.value.generator) ||
      hasLexicalReceiverReference(owner.value, owner.module.scopes) ||
      !isNodeOfType(owner.value.body, "BlockStatement") ||
      !hasPassiveChildrenParameter(owner)
    )
      return false;
    visited.add(owner.value);
    const returns = collectFunctionReturnStatements(owner.value);
    const returned = returns[0]?.argument && stripParenExpression(returns[0].argument);
    if (
      returns.length !== 1 ||
      owner.value.body.body.at(-1) !== returns[0] ||
      !isNodeOfType(returned, "JSXElement")
    )
      return false;
    const name = returned.openingElement.name;
    if (
      isNodeOfType(name, "JSXMemberExpression") &&
      name.property.name === "Provider" &&
      isNodeOfType(name.object, "JSXIdentifier")
    ) {
      const origin = resolveValue(name.object, owner.module, project);
      const key = origin && contextKey(origin);
      return Boolean(key && contextIsClosed(project, key, null));
    }
    if (!isNodeOfType(name, "JSXIdentifier")) return false;
    if (/^[a-z]/.test(name.name)) return true;
    const symbol = owner.module.scopes.symbolFor(name);
    const imported = symbol && getImportDeclarationForSymbol(symbol);
    if (
      symbol &&
      imported &&
      ["@mui/material", "@mui/material/styles"].includes(String(imported.source.value)) &&
      getImportedName(symbol.declarationNode) === "ThemeProvider" &&
      readonlyBinding(symbol, owner.module) &&
      runtimeReferences(symbol).every(isJsxNameReference)
    )
      return true;
    const component = resolveValue(name, owner.module, project);
    return Boolean(component && hasDirectOrdinaryReturn(component, project, visited));
  };

  const provenOwners = new Set<EsTreeNode>();
  const ownerHasClosedJsxConsumers = (
    owner: ContextSetterOrigin,
    project: SourceProjectIndex,
    visiting = new Set<EsTreeNode>(),
  ): boolean => {
    if (visiting.has(owner.value)) return false;
    if (provenOwners.has(owner.value)) return true;
    if (
      !isFunctionLike(owner.value) ||
      isNodeOfType(owner.value, "FunctionExpression") ||
      owner.value.async ||
      (isNodeOfType(owner.value, "FunctionDeclaration") && owner.value.generator) ||
      !isNodeOfType(owner.value.body, "BlockStatement") ||
      hasLexicalReceiverReference(owner.value, owner.module.scopes) ||
      !hasPassiveChildrenParameter(owner) ||
      !hasDirectOrdinaryReturn(owner, project)
    )
      return false;
    const returns = collectFunctionReturnStatements(owner.value);
    if (
      returns.length !== 1 ||
      owner.value.body.body.at(-1) !== returns[0] ||
      !returns[0].argument ||
      !isNodeOfType(stripParenExpression(returns[0].argument), "JSXElement")
    )
      return false;
    const bindings = getFunctionBindingSymbols(owner.value, owner.module.scopes);
    if (bindings.length === 0) return false;
    const definition = bindings[0].declarationNode;
    if (isNodeOfType(definition, "VariableDeclarator")) {
      if (
        bindings[0].kind !== "const" ||
        !isNodeOfType(definition.id, "Identifier") ||
        !isNodeOfType(definition.parent, "VariableDeclaration") ||
        (definition.parent.parent !== owner.module.programNode &&
          !isNodeOfType(definition.parent.parent, "ExportNamedDeclaration"))
      )
        return false;
    } else if (
      !isNodeOfType(definition, "FunctionDeclaration") ||
      (definition.parent !== owner.module.programNode &&
        !isNodeOfType(definition.parent, "ExportDefaultDeclaration") &&
        !isNodeOfType(definition.parent, "ExportNamedDeclaration"))
    )
      return false;
    const exportFiles = new Set([owner.module.filePath]);
    let expanded = true;
    while (expanded) {
      expanded = false;
      for (const module of project.modulesByFilePath.values()) {
        for (const statement of module.programNode.body) {
          if (
            (!isNodeOfType(statement, "ExportNamedDeclaration") &&
              !isNodeOfType(statement, "ExportAllDeclaration")) ||
            statement.exportKind === "type"
          )
            continue;
          const target = project.resolvedSourcePathByNode.get(statement);
          if (target && exportFiles.has(target) && !exportFiles.has(module.filePath)) {
            exportFiles.add(module.filePath);
            expanded = true;
          }
        }
      }
    }
    visiting.add(owner.value);
    const hasOrdinaryOwners = (element: EsTreeNode, module: SourceProjectModule): boolean => {
      let root = findTransparentExpressionRoot(element);
      while (root.parent) {
        const parent = root.parent;
        if (isNodeOfType(parent, "JSXElement")) {
          const name = parent.openingElement.name;
          if (isNodeOfType(name, "JSXIdentifier") && /^[a-z]/.test(name.name)) {
            root = findTransparentExpressionRoot(parent);
            continue;
          }
          if (!isNodeOfType(name, "JSXIdentifier")) return false;
          const symbol = module.scopes.symbolFor(name);
          const imported = symbol && getImportDeclarationForSymbol(symbol);
          if (
            symbol &&
            imported &&
            ["@mui/material", "@mui/material/styles"].includes(String(imported.source.value)) &&
            getImportedName(symbol.declarationNode) === "ThemeProvider" &&
            readonlyBinding(symbol, module) &&
            runtimeReferences(symbol).every(isJsxNameReference)
          ) {
            root = findTransparentExpressionRoot(parent);
            continue;
          }
          const ancestor = resolveValue(name, module, project);
          if (!ancestor || !ownerHasClosedJsxConsumers(ancestor, project, visiting)) return false;
          root = findTransparentExpressionRoot(parent);
          continue;
        }
        if (isNodeOfType(parent, "JSXFragment")) {
          root = findTransparentExpressionRoot(parent);
          continue;
        }
        if (isNodeOfType(parent, "ReturnStatement") && parent.argument === root) {
          const caller = findEnclosingFunction(parent);
          return Boolean(
            caller && ownerHasClosedJsxConsumers({ module, value: caller }, project, visiting),
          );
        }
        return isCanonicalRootRender(root, module);
      }
      return false;
    };
    let found = false;
    let closed = true;
    for (const module of project.modulesByFilePath.values()) {
      const symbols = new Set<SymbolDescriptor>();
      walkAst(module.programNode, (node) => {
        if (!closed || isTypeScriptTypePosition(node)) return false;
        const target = project.resolvedSourcePathByNode.get(node);
        if (
          target &&
          exportFiles.has(target) &&
          ((isNodeOfType(node, "ImportDeclaration") &&
            node.specifiers.some((specifier) =>
              isNodeOfType(specifier, "ImportNamespaceSpecifier"),
            )) ||
            isNodeOfType(node, "ImportExpression") ||
            isNodeOfType(node, "CallExpression") ||
            (isNodeOfType(node, "ExportAllDeclaration") && node.exported))
        ) {
          closed = false;
          return false;
        }
        if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) return;
        const symbol = module.scopes.symbolFor(node);
        if (!symbol || symbols.has(symbol)) return;
        symbols.add(symbol);
        const origin = resolveValue(node, module, project);
        if (!origin || !sameOrigin(origin, owner)) return;
        const allowed = new Set<EsTreeNode>();
        for (const reference of runtimeReferences(symbol)) {
          const parent = reference.parent;
          if (
            (isNodeOfType(parent, "ExportSpecifier") && parent.local === reference) ||
            (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === reference)
          ) {
            allowed.add(reference);
            continue;
          }
          if (!isJsxNameReference(reference)) {
            closed = false;
            break;
          }
          if (isNodeOfType(parent, "JSXOpeningElement")) {
            found = true;
            if (
              !isNodeOfType(parent.parent, "JSXElement") ||
              !hasOrdinaryOwners(parent.parent, module)
            ) {
              closed = false;
              break;
            }
          }
          allowed.add(reference);
        }
        if (
          !hasOnlyAllowedSymbolReads({
            symbol,
            program: module.programNode,
            scopes: module.scopes,
            allowedIdentifiers: allowed,
          })
        )
          closed = false;
      });
      if (!closed) break;
    }
    visiting.delete(owner.value);
    if (closed && found) provenOwners.add(owner.value);
    return closed && found;
  };

  const matchingContext = (
    value: EsTreeNode,
    module: SourceProjectModule,
    project: SourceProjectIndex,
    selectedKey: string,
  ): boolean => {
    const origin = resolveValue(value, module, project, new Set<string>(), false);
    return Boolean(origin && contextKey(origin) === selectedKey);
  };

  const contextIsClosed = (
    project: SourceProjectIndex,
    selectedKey: string,
    selectedProperty: string | null,
  ): boolean => {
    let providers = 0;
    const consumerPatterns: EsTreeNode[] = [];
    for (const module of project.modulesByFilePath.values()) {
      walkAst(module.programNode, (node) => {
        if (
          !isNodeOfType(node, "CallExpression") ||
          node.arguments.length !== 1 ||
          !isRuntimeReactCall(node, "useContext", module) ||
          !matchingContext(node.arguments[0], module, project, selectedKey)
        )
          return;
        const declaration = findTransparentExpressionRoot(node).parent;
        if (isNodeOfType(declaration, "VariableDeclarator")) consumerPatterns.push(declaration.id);
      });
    }
    const originFile = selectedKey.split("\0")[0];
    const contextExportFiles = new Set([originFile]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const module of project.modulesByFilePath.values()) {
        for (const statement of module.programNode.body) {
          if (
            (!isNodeOfType(statement, "ExportNamedDeclaration") &&
              !isNodeOfType(statement, "ExportAllDeclaration")) ||
            statement.exportKind === "type"
          )
            continue;
          const target = project.resolvedSourcePathByNode.get(statement);
          if (
            target &&
            contextExportFiles.has(target) &&
            !contextExportFiles.has(module.filePath)
          ) {
            contextExportFiles.add(module.filePath);
            changed = true;
          }
        }
      }
    }
    for (const module of project.modulesByFilePath.values()) {
      let closed = true;
      const symbols = new Set<SymbolDescriptor>();
      walkAst(module.programNode, (node) => {
        if (!closed || isTypeScriptTypePosition(node)) return false;
        const target = project.resolvedSourcePathByNode.get(node);
        if (
          target &&
          contextExportFiles.has(target) &&
          ((isNodeOfType(node, "ImportDeclaration") &&
            node.specifiers.some((specifier) =>
              isNodeOfType(specifier, "ImportNamespaceSpecifier"),
            )) ||
            isNodeOfType(node, "ImportExpression") ||
            isNodeOfType(node, "CallExpression") ||
            (isNodeOfType(node, "ExportAllDeclaration") && node.exported))
        ) {
          closed = false;
          return false;
        }
        if (!isNodeOfType(node, "Identifier") && !isNodeOfType(node, "JSXIdentifier")) return;
        const symbol = module.scopes.symbolFor(node);
        if (!symbol || symbols.has(symbol)) return;
        symbols.add(symbol);
        if (!matchingContext(node, module, project, selectedKey)) return;
        const importedDeclaration = getImportDeclarationForSymbol(symbol);
        if (
          !readonlyBinding(symbol, module) ||
          (importedDeclaration &&
            (importedDeclaration.importKind === "type" ||
              (isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
                symbol.declarationNode.importKind === "type")) &&
            runtimeReferences(symbol).length > 0)
        ) {
          closed = false;
          return false;
        }
        for (const reference of runtimeReferences(symbol)) {
          const parent = reference.parent;
          if (
            (isNodeOfType(parent, "ExportSpecifier") && parent.local === reference) ||
            (isNodeOfType(parent, "ExportDefaultDeclaration") && parent.declaration === reference)
          )
            continue;
          if (
            isNodeOfType(parent, "CallExpression") &&
            parent.arguments[0] === reference &&
            parent.arguments.length === 1 &&
            isRuntimeReactCall(parent, "useContext", module)
          ) {
            const root = findTransparentExpressionRoot(parent);
            const declaration = root.parent;
            if (
              !isNodeOfType(declaration, "VariableDeclarator") ||
              declaration.init !== root ||
              !staticPattern(declaration.id)
            ) {
              closed = false;
              break;
            }
            continue;
          }
          if (
            !isNodeOfType(parent, "JSXMemberExpression") ||
            parent.object !== reference ||
            parent.property.name !== "Provider"
          ) {
            closed = false;
            break;
          }
          const element = parent.parent;
          if (isNodeOfType(element, "JSXClosingElement") && element.name === parent) continue;
          if (
            !isNodeOfType(element, "JSXOpeningElement") ||
            element.name !== parent ||
            element.attributes.some(
              (attribute) =>
                isNodeOfType(attribute, "JSXSpreadAttribute") ||
                (isNodeOfType(attribute, "JSXAttribute") &&
                  isNodeOfType(attribute.name, "JSXIdentifier") &&
                  attribute.name.name === "ref"),
            )
          ) {
            closed = false;
            break;
          }
          const attributes = element.attributes.filter(
            (attribute) =>
              isNodeOfType(attribute, "JSXAttribute") &&
              isNodeOfType(attribute.name, "JSXIdentifier") &&
              attribute.name.name === "value",
          );
          const attribute = attributes[0];
          if (
            attributes.length !== 1 ||
            !isNodeOfType(attribute, "JSXAttribute") ||
            !isNodeOfType(attribute.value, "JSXExpressionContainer")
          ) {
            closed = false;
            break;
          }
          const providerValue = attribute.value.expression;
          const providerElement = element.parent;
          const returnRoot = providerElement && findTransparentExpressionRoot(providerElement);
          const returned = returnRoot?.parent;
          const owner = returned && findEnclosingFunction(returned);
          const returns = owner ? collectFunctionReturnStatements(owner) : [];
          if (
            !isNodeOfType(providerElement, "JSXElement") ||
            !isNodeOfType(returned, "ReturnStatement") ||
            returned.argument !== returnRoot ||
            !isFunctionLike(owner) ||
            !isNodeOfType(owner.body, "BlockStatement") ||
            returns.length !== 1 ||
            returns[0] !== returned ||
            owner.body.body.at(-1) !== returned ||
            (selectedProperty !== null &&
              !ownerHasClosedJsxConsumers({ module, value: owner }, project)) ||
            !getOwnDataObjectProperties(stripParenExpression(providerValue)) ||
            !consumerPatterns.every((pattern) => patternProjectsOwnKeys(pattern, providerValue))
          ) {
            closed = false;
            break;
          }
          if (selectedProperty === null) {
            providers++;
            continue;
          }
          const setter = literalProperty(providerValue, selectedProperty);
          const pair =
            setter && isNodeOfType(setter, "Identifier")
              ? resolveReactUseStatePair(setter, module.scopes)
              : null;
          if (
            !pair ||
            !pair.declarator.init ||
            !isRuntimeReactCall(pair.declarator.init, "useState", module) ||
            !readonlyBinding(pair.setterSymbol, module) ||
            pair.declarator.range[0] >= element.range[0] ||
            findEnclosingFunction(pair.declarator) !== findEnclosingFunction(element)
          ) {
            closed = false;
            break;
          }
          providers++;
        }
      });
      if (!closed) return false;
    }
    return providers === 1;
  };

  return (call) => {
    const candidate = getProjectContextSetterCandidate(call, context.scopes);
    if (!candidate || !isNodeOfType(call, "CallExpression") || !isResultDiscardedCall(call))
      return false;
    const program = findProgramRoot(call);
    if (!program) return false;
    const project = projectIndex(program);
    const consumer = project?.modulesByFilePath.get(filename);
    if (
      !project ||
      !consumer ||
      candidate.symbol.kind !== "const" ||
      !readonlyBinding(candidate.symbol, consumer)
    )
      return false;
    const hook = resolveValue(candidate.hookCall.callee, consumer, project);
    if (
      !hook ||
      !isFunctionLike(hook.value) ||
      hook.value.async ||
      ((isNodeOfType(hook.value, "FunctionDeclaration") ||
        isNodeOfType(hook.value, "FunctionExpression")) &&
        hook.value.generator) ||
      hook.value.params.length !== 0 ||
      hasLexicalReceiverReference(hook.value, hook.module.scopes)
    )
      return false;
    if (
      !isNodeOfType(hook.value.body, "BlockStatement") ||
      hook.value.body.body.some((statement) => {
        if (isNodeOfType(statement, "ReturnStatement")) return false;
        if (!isNodeOfType(statement, "VariableDeclaration") || statement.kind !== "const")
          return true;
        return statement.declarations.some(
          (declaration) =>
            !declaration.init ||
            (!isFunctionLike(stripParenExpression(declaration.init)) &&
              !isRuntimeReactCall(
                stripParenExpression(declaration.init),
                "useContext",
                hook.module,
              )),
        );
      })
    )
      return false;
    const returns = collectFunctionReturnStatements(hook.value);
    if (returns.length !== 1 || hook.value.body.body.at(-1) !== returns[0]) return false;
    const candidatePattern = candidate.symbol.declarationNode;
    if (
      !isNodeOfType(candidatePattern, "VariableDeclarator") ||
      !returns[0].argument ||
      !patternProjectsOwnKeys(candidatePattern.id, returns[0].argument)
    )
      return false;
    const returned =
      returns.length === 1 && returns[0].argument
        ? literalProperty(returns[0].argument, candidate.propertyName)
        : null;
    if (!returned || !isNodeOfType(returned, "Identifier")) return false;
    const forwarded = hook.module.scopes.symbolFor(returned);
    const declaration = forwarded?.declarationNode;
    if (
      !forwarded ||
      !readonlyBinding(forwarded, hook.module) ||
      runtimeReferences(forwarded).length !== 1 ||
      !isNodeOfType(declaration, "VariableDeclarator") ||
      !declaration.init ||
      !staticPattern(declaration.id)
    )
      return false;
    const pattern = staticPattern(declaration.id);
    if (!pattern) return false;
    const property = pattern.properties.find(
      (entry) => isNodeOfType(entry, "Property") && entry.value === forwarded.bindingIdentifier,
    );
    const propertyName =
      property && isNodeOfType(property, "Property") ? getStaticPropertyKeyName(property) : null;
    const read = stripParenExpression(declaration.init);
    if (
      propertyName !== candidate.propertyName ||
      !isNodeOfType(read, "CallExpression") ||
      read.arguments.length !== 1 ||
      !isRuntimeReactCall(read, "useContext", hook.module)
    )
      return false;
    const origin = resolveValue(read.arguments[0], hook.module, project);
    const selectedKey = origin ? contextKey(origin) : null;
    return Boolean(selectedKey && contextIsClosed(project, selectedKey, propertyName));
  };
};
