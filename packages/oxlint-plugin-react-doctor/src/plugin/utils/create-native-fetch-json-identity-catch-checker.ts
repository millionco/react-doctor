import * as fs from "node:fs";
import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "./build-source-project-index.js";
import type { SourceProjectIndex, SourceProjectModule } from "./build-source-project-index.js";
import {
  NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT,
  NATIVE_FETCH_IDENTITY_MAX_ARGUMENT_COUNT,
  NATIVE_FETCH_IDENTITY_PRODUCER_STATEMENT_COUNT,
  NATIVE_FETCH_IDENTITY_REFUSED_MEMBER_NAMES,
  NATIVE_FETCH_IDENTITY_REFUSED_GLOBAL_NAMES,
  NATIVE_FETCH_IDENTITY_PROVIDER_NAMES,
  NATIVE_FETCH_IDENTITY_ACTIVE_HTML_PATTERN,
  NATIVE_FETCH_IDENTITY_ERROR_NAMES,
  NATIVE_FETCH_IDENTITY_PASSIVE_OBJECT_METHOD_NAMES,
  NATIVE_FETCH_IDENTITY_REFUSED_MODULE_SOURCES,
  NATIVE_FETCH_IDENTITY_BUILD_CONFIG_FILE_NAMES,
  NATIVE_FETCH_IDENTITY_CRA_COMMANDS,
  NATIVE_FETCH_IDENTITY_REFUSED_MANIFEST_FIELDS,
  NATIVE_FETCH_IDENTITY_PROVIDER_RESOLUTION_PATTERN,
  NATIVE_FETCH_IDENTITY_RESOLUTION_GLOB_PATTERN,
  NATIVE_FETCH_IDENTITY_CRA_MAJOR_VERSION,
  SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
  SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
  SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
} from "./constants.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { recordExistenceProbe } from "./cross-file-probe-recorder.js";
import { getDirectUnreassignedInitializer } from "./get-direct-unreassigned-initializer.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import { getImportedName } from "./get-imported-name.js";
import { getOwnDataObjectProperties } from "./get-own-data-object-properties.js";
import { getRuntimeStaticDependencySource } from "./get-runtime-static-dependency-source.js";
import { getSingleReturnExpression } from "./get-single-return-expression.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getStaticStringExpression } from "./get-static-string-expression.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasOnlyAllowedSymbolReads } from "./has-only-allowed-symbol-reads.js";
import { hasReactDefaultProviderMutation } from "./has-react-default-provider-mutation.js";
import { hasSymbolBindingWrites } from "./has-symbol-binding-writes.js";
import { hasUnconfiguredReactJsxEnvironment } from "./has-unconfigured-react-jsx-environment.js";
import { hasUnindexedRuntimeSource } from "./has-unindexed-runtime-source.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isGlobalBrowserFunctionCall } from "./is-global-browser-function-call.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import {
  isProvenGlobalNamespaceReference,
  isProvenGlobalObjectReference,
} from "./is-proven-global-namespace-reference.js";
import { isProvenUnmodifiedReactApiCall } from "./is-proven-unmodified-react-api-call.js";
import { normalizeFilename } from "./normalize-filename.js";
import { parsePackageVersion } from "./parse-package-version.js";
import {
  findNearestPackageDirectory,
  readPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { resolveReactUseStatePair } from "./resolve-react-use-state-pair.js";
import { resolveWebpackAliasPath } from "./resolve-webpack-alias-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface NativeIdentityCallback {
  readonly parameter: EsTreeNodeOfType<"Identifier">;
  readonly returned: EsTreeNode;
}

export interface NativeFetchJsonIdentityCatchChecker {
  (expression: EsTreeNode): boolean;
}

