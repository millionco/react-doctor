import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { NEXT_QUERY_SINGLE_VALUE_COUNT } from "../constants/nextjs.js";
import * as fs from "node:fs";
import * as path from "node:path";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { OIDC_UNSUPPORTED_RUNTIME_TYPES } from "../constants/react.js";
import {
  NEXT_QUERY_SUPPORTED_MAJOR_VERSION,
  NEXT_QUERY_CONFIG_FILE_NAMES,
  NEXT_QUERY_PROVIDER_MEMBERS,
  NEXT_QUERY_OUTSIDE_REFUSED_MEMBERS,
  NEXT_QUERY_ARRAY_METHODS,
  NEXT_QUERY_OBJECT_METHODS,
  NEXT_QUERY_REACT_PROVIDER_SOURCES,
  NEXT_QUERY_UNSUPPORTED_MODULE_SOURCES,
  NEXT_QUERY_ACTIVE_HTML_ELEMENTS,
  NEXT_QUERY_ACTIVE_HTML_ATTRIBUTES,
  NEXT_QUERY_WINDOW_CARRIER_MEMBERS,
  NEXT_QUERY_MAX_WINDOW_ALIAS_COUNT,
  PAGE_FILE_PATTERN,
} from "../constants/nextjs.js";
import { hasCurrentContextRecordEnvironment } from "../rules/state-and-effects/utils/has-current-context-record-environment.js";
import {
  buildSourceProjectIndex,
  type SourceProjectIndex,
  type SourceProjectModule,
} from "./build-source-project-index.js";
import { recordContentProbe, recordExistenceProbe } from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findExportedValue } from "./find-exported-value.js";
import {
  findNativeQueryStateRead,
  type NativeQueryStateRead,
} from "./find-native-query-state-read.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getFunctionBindingSymbols } from "./get-function-binding-symbols.js";
import { getFunctionExportNames } from "./get-function-export-names.js";
import { getJsxAttributeName } from "./get-jsx-attribute-name.js";
import { getModuleSpecifierName } from "./get-module-specifier-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasJsxRuntimePragma } from "./has-jsx-runtime-pragma.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isBindingAssignmentTarget } from "./is-binding-assignment-target.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { isUnmodifiedLocalReactStateCall } from "./is-unmodified-local-react-state-call.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parsePackageVersion } from "./parse-package-version.js";
import { parseSourceFile } from "./parse-source-file.js";
import {
  findNearestPackageDirectory,
  readNearestPackageManifest,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveJsxElementType } from "./resolve-jsx-element-type.js";
import type { RuleContext } from "./rule-context.js";
import {
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface QueryComponentOpening {
  readonly module: SourceProjectModule;
  readonly element: EsTreeNode;
}

const hasRuntimeReactProviderExport = (statement: EsTreeNode): boolean => {
  if (
    !isNodeOfType(statement, "ExportNamedDeclaration") &&
    !isNodeOfType(statement, "ExportAllDeclaration")
  )
    return false;
  const source = getRuntimeStaticDependencySource(statement);
  return source !== null && NEXT_QUERY_REACT_PROVIDER_SOURCES.has(source);
};

const hasRuntimeJsxProviderImport = (statement: EsTreeNode): boolean =>
  isNodeOfType(statement, "ImportDeclaration") &&
  statement.importKind !== "type" &&
  (statement.source.value === "react/jsx-runtime" ||
    statement.source.value === "react/jsx-dev-runtime") &&
  statement.specifiers.some(
    (specifier) => !isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind !== "type",
  );

const isKnownNativeWindowValue = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visited = new Set<SymbolDescriptor>(),
): boolean => {
  const value = stripParenExpression(expression);
  if (isProvenGlobalObjectReference(value, scopes)) return true;
  if (isNodeOfType(value, "MemberExpression"))
    return NEXT_QUERY_WINDOW_CARRIER_MEMBERS.has(
      getResolvedStaticPropertyName(value, scopes) ?? "",
    );
  if (
    isNodeOfType(value, "CallExpression") &&
    isNodeOfType(value.callee, "MemberExpression") &&
    (getStaticPropertyName(value.callee) === "open" ||
      getStaticPropertyName(value.callee) === "valueOf") &&
    isKnownNativeWindowValue(value.callee.object, scopes, visited)
  )
    return true;
  if (!isNodeOfType(value, "Identifier")) return false;
  if (["top", "parent", "frames", "opener"].includes(value.name) && scopes.isGlobalReference(value))
    return true;
  const symbol = scopes.symbolFor(value);
  if (!symbol || symbol.kind !== "const" || !symbol.initializer) return false;
  if (visited.has(symbol) || visited.size >= NEXT_QUERY_MAX_WINDOW_ALIAS_COUNT) return true;
  visited.add(symbol);
  return isKnownNativeWindowValue(symbol.initializer, scopes, visited);
};