const getUnaryCallback = (expression: EsTreeNode): NativeIdentityCallback | null => {
  const callback = stripParenExpression(expression);
  if (
    (!isNodeOfType(callback, "ArrowFunctionExpression") &&
      !isNodeOfType(callback, "FunctionExpression")) ||
    callback.async ||
    callback.generator ||
    callback.params.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT
  )
    return null;
  const parameter = callback.params[0];
  const returned = getSingleReturnExpression(callback);
  return isNodeOfType(parameter, "Identifier") && returned
    ? { parameter, returned: stripParenExpression(returned) }
    : null;
};

const hasOnlyReference = (
  parameter: EsTreeNodeOfType<"Identifier">,
  reference: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = scopes.symbolFor(parameter);
  return Boolean(
    symbol &&
    isNodeOfType(reference, "Identifier") &&
    scopes.symbolFor(reference) === symbol &&
    hasOnlyAllowedSymbolReads({
      symbol,
      program: scopes.rootScope.node,
      scopes,
      allowedIdentifiers: new Set([reference]),
    }),
  );
};

const getMethodReceiver = (expression: EsTreeNode, name: string): EsTreeNode | null => {
  const call = stripParenExpression(expression);
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    getStaticPropertyName(call.callee) !== name
  )
    return null;
  return stripParenExpression(call.callee.object);
};

const isDirectInvocation = (expression: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(expression);
  return (
    isNodeOfType(root.parent, "CallExpression") &&
    root.parent.callee === root &&
    !root.parent.optional
  );
};

const isPrimitiveArgument = (expression: EsTreeNode): boolean => {
  const value = stripParenExpression(expression);
  return (
    isNodeOfType(value, "Literal") &&
    (value.value === null ||
      typeof value.value === "string" ||
      typeof value.value === "number" ||
      typeof value.value === "boolean")
  );
};

const hasReadonlyNativeEnvironment = (module: SourceProjectModule): boolean => {
  let supported = !hasReactDefaultProviderMutation("useState", module.scopes);
  for (const symbol of module.scopes.rootScope.symbols) {
    const imported = getImportDeclarationForSymbol(symbol);
    if (
      imported?.source.value !== "react" ||
      getImportedName(symbol.declarationNode) !== "useState"
    )
      continue;
    if (
      isErasedTypeScriptBinding(symbol) ||
      hasSymbolBindingWrites(symbol) ||
      !hasOnlyAllowedSymbolReads({
        symbol,
        program: module.programNode,
        scopes: module.scopes,
        allowedIdentifiers: new Set(
          symbol.references
            .filter((reference) => isDirectInvocation(reference.identifier))
            .map((reference) => reference.identifier),
        ),
      })
    )
      supported = false;
  }
  walkAst(module.programNode, (node) => {
    if (!supported) return false;
    if (isNodeOfType(node, "Identifier") && isNonReferenceIdentifier(node)) return;
    const source = getRuntimeStaticDependencySource(node);
    const dynamicSource = isNodeOfType(node, "ImportExpression")
      ? getStaticStringExpression(node.source)
      : null;
    if (
      (source && NATIVE_FETCH_IDENTITY_REFUSED_MODULE_SOURCES.has(source)) ||
      (dynamicSource && NATIVE_FETCH_IDENTITY_REFUSED_MODULE_SOURCES.has(dynamicSource)) ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "TSImportEqualsDeclaration") ||
      isNodeOfType(node, "TSExportAssignment")
    )
      supported = false;
    for (const name of NATIVE_FETCH_IDENTITY_REFUSED_GLOBAL_NAMES) {
      if (!isProvenGlobalNamespaceReference(node, name, module.scopes)) continue;
      const root = findTransparentExpressionRoot(node);
      if (
        name !== "Function" ||
        !isNodeOfType(root.parent, "BinaryExpression") ||
        root.parent.operator !== "instanceof" ||
        root.parent.right !== root
      )
        supported = false;
    }
    if (isProvenGlobalNamespaceReference(node, "Object", module.scopes)) {
      const root = findTransparentExpressionRoot(node);
      const member = root.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        !NATIVE_FETCH_IDENTITY_PASSIVE_OBJECT_METHOD_NAMES.has(
          getStaticPropertyName(member) ?? "",
        ) ||
        !isDirectInvocation(member)
      )
        supported = false;
    }
    if (isProvenGlobalObjectReference(node, module.scopes)) {
      const root = findTransparentExpressionRoot(node);
      const member = root.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== root ||
        getStaticPropertyName(member) === null
      )
        supported = false;
    }
    for (const name of NATIVE_FETCH_IDENTITY_PROVIDER_NAMES) {
      if (!isProvenGlobalNamespaceReference(node, name, module.scopes)) continue;
      const root = findTransparentExpressionRoot(node);
      if (name === "fetch") {
        if (!isDirectInvocation(root)) supported = false;
        continue;
      }
      const parent = root.parent;
      if (NATIVE_FETCH_IDENTITY_ERROR_NAMES.has(name)) {
        if (
          !isNodeOfType(parent, "NewExpression") ||
          parent.callee !== root ||
          !parent.arguments.every(isPrimitiveArgument)
        )
          supported = false;
      } else if (name === "Promise") {
        if (
          !isNodeOfType(parent, "MemberExpression") ||
          parent.object !== root ||
          !isDirectInvocation(parent) ||
          isMemberMutationTarget(parent) ||
          !getStaticPropertyName(parent)
        )
          supported = false;
      } else supported = false;
    }
    if (!isNodeOfType(node, "MemberExpression")) return;
    const name = getStaticPropertyName(node);
    if (
      (name && NATIVE_FETCH_IDENTITY_REFUSED_MEMBER_NAMES.has(name)) ||
      (isMemberMutationTarget(node) &&
        (name === null ||
          name === "then" ||
          name === "catch" ||
          name === "json" ||
          name === "fetch" ||
          name === "useState"))
    )
      supported = false;
  });
  return supported;
};