const hasEmptyNextConfiguration = (rootDirectory: string): boolean => {
  let found = false;
  for (const name of NEXT_QUERY_CONFIG_FILE_NAMES) {
    const filename = path.join(rootDirectory, name);
    recordExistenceProbe(filename);
    let fileStat: fs.Stats | undefined;
    try {
      fileStat = fs.lstatSync(filename, { throwIfNoEntry: false });
    } catch {
      return false;
    }
    if (!fileStat) continue;
    if (found || !fileStat.isFile()) return false;
    found = true;
    const program = parseSourceFile(filename);
    if (!isNodeOfType(program, "Program")) return false;
    const exported = findExportedValue(program, "default");
    if (!isNodeOfType(exported, "ObjectExpression") || exported.properties.length) return false;
    for (const statement of program.body) {
      if (isNodeOfType(statement, "ImportDeclaration") && statement.importKind === "type") continue;
      if (
        isNodeOfType(statement, "ExportDefaultDeclaration") &&
        (statement.declaration === exported || isNodeOfType(statement.declaration, "Identifier"))
      )
        continue;
      if (
        !isNodeOfType(statement, "VariableDeclaration") ||
        statement.kind !== "const" ||
        statement.declarations.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
        statement.declarations[0].init !== exported
      )
        return false;
    }
  }
  return true;
};

const hasOrdinaryNextPackage = (rootDirectory: string): boolean => {
  const manifest = readPackageManifest(rootDirectory);
  if (
    !manifest ||
    manifest.private !== true ||
    manifest.main !== undefined ||
    manifest.module !== undefined ||
    manifest.exports !== undefined ||
    manifest.workspaces !== undefined ||
    "browser" in manifest ||
    "imports" in manifest ||
    "overrides" in manifest ||
    "resolutions" in manifest ||
    "pnpm" in manifest
  )
    return false;
  const declarations = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  return (
    ["next", "react", "react-dom"].every((name) => {
      let found = false;
      for (const declaration of declarations) {
        const version = declaration?.[name];
        if (version === undefined) continue;
        if (typeof version !== "string") return false;
        const parsed = parsePackageVersion(version.replace(/^[~^]/, ""));
        if (
          !parsed ||
          parsed.isPrerelease ||
          (name === "next" && parsed.major !== NEXT_QUERY_SUPPORTED_MAJOR_VERSION)
        )
          return false;
        found = true;
      }
      return found;
    }) && hasEmptyNextConfiguration(rootDirectory)
  );
};

const hasClosedQueryProviders = (
  module: SourceProjectModule,
  candidate: NativeQueryStateRead,
): boolean => {
  if (
    ["useState", "createElement"].some((name) =>
      hasReactDefaultProviderMutation(name, module.scopes),
    )
  )
    return false;
  for (const statement of module.programNode.body) {
    if (hasRuntimeReactProviderExport(statement)) return false;
    if (hasRuntimeJsxProviderImport(statement)) return false;
  }
  let valid = true;
  walkAst(module.programNode, (node) => {
    if (!valid) return false;
    if (OIDC_UNSUPPORTED_RUNTIME_TYPES.has(node.type) || isNodeOfType(node, "ThisExpression")) {
      valid = false;
      return false;
    }
    if (
      (isNodeOfType(node, "ImportDeclaration") && node.importKind === "type") ||
      (isNodeOfType(node, "ImportSpecifier") && node.importKind === "type") ||
      (isNodeOfType(node, "ExportNamedDeclaration") && node.exportKind === "type") ||
      (isNodeOfType(node, "ExportSpecifier") && node.exportKind === "type")
    )
      return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      (isNodeOfType(node, "JSXOpeningElement") &&
        NEXT_QUERY_ACTIVE_HTML_ELEMENTS.has(resolveJsxElementType(node))) ||
      (isNodeOfType(node, "JSXAttribute") &&
        NEXT_QUERY_ACTIVE_HTML_ATTRIBUTES.has(getJsxAttributeName(node.name) ?? ""))
    ) {
      valid = false;
      return false;
    }
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, module.scopes, {
        allowConstNumericLiteral: true,
        allowConstTemplateLiteral: true,
        stringifyNonStringLiterals: true,
      });
      if (
        NEXT_QUERY_PROVIDER_MEMBERS.has(property ?? "") ||
        (node.computed && property === null && node !== candidate.member)
      ) {
        valid = false;
        return false;
      }
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    const binding = module.scopes.symbolFor(node);
    if (
      binding &&
      module.scopes.referenceFor(node) &&
      isErasedTypeScriptBinding(binding) &&
      !hasRuntimeValueBinding(binding)
    ) {
      valid = false;
      return false;
    }
    if (
      ["JSON", "document", "decodeURIComponent", "URLSearchParams"].includes(node.name) &&
      binding
    ) {
      valid = false;
      return false;
    }
    if (
      isProvenGlobalObjectReference(node, module.scopes) ||
      ["Array", "Object", "Reflect", "Function", "eval", "module", "require"].some((name) =>
        isProvenGlobalNamespaceReference(node, name, module.scopes),
      )
    ) {
      valid = false;
      return false;
    }
    if (module.scopes.isGlobalReference(node)) {
      const root = findTransparentExpressionRoot(node);
      const member = root.parent;
      if (node.name === "undefined") {
        if (isBindingAssignmentTarget(node)) valid = false;
        return;
      }
      if (node.name === "JSON") {
        const call = member && findTransparentExpressionRoot(member).parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          member.optional ||
          !["parse", "stringify"].includes(getStaticPropertyName(member) ?? "") ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.callee !== findTransparentExpressionRoot(member)
        )
          valid = false;
        return;
      }
      if (node.name === "document") {
        const assignment = member && findTransparentExpressionRoot(member).parent;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          member.optional ||
          getStaticPropertyName(member) !== "cookie" ||
          !isNodeOfType(assignment, "AssignmentExpression") ||
          assignment.operator !== "=" ||
          assignment.left !== findTransparentExpressionRoot(member)
        )
          valid = false;
        return;
      }
      if (node.name !== "decodeURIComponent" && node.name !== "URLSearchParams") {
        valid = false;
        return false;
      }
    }
    if (node.name === "decodeURIComponent") {
      const root = findTransparentExpressionRoot(node);
      const call = root.parent;
      if (
        !isProvenGlobalNamespaceReference(node, "decodeURIComponent", module.scopes) ||
        !isNodeOfType(call, "CallExpression") ||
        call.optional ||
        call.callee !== root ||
        call.arguments.length !== NEXT_QUERY_SINGLE_VALUE_COUNT
      )
        valid = false;
      return;
    }
    if (node.name !== "URLSearchParams") return;
    const root = findTransparentExpressionRoot(node);
    if (
      !isProvenGlobalNamespaceReference(node, "URLSearchParams", module.scopes) ||
      module.scopes.symbolFor(node) ||
      root.parent !== candidate.constructor ||
      !isNodeOfType(candidate.constructor, "NewExpression") ||
      candidate.constructor.callee !== root
    )
      valid = false;
  });
  return valid;
};