const hasReadonlyRecordReferences = (
  symbol: SymbolDescriptor,
  properties: ReadonlyMap<string, EsTreeNode>,
  module: SourceProjectModule,
): boolean =>
  hasOnlyAllowedSymbolReads({
    symbol,
    program: module.programNode,
    scopes: module.scopes,
    allowedIdentifiers: new Set(
      symbol.references
        .filter((reference) => {
          const root = findTransparentExpressionRoot(reference.identifier);
          const member = root.parent;
          if (
            !isNodeOfType(member, "MemberExpression") ||
            member.object !== root ||
            member.computed ||
            member.optional ||
            isMemberMutationTarget(member) ||
            !properties.has(getStaticPropertyName(member) ?? "")
          )
            return false;
          const value = findTransparentExpressionRoot(member);
          const call = value.parent;
          return (
            isNodeOfType(call, "CallExpression") &&
            !call.optional &&
            call.arguments[0] === value &&
            isGlobalBrowserFunctionCall(call, "fetch", module.scopes)
          );
        })
        .map((reference) => reference.identifier),
    ),
  });

const getImportedRecordString = (
  member: EsTreeNodeOfType<"MemberExpression">,
  module: SourceProjectModule,
  index: SourceProjectIndex,
): string | null => {
  const identifier = stripParenExpression(member.object);
  if (!isNodeOfType(identifier, "Identifier") || member.computed || member.optional) return null;
  const importedSymbol = module.scopes.symbolFor(identifier);
  const imported = importedSymbol && getImportDeclarationForSymbol(importedSymbol);
  if (
    !importedSymbol ||
    isErasedTypeScriptBinding(importedSymbol) ||
    !imported ||
    !isNodeOfType(importedSymbol.declarationNode, "ImportDefaultSpecifier") ||
    typeof imported.source.value !== "string"
  )
    return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    module.filePath,
    imported.source.value,
    "default",
    { requireCompleteReexports: true },
  );
  if (!resolved || resolved.contexts?.some((entry) => entry.role !== "definition")) return null;
  const producer = index.modulesByFilePath.get(normalizeFilename(resolved.filePath));
  if (
    !producer ||
    producer.programNode.body.length !== NATIVE_FETCH_IDENTITY_PRODUCER_STATEMENT_COUNT
  )
    return null;
  const [declaration, exported] = producer.programNode.body;
  if (
    !isNodeOfType(declaration, "VariableDeclaration") ||
    declaration.kind !== "const" ||
    declaration.declarations.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT ||
    !isNodeOfType(exported, "ExportDefaultDeclaration")
  )
    return null;
  const declarator = declaration.declarations[0];
  if (
    !declarator ||
    !isNodeOfType(declarator.id, "Identifier") ||
    !declarator.init ||
    stripParenExpression(declarator.init) !== resolved.exportedNode
  )
    return null;
  const recordSymbol = producer.scopes.symbolFor(declarator.id);
  const exportReference = stripParenExpression(exported.declaration);
  const properties = getOwnDataObjectProperties(stripParenExpression(declarator.init));
  if (
    !recordSymbol ||
    !properties ||
    !properties.size ||
    !hasOnlyReference(declarator.id, exportReference, producer.scopes) ||
    [...properties.values()].some((value) => getStaticStringExpression(value) === null)
  )
    return null;
  for (const consumer of index.consumerModulesByFilePath.get(producer.filePath) ?? []) {
    let supported = true;
    walkAst(consumer.programNode, (node) => {
      if (index.resolvedSourcePathByNode.get(node) !== producer.filePath) return;
      if (
        !isNodeOfType(node, "ImportDeclaration") ||
        node.importKind === "type" ||
        node.specifiers.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT
      ) {
        supported = false;
        return;
      }
      const specifier = node.specifiers[0];
      const symbol =
        specifier && isNodeOfType(specifier, "ImportDefaultSpecifier")
          ? consumer.scopes.symbolFor(specifier.local)
          : null;
      if (!symbol || !hasReadonlyRecordReferences(symbol, properties, consumer)) supported = false;
    });
    if (!supported) return null;
  }
  if (!hasReadonlyRecordReferences(importedSymbol, properties, module)) return null;
  const selected = properties.get(getStaticPropertyName(member) ?? "");
  return selected ? getStaticStringExpression(selected) : null;
};