const hasClosedOwnSourceEdges = (
  index: SourceProjectIndex,
  current: SourceProjectModule,
  rootDirectory: string,
): boolean => {
  let canonicalRoot: string;
  let canonicalCurrent: string;
  try {
    canonicalRoot = normalizeFilename(fs.realpathSync(rootDirectory));
    canonicalCurrent = normalizeFilename(fs.realpathSync(current.filePath));
  } catch {
    return false;
  }
  if (canonicalRoot !== rootDirectory || canonicalCurrent !== current.filePath) return false;
  const pending = new Set<string>();
  const isDeclaredApiBoundary = (filename: string, source: string): boolean => {
    const manifest = readNearestPackageManifest(filename);
    return Boolean(
      manifest &&
      [
        manifest.dependencies,
        manifest.devDependencies,
        manifest.peerDependencies,
        manifest.optionalDependencies,
      ].some(
        (declarations) =>
          declarations &&
          Object.keys(declarations).some(
            (name) => source === name || source.startsWith(`${name}/`),
          ),
      ),
    );
  };
  for (const module of index.modulesByFilePath.values()) {
    for (const statement of module.programNode.body) {
      const source = getRuntimeStaticDependencySource(statement);
      if (!source) continue;
      if (source.startsWith("#") || NEXT_QUERY_UNSUPPORTED_MODULE_SOURCES.has(source)) return false;
      const target = index.resolvedSourcePathByNode.get(statement);
      if (!target) {
        if (source.startsWith(".")) return false;
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(target) || index.modulesByFilePath.has(target)) continue;
      if (target.startsWith(`${rootDirectory}/`)) return false;
      if (!source.startsWith(".")) {
        if (!isDeclaredApiBoundary(module.filePath, source)) return false;
        continue;
      }
      pending.add(target);
    }
  }
  const visited = new Set<string>();
  let totalBytes = 0;
  while (pending.size) {
    const pendingFilename = pending.values().next().value;
    if (!pendingFilename) return false;
    pending.delete(pendingFilename);
    recordExistenceProbe(pendingFilename);
    let filename: string;
    try {
      filename = normalizeFilename(fs.realpathSync(pendingFilename));
    } catch {
      return false;
    }
    if (
      filename !== pendingFilename ||
      filename === canonicalCurrent ||
      (filename.startsWith(`${canonicalRoot}/`) && PAGE_FILE_PATTERN.test(filename))
    )
      return false;
    if (visited.has(filename)) continue;
    visited.add(filename);
    if (visited.size > SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT) return false;
    recordExistenceProbe(filename);
    let fileStat: fs.Stats | undefined;
    try {
      fileStat = fs.lstatSync(filename, { throwIfNoEntry: false });
    } catch {
      return false;
    }
    if (!fileStat?.isFile() || fileStat.size > SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES)
      return false;
    totalBytes += fileStat.size;
    if (totalBytes > SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES) return false;
    const program = parseSourceFile(filename);
    if (!isNodeOfType(program, "Program")) return false;
    const scopes = analyzeScopes(program);
    if (
      ["useState", "createElement"].some((name) => hasReactDefaultProviderMutation(name, scopes)) ||
      program.body.some(hasRuntimeJsxProviderImport)
    )
      return false;
    let hasLoader = false;
    walkAst(program, (node) => {
      if (
        OIDC_UNSUPPORTED_RUNTIME_TYPES.has(node.type) ||
        node.type === "TSExternalModuleReference"
      ) {
        hasLoader = true;
        return false;
      }
      if (isTypeScriptTypePosition(node)) return false;
      if (
        (isNodeOfType(node, "JSXOpeningElement") &&
          NEXT_QUERY_ACTIVE_HTML_ELEMENTS.has(resolveJsxElementType(node))) ||
        (isNodeOfType(node, "JSXAttribute") &&
          NEXT_QUERY_ACTIVE_HTML_ATTRIBUTES.has(getJsxAttributeName(node.name) ?? ""))
      ) {
        hasLoader = true;
        return false;
      }
      if (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern")) {
        const property = getResolvedStaticPropertyName(node, scopes, {
          allowConstNumericLiteral: true,
          allowConstTemplateLiteral: true,
          stringifyNonStringLiterals: true,
        });
        if (
          NEXT_QUERY_OUTSIDE_REFUSED_MEMBERS.has(property ?? "") ||
          (node.computed && property === null)
        ) {
          hasLoader = true;
          return false;
        }
      }
      if (isNodeOfType(node, "MemberExpression")) {
        const property = getStaticPropertyName(node);
        if (
          NEXT_QUERY_OUTSIDE_REFUSED_MEMBERS.has(property ?? "") ||
          (node.computed && isKnownNativeWindowValue(node.object, scopes)) ||
          (node.computed &&
            property === null &&
            (isNodeOfType(node.object, "ArrayExpression") ||
              isNodeOfType(node.object, "ObjectExpression") ||
              isFunctionLike(node.object)))
        ) {
          hasLoader = true;
          return false;
        }
      }
      if (
        isNodeOfType(node, "Identifier") &&
        !isNonReferenceIdentifier(node) &&
        isKnownNativeWindowValue(node, scopes)
      ) {
        const root = findTransparentExpressionRoot(node);
        const parent = root.parent;
        if (
          (isNodeOfType(parent, "CallExpression") &&
            parent.arguments.some((argument) => argument === root)) ||
          isNodeOfType(parent, "ReturnStatement") ||
          isNodeOfType(parent, "ArrayExpression") ||
          (isNodeOfType(parent, "Property") && parent.value === root) ||
          (isNodeOfType(parent, "ArrowFunctionExpression") && parent.body === root) ||
          (isNodeOfType(parent, "VariableDeclarator") &&
            (!isNodeOfType(parent.parent, "VariableDeclaration") || parent.parent.kind !== "const"))
        ) {
          hasLoader = true;
          return false;
        }
      }
      if (
        isNodeOfType(node, "Identifier") &&
        !isNonReferenceIdentifier(node) &&
        (node.name === "Array" || node.name === "Object")
      ) {
        const root = findTransparentExpressionRoot(node);
        const member = root.parent;
        const call = member && findTransparentExpressionRoot(member).parent;
        const methods =
          node.name === "Array" ? NEXT_QUERY_ARRAY_METHODS : NEXT_QUERY_OBJECT_METHODS;
        if (
          !isNodeOfType(member, "MemberExpression") ||
          member.object !== root ||
          member.optional ||
          !methods.has(getStaticPropertyName(member) ?? "") ||
          !isNodeOfType(call, "CallExpression") ||
          call.optional ||
          call.callee !== findTransparentExpressionRoot(member)
        ) {
          hasLoader = true;
          return false;
        }
      }
      if (
        isNodeOfType(node, "ImportExpression") ||
        isNodeOfType(node, "WithStatement") ||
        (isNodeOfType(node, "Identifier") &&
          [
            "require",
            "eval",
            "Function",
            "Reflect",
            "URLSearchParams",
            "globalThis",
            "global",
          ].includes(node.name)) ||
        (isNodeOfType(node, "CallExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          ["require", "eval", "Function"].includes(node.callee.name)) ||
        (isNodeOfType(node, "NewExpression") &&
          isNodeOfType(node.callee, "Identifier") &&
          node.callee.name === "Function")
      )
        hasLoader = true;
    });
    if (hasLoader) return false;
    for (const statement of program.body) {
      if (hasRuntimeReactProviderExport(statement)) return false;
      const source = getRuntimeStaticDependencySource(statement);
      if (!source) continue;
      if (source.startsWith("#") || NEXT_QUERY_UNSUPPORTED_MODULE_SOURCES.has(source)) return false;
      const target = resolveModulePath(filename, source);
      if (!target) {
        if (source.startsWith(".")) return false;
        continue;
      }
      const normalized = normalizeFilename(target);
      if (
        normalized === current.filePath ||
        (PAGE_FILE_PATTERN.test(normalized) && normalized.startsWith(`${rootDirectory}/`))
      )
        return false;
      if (!/\.[cm]?[jt]sx?$/.test(normalized)) continue;
      if (normalized.startsWith(`${rootDirectory}/`) && !index.modulesByFilePath.has(normalized))
        return false;
      if (!source.startsWith(".") && !index.modulesByFilePath.has(normalized)) {
        if (!isDeclaredApiBoundary(filename, source)) return false;
        continue;
      }
      if (!index.modulesByFilePath.has(normalized)) pending.add(normalized);
    }
  }
  return true;
};

const collectComponentOpenings = (
  candidate: NativeQueryStateRead,
  module: SourceProjectModule,
  index: SourceProjectIndex,
): ReadonlyArray<QueryComponentOpening> | null => {
  const names = getFunctionExportNames(module.programNode, candidate.component);
  if (names.length !== NEXT_QUERY_SINGLE_VALUE_COUNT) return null;
  const symbols = getFunctionBindingSymbols(candidate.component, module.scopes);
  if (!symbols.length) return null;
  const openings: QueryComponentOpening[] = [];
  const collect = (symbol: SymbolDescriptor, owner: SourceProjectModule): boolean => {
    if (!hasCompleteSymbolReferences(symbol, owner.programNode, owner.scopes)) return false;
    for (const reference of symbol.references) {
      const identifier = reference.identifier;
      if (isNonReferenceIdentifier(identifier) || identifier === symbol.bindingIdentifier) continue;
      const parent = identifier.parent;
      if (
        reference.flag !== "read" ||
        isBindingAssignmentTarget(identifier) ||
        !(isNodeOfType(parent, "JSXOpeningElement") || isNodeOfType(parent, "JSXClosingElement")) ||
        parent.name !== identifier
      )
        return false;
      if (isNodeOfType(parent, "JSXOpeningElement")) {
        if (!isNodeOfType(parent.parent, "JSXElement")) return false;
        openings.push({ module: owner, element: parent.parent });
      }
    }
    return true;
  };
  if (!symbols.every((symbol) => collect(symbol, module))) return null;
  for (const consumer of index.consumerModulesByFilePath.get(module.filePath) ?? []) {
    for (const statement of consumer.programNode.body) {
      if (index.resolvedSourcePathByNode.get(statement) !== module.filePath) continue;
      if (!isNodeOfType(statement, "ImportDeclaration")) return null;
      for (const specifier of statement.specifiers) {
        if (isNodeOfType(specifier, "ImportNamespaceSpecifier")) return null;
        if (isNodeOfType(specifier, "ImportSpecifier") && specifier.importKind === "type") continue;
        const importedName = isNodeOfType(specifier, "ImportDefaultSpecifier")
          ? "default"
          : isNodeOfType(specifier, "ImportSpecifier")
            ? getModuleSpecifierName(specifier.imported)
            : null;
        if (importedName !== names[0]) continue;
        const symbol = consumer.scopes.symbolFor(specifier.local);
        if (!symbol || !collect(symbol, consumer)) return null;
      }
    }
  }
  return openings.length ? openings : null;
};

const getComponentProps = (
  component: EsTreeNode,
  module: SourceProjectModule,
): ReadonlyMap<string, SymbolDescriptor> | null => {
  if (
    !isFunctionLike(component) ||
    component.params.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(component.params[0], "ObjectPattern")
  )
    return null;
  const result = new Map<string, SymbolDescriptor>();
  for (const property of component.params[0].properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier") ||
      result.has(property.key.name)
    )
      return null;
    const symbol = module.scopes.symbolFor(property.value);
    if (!symbol) return null;
    result.set(property.key.name, symbol);
  }
  return result;
};

const hasPrimitiveRoutePropUse = (
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
): boolean => {
  const references = new Set<EsTreeNode>();
  for (const reference of symbol.references) {
    if (
      reference.identifier === symbol.bindingIdentifier ||
      isNonReferenceIdentifier(reference.identifier)
    )
      continue;
    const root = findTransparentExpressionRoot(reference.identifier);
    const call = root.parent;
    if (
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
      call.arguments[0] !== root ||
      !isNodeOfType(call.callee, "Identifier") ||
      call.callee.name !== "decodeURIComponent" ||
      !isProvenGlobalNamespaceReference(call.callee, "decodeURIComponent", module.scopes)
    )
      return false;
    references.add(reference.identifier);
  }
  return hasOnlyAllowedSymbolReads({
    symbol,
    allowedIdentifiers: references,
    program: module.programNode,
    scopes: module.scopes,
  });
};

const hasPageInputOpening = (
  opening: QueryComponentOpening,
  candidate: NativeQueryStateRead,
  current: SourceProjectModule,
  rootDirectory: string,
  index: SourceProjectIndex,
): boolean => {
  const module = opening.module;
  const filename = module.filePath;
  const relativeFilename = normalizeFilename(path.relative(rootDirectory, filename));
  if (
    !(relativeFilename.startsWith("app/") || relativeFilename.startsWith("src/app/")) ||
    !PAGE_FILE_PATTERN.test(filename) ||
    index.consumerModulesByFilePath.get(filename)?.size
  )
    return false;
  const page = findExportedValue(module.programNode, "default");
  if (
    !isFunctionLike(page) ||
    !page.async ||
    (page.type !== "ArrowFunctionExpression" && page.generator) ||
    page.params.length !== NEXT_QUERY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(page.params[0], "ObjectPattern") ||
    !isNodeOfType(page.body, "BlockStatement") ||
    !isNodeOfType(opening.element, "JSXElement") ||
    opening.element.children.length
  )
    return false;
  const pageInputs = new Map<string, SymbolDescriptor>();
  for (const property of page.params[0].properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      !isNodeOfType(property.value, "Identifier") ||
      pageInputs.has(property.key.name) ||
      (property.key.name !== "params" && property.key.name !== "searchParams")
    )
      return false;
    const symbol = module.scopes.symbolFor(property.value);
    if (!symbol) return false;
    pageInputs.set(property.key.name, symbol);
  }
  const queryInput = pageInputs.get("searchParams");
  if (!queryInput) return false;
  const pageInputSymbols = new Set(pageInputs.values());
  let queryValue: SymbolDescriptor | null = null;
  const routeValues = new Map<SymbolDescriptor, string>();
  const inputReferences = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  let returned = false;
  for (const statement of page.body.body) {
    if (
      isNodeOfType(statement, "ReturnStatement") &&
      statement.argument === opening.element &&
      !returned
    ) {
      returned = true;
      continue;
    }
    if (
      returned ||
      !isNodeOfType(statement, "VariableDeclaration") ||
      statement.kind !== "const" ||
      statement.declarations.length !== NEXT_QUERY_SINGLE_VALUE_COUNT
    )
      return false;
    const declaration = statement.declarations[0];
    if (
      !isNodeOfType(declaration.init, "AwaitExpression") ||
      !isNodeOfType(declaration.init.argument, "Identifier")
    )
      return false;
    const input = module.scopes.symbolFor(declaration.init.argument);
    if (!input || !pageInputSymbols.has(input) || inputReferences.has(input)) return false;
    inputReferences.set(input, new Set([declaration.init.argument]));
    if (input === queryInput) {
      if (queryValue || !isNodeOfType(declaration.id, "Identifier")) return false;
      queryValue = module.scopes.symbolFor(declaration.id);
      if (!queryValue) return false;
      continue;
    }
    if (!isNodeOfType(declaration.id, "ObjectPattern")) return false;
    for (const property of declaration.id.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        property.computed ||
        !isNodeOfType(property.key, "Identifier") ||
        !isNodeOfType(property.value, "Identifier") ||
        !relativeFilename.split("/").includes(`[${property.key.name}]`)
      )
        return false;
      const symbol = module.scopes.symbolFor(property.value);
      if (!symbol) return false;
      routeValues.set(symbol, property.key.name);
    }
  }
  if (
    !returned ||
    !queryValue ||
    [...pageInputs.values()].some(
      (symbol) =>
        !hasOnlyAllowedSymbolReads({
          symbol,
          allowedIdentifiers: inputReferences.get(symbol) ?? new Set(),
          program: module.programNode,
          scopes: module.scopes,
        }),
    )
  )
    return false;
  const props = getComponentProps(candidate.component, current);
  if (!props || props.get(candidate.propName) !== candidate.record) return false;
  const attributes = new Map<string, EsTreeNode>();
  for (const attribute of opening.element.openingElement.attributes) {
    if (
      !isNodeOfType(attribute, "JSXAttribute") ||
      !isNodeOfType(attribute.value, "JSXExpressionContainer") ||
      !isNodeOfType(attribute.value.expression, "Identifier")
    )
      return false;
    const name = getJsxAttributeName(attribute.name);
    if (!name || attributes.has(name) || !props.has(name)) return false;
    attributes.set(name, attribute.value.expression);
  }
  if (attributes.size !== props.size) return false;
  const valueReferences = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  for (const [name, expression] of attributes) {
    const symbol = module.scopes.symbolFor(expression);
    if (!symbol || (name === candidate.propName ? symbol !== queryValue : !routeValues.has(symbol)))
      return false;
    const references = valueReferences.get(symbol) ?? new Set();
    references.add(expression);
    valueReferences.set(symbol, references);
    const prop = props.get(name);
    if (!prop || (name !== candidate.propName && !hasPrimitiveRoutePropUse(prop, current)))
      return false;
  }
  if (
    ![queryValue, ...routeValues.keys()].every((symbol) =>
      hasOnlyAllowedSymbolReads({
        symbol,
        allowedIdentifiers: valueReferences.get(symbol) ?? new Set(),
        program: module.programNode,
        scopes: module.scopes,
      }),
    )
  )
    return false;
  return getFunctionBindingSymbols(page, module.scopes).every((symbol) =>
    hasOnlyAllowedSymbolReads({
      symbol,
      allowedIdentifiers: new Set(),
      program: module.programNode,
      scopes: module.scopes,
    }),
  );
};