const getPrimitiveUrl = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  index: SourceProjectIndex,
  visited = new Set<SymbolDescriptor>(),
): string | null => {
  const value = stripParenExpression(expression);
  const literal = getStaticStringExpression(value);
  if (literal !== null) return literal;
  if (isNodeOfType(value, "MemberExpression")) return getImportedRecordString(value, module, index);
  if (!isNodeOfType(value, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(value);
  if (!symbol || symbol.kind !== "const" || visited.has(symbol) || hasSymbolBindingWrites(symbol))
    return null;
  visited.add(symbol);
  const initializer = getDirectUnreassignedInitializer(symbol);
  return initializer ? getPrimitiveUrl(initializer, module, index, visited) : null;
};

const hasPrimitiveRequest = (
  request: EsTreeNodeOfType<"CallExpression">,
  module: SourceProjectModule,
  index: SourceProjectIndex,
): boolean => {
  if (
    request.optional ||
    !isGlobalBrowserFunctionCall(request, "fetch", module.scopes) ||
    request.arguments.length < NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT ||
    request.arguments.length > NATIVE_FETCH_IDENTITY_MAX_ARGUMENT_COUNT
  )
    return false;
  const url = request.arguments[0];
  if (!url || getPrimitiveUrl(url, module, index) === null) return false;
  const options = request.arguments[1];
  if (!options) return true;
  const properties = getOwnDataObjectProperties(stripParenExpression(options));
  return Boolean(
    properties &&
    properties.size === NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT &&
    getStaticStringExpression(properties.get("method")) === "GET",
  );
};

export const createNativeFetchJsonIdentityCatchChecker = (
  context: RuleContext,
): NativeFetchJsonIdentityCatchChecker => {
  let index: SourceProjectIndex | null | undefined;
  let module: SourceProjectModule | undefined;
  const getModule = (): SourceProjectModule | null => {
    if (index !== undefined) return module ?? null;
    index = null;
    if (!context.filename || !isNodeOfType(context.scopes.rootScope.node, "Program")) return null;
    const filename = normalizeFilename(path.resolve(context.filename));
    const rootDirectory = findNearestPackageDirectory(filename);
    if (!rootDirectory) return null;
    let configurationDirectory = rootDirectory;
    while (true) {
      const manifest = readPackageManifest(configurationDirectory);
      const scripts = manifest?.scripts;
      if (
        manifest &&
        NATIVE_FETCH_IDENTITY_REFUSED_MANIFEST_FIELDS.some((field) => field in manifest)
      )
        return null;
      if (
        scripts !== undefined &&
        (typeof scripts !== "object" ||
          scripts === null ||
          Array.isArray(scripts) ||
          Object.values(scripts).some(
            (command) =>
              typeof command !== "string" || !NATIVE_FETCH_IDENTITY_CRA_COMMANDS.has(command),
          ))
      )
        return null;
      if (scripts && Object.keys(scripts).length > 0) {
        const declaredReactScripts =
          manifest?.dependencies?.["react-scripts"] ??
          manifest?.devDependencies?.["react-scripts"] ??
          manifest?.peerDependencies?.["react-scripts"] ??
          manifest?.optionalDependencies?.["react-scripts"];
        const version =
          typeof declaredReactScripts === "string"
            ? parsePackageVersion(declaredReactScripts.trim().replace(/^[~^]/u, ""))
            : null;
        if (
          !version ||
          version.isPrerelease ||
          version.major !== NATIVE_FETCH_IDENTITY_CRA_MAJOR_VERSION
        )
          return null;
      }
      if (manifest && "resolutions" in manifest) {
        const resolutions = manifest.resolutions;
        if (
          typeof resolutions !== "object" ||
          resolutions === null ||
          Array.isArray(resolutions) ||
          Object.entries(resolutions).some(
            ([selector, version]) =>
              typeof version !== "string" ||
              NATIVE_FETCH_IDENTITY_PROVIDER_RESOLUTION_PATTERN.test(selector) ||
              NATIVE_FETCH_IDENTITY_RESOLUTION_GLOB_PATTERN.test(selector),
          )
        )
          return null;
      }
      for (const basename of NATIVE_FETCH_IDENTITY_BUILD_CONFIG_FILE_NAMES) {
        const configPath = path.join(configurationDirectory, basename);
        recordExistenceProbe(configPath);
        if (fs.existsSync(configPath)) return null;
      }
      const parentDirectory = path.dirname(configurationDirectory);
      if (parentDirectory === configurationDirectory) break;
      configurationDirectory = parentDirectory;
    }
    index = buildSourceProjectIndex({
      rootDirectory,
      currentFilePath: filename,
      currentProgramNode: context.scopes.rootScope.node,
      currentScopes: context.scopes,
      sourceFileLimits: {
        maxEntryCount: SOURCE_PROJECT_FINGERPRINT_MAX_ENTRY_COUNT,
        maxFileCount: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_COUNT,
        maxFileSizeBytes: SOURCE_PROJECT_FINGERPRINT_MAX_FILE_SIZE_BYTES,
        maxTotalBytes: SOURCE_PROJECT_FINGERPRINT_MAX_TOTAL_BYTES,
      },
    });
    if (!index || index.hasOpaqueMdxConsumerSurface || hasUnindexedRuntimeSource(index))
      return null;
    for (const htmlPath of index.htmlFilePaths) {
      try {
        if (NATIVE_FETCH_IDENTITY_ACTIVE_HTML_PATTERN.test(fs.readFileSync(htmlPath, "utf8")))
          return null;
      } catch {
        return null;
      }
    }
    for (const indexedModule of index.modulesByFilePath.values()) {
      let sourceText: string;
      try {
        sourceText =
          indexedModule.filePath === filename
            ? (context.sourceCode?.getText?.() ?? fs.readFileSync(filename, "utf8"))
            : fs.readFileSync(indexedModule.filePath, "utf8");
      } catch {
        return null;
      }
      if (
        !hasUnconfiguredReactJsxEnvironment({
          filename: indexedModule.filePath,
          program: indexedModule.programNode,
          sourceText,
        }) ||
        resolveWebpackAliasPath(indexedModule.filePath, "react")?.declared ||
        resolveModulePath(indexedModule.filePath, "react") ||
        !hasReadonlyNativeEnvironment(indexedModule)
      )
        return null;
    }
    module = index.modulesByFilePath.get(filename);
    return module ?? null;
  };
  return (expression) => {
    const expressionRoot = findTransparentExpressionRoot(expression);
    if (
      !isNodeOfType(expressionRoot.parent, "ExpressionStatement") ||
      expressionRoot.parent.expression !== expressionRoot
    )
      return false;
    const receiver = getMethodReceiver(expression, "catch");
    if (
      !receiver ||
      !isNodeOfType(expression, "CallExpression") ||
      expression.arguments.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT
    )
      return false;
    const handler = expression.arguments[0];
    const identity = handler && getUnaryCallback(handler);
    if (!identity || !hasOnlyReference(identity.parameter, identity.returned, context.scopes))
      return false;
    const jsonReceiver = getMethodReceiver(receiver, "then");
    if (
      !jsonReceiver ||
      !isNodeOfType(receiver, "CallExpression") ||
      receiver.arguments.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT
    )
      return false;
    const write = receiver.arguments[0];
    const writeCallback = write && getUnaryCallback(write);
    if (
      !writeCallback ||
      !isNodeOfType(writeCallback.returned, "CallExpression") ||
      writeCallback.returned.optional ||
      writeCallback.returned.arguments.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT
    )
      return false;
    const setterCall = writeCallback.returned;
    const setter = stripParenExpression(setterCall.callee);
    const value = setterCall.arguments[0];
    if (
      !isNodeOfType(setter, "Identifier") ||
      !value ||
      !hasOnlyReference(writeCallback.parameter, stripParenExpression(value), context.scopes)
    )
      return false;
    const pair = resolveReactUseStatePair(setter, context.scopes);
    if (
      !pair ||
      context.scopes.symbolFor(setter) !== pair.setterSymbol ||
      hasSymbolBindingWrites(pair.setterSymbol) ||
      !hasCompleteSymbolReferences(
        pair.setterSymbol,
        context.scopes.rootScope.node,
        context.scopes,
      ) ||
      !pair.declarator.init ||
      !isProvenUnmodifiedReactApiCall(pair.declarator.init, "useState", context.scopes)
    )
      return false;
    const request = getMethodReceiver(jsonReceiver, "then");
    if (
      !request ||
      !isNodeOfType(jsonReceiver, "CallExpression") ||
      jsonReceiver.arguments.length !== NATIVE_FETCH_IDENTITY_SINGLE_VALUE_COUNT
    )
      return false;
    const parse = jsonReceiver.arguments[0];
    const parseCallback = parse && getUnaryCallback(parse);
    const response = parseCallback && getMethodReceiver(parseCallback.returned, "json");
    if (
      !parseCallback ||
      !response ||
      !isNodeOfType(parseCallback.returned, "CallExpression") ||
      parseCallback.returned.arguments.length !== 0 ||
      !hasOnlyReference(parseCallback.parameter, response, context.scopes) ||
      !isNodeOfType(request, "CallExpression")
    )
      return false;
    const currentModule = getModule();
    return Boolean(currentModule && index && hasPrimitiveRequest(request, currentModule, index));
  };
};