export const isNextQueryStateCall = (call: EsTreeNode, context: RuleContext): boolean => {
  const candidate = findNativeQueryStateRead(call, context.scopes);
  if (
    !candidate ||
    !context.filename ||
    !isUnmodifiedLocalReactStateCall(call, context.scopes, {
      allowedComputedDataMember: candidate.member,
    })
  )
    return false;
  const filename = normalizeFilename(path.resolve(context.filename));
  const rootDirectory = findNearestPackageDirectory(filename);
  const program = context.scopes.rootScope.node;
  if (
    !rootDirectory ||
    !isNodeOfType(program, "Program") ||
    !hasOrdinaryNextPackage(rootDirectory) ||
    !hasCurrentContextRecordEnvironment(filename) ||
    resolveModulePath(filename, "next")
  )
    return false;
  const directive = program.body[0];
  if (
    !isNodeOfType(directive, "ExpressionStatement") ||
    !isNodeOfType(directive.expression, "Literal") ||
    directive.expression.value !== "use client"
  )
    return false;
  const index = buildSourceProjectIndex({
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
  const current = index?.modulesByFilePath.get(filename);
  if (
    !index ||
    !current ||
    index.hasOpaqueMdxConsumerSurface ||
    index.htmlFilePaths.length ||
    !hasClosedOwnSourceEdges(index, current, rootDirectory)
  )
    return false;
  for (const module of index.modulesByFilePath.values()) {
    if (
      !hasClosedQueryProviders(module, candidate) ||
      !hasCurrentContextRecordEnvironment(module.filePath)
    )
      return false;
    recordContentProbe(module.filePath);
    let sourceText: string;
    try {
      sourceText =
        module === current
          ? (context.sourceCode?.getText?.() ?? fs.readFileSync(module.filePath, "utf8"))
          : fs.readFileSync(module.filePath, "utf8");
    } catch {
      return false;
    }
    if (hasJsxRuntimePragma({ program: module.programNode, filename: module.filePath, sourceText }))
      return false;
  }
  const openings = collectComponentOpenings(candidate, current, index);
  return Boolean(
    openings &&
    openings.every((opening) =>
      hasPageInputOpening(opening, candidate, current, rootDirectory, index),
    ),
  );
};
