import { captureCrossFileProbes, replayCrossFileProbes } from "./cross-file-probe-recorder.js";
import type { CapturedCrossFileProbes } from "./cross-file-probe-recorder.js";
import { getManifestCacheGeneration } from "./read-nearest-package-manifest.js";
import { findVisibleSymbol } from "./find-visible-symbol.js";
import { getImportDeclarationForSymbol } from "./get-import-declaration-for-symbol.js";
import {
  OIDC_CLIENT_MODULE_SOURCE,
  OIDC_GET_USER_ARGUMENT_COUNT,
  OIDC_CONSTRUCTOR_ARGUMENT_COUNT,
  OIDC_WINDOW_DECODER_ARGUMENT_COUNT,
  OIDC_CONSTRUCTOR_ARGUMENT_INDEX,
  OIDC_STORE_OPTION_PROPERTY_COUNT,
  OIDC_INSTANCE_METHOD_NAMES,
  OIDC_UNSUPPORTED_CAPABILITY_NAMES,
  OIDC_UNSUPPORTED_MEMBER_NAMES,
  OIDC_UNSUPPORTED_RUNTIME_TYPES,
} from "../constants/react.js";
import { analyzeScopes } from "../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { findProgramRoot } from "./find-program-root.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportDeclaration } from "./get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "./has-static-property-write-before.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import { resolveCrossFileValueExportWithFilePath } from "./resolve-cross-file-function-export.js";
import { resolveImportedApiReference } from "./resolve-imported-api-reference.js";
import { resolveModulePath } from "./resolve-module-path.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface OidcProgramFacts {
  readonly readonlyBindings: Map<SymbolDescriptor, boolean>;
  readonly instanceCalls: Map<SymbolDescriptor, boolean>;
  readonly managerOrigins: Map<SymbolDescriptor, Map<string, CapturedCrossFileProbes<boolean>>>;
  managerOriginGeneration: number;
  visibleCapabilities?: boolean;
}

const programFactsByScopes = new WeakMap<ScopeAnalysis, WeakMap<EsTreeNode, OidcProgramFacts>>();
const providerScopesByProgram = new WeakMap<EsTreeNode, ScopeAnalysis>();

const getProgramFacts = (program: EsTreeNode, scopes: ScopeAnalysis): OidcProgramFacts => {
  let factsByProgram = programFactsByScopes.get(scopes);
  if (!factsByProgram) {
    factsByProgram = new WeakMap();
    programFactsByScopes.set(scopes, factsByProgram);
  }
  let facts = factsByProgram.get(program);
  if (!facts) {
    facts = {
      readonlyBindings: new Map(),
      instanceCalls: new Map(),
      managerOrigins: new Map(),
      managerOriginGeneration: getManifestCacheGeneration(),
    };
    factsByProgram.set(program, facts);
  }
  return facts;
};

const isReadonlyCompleteBinding = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const facts = getProgramFacts(program, scopes);
  const cached = facts.readonlyBindings.get(symbol);
  if (cached !== undefined) return cached;
  const readonly =
    hasCompleteSymbolReferences(symbol, program, scopes) &&
    symbol.references.every(
      (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
    );
  facts.readonlyBindings.set(symbol, readonly);
  return readonly;
};

const hasSupportedVisibleCapabilities = (program: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const facts = getProgramFacts(program, scopes);
  if (facts.visibleCapabilities !== undefined) return facts.visibleCapabilities;
  let supported = true;
  walkAst(program, (node) => {
    if (!supported) return false;
    if (
      OIDC_UNSUPPORTED_RUNTIME_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (isNodeOfType(node, "MemberExpression")) {
      const propertyName = getStaticPropertyName(node);
      const numericRead =
        isNodeOfType(node.property, "Literal") &&
        typeof node.property.value === "number" &&
        !isWithinAssignmentTarget(node);
      if (OIDC_UNSUPPORTED_MEMBER_NAMES.has(propertyName ?? "") || (node.computed && !numericRead))
        supported = false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (OIDC_UNSUPPORTED_CAPABILITY_NAMES.has(node.name)) supported = false;
    if (["window", "JSON", "Promise", "process"].includes(node.name)) {
      if (!scopes.isGlobalReference(node) || isWithinAssignmentTarget(node)) supported = false;
      const member = findTransparentExpressionRoot(node).parent;
      if (
        node.name === "window" &&
        isNodeOfType(member, "MemberExpression") &&
        !["localStorage", "sessionStorage", "atob"].includes(getStaticPropertyName(member) ?? "")
      )
        supported = false;
      if (
        node.name === "window" &&
        isNodeOfType(member, "MemberExpression") &&
        getStaticPropertyName(member) === "atob"
      ) {
        const callee = findTransparentExpressionRoot(member);
        const call = callee.parent;
        if (
          member.optional ||
          !isNodeOfType(call, "CallExpression") ||
          call.callee !== callee ||
          call.optional ||
          call.arguments.length !== OIDC_WINDOW_DECODER_ARGUMENT_COUNT ||
          call.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
        )
          supported = false;
      }
      if (
        node.name === "process" &&
        (!isNodeOfType(member, "MemberExpression") ||
          member.optional ||
          getStaticPropertyName(member) !== "env")
      )
        supported = false;
      if (
        node.name === "window" &&
        isNodeOfType(member, "MemberExpression") &&
        ["localStorage", "sessionStorage"].includes(getStaticPropertyName(member) ?? "")
      ) {
        const property = member.parent;
        const options = property?.parent;
        const store = options?.parent;
        if (
          !isNodeOfType(property, "Property") ||
          property.value !== member ||
          !isNodeOfType(options, "ObjectExpression") ||
          !isNodeOfType(store, "NewExpression") ||
          store.arguments[OIDC_CONSTRUCTOR_ARGUMENT_INDEX] !== options ||
          !isNativeStorageStore(store, program, scopes)
        )
          supported = false;
      }
      if (!isNodeOfType(member, "MemberExpression") || member.object !== node || member.computed) {
        if (
          !(
            node.name === "Promise" &&
            isNodeOfType(member, "NewExpression") &&
            member.callee === node
          )
        )
          supported = false;
      }
    }
  });
  facts.visibleCapabilities = supported;
  return supported;
};

const hasInstanceCallReferences = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const facts = getProgramFacts(program, scopes);
  const cached = facts.instanceCalls.get(symbol);
  if (cached !== undefined) return cached;
  const supported =
    isReadonlyCompleteBinding(symbol, program, scopes) &&
    !hasPossibleStaticPropertyMutationOrEscape(symbol.bindingIdentifier, "getUser", scopes) &&
    symbol.references.every((reference) => {
      if (isTypeScriptTypePosition(reference.identifier)) return true;
      const receiver = findTransparentExpressionRoot(reference.identifier);
      const member = receiver.parent;
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.object !== receiver ||
        member.computed ||
        member.optional ||
        !OIDC_INSTANCE_METHOD_NAMES.has(getStaticPropertyName(member) ?? "")
      )
        return false;
      const callee = findTransparentExpressionRoot(member);
      const call = callee.parent;
      return (
        isNodeOfType(call, "CallExpression") &&
        call.callee === callee &&
        !call.optional &&
        call.arguments.length === OIDC_GET_USER_ARGUMENT_COUNT
      );
    });
  facts.instanceCalls.set(symbol, supported);
  return supported;
};

const isDirectSdkConstructor = (
  expression: EsTreeNode,
  exportedName: string,
  selectedConstructor: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const identifier = stripParenExpression(expression);
  if (!isNodeOfType(identifier, "Identifier")) return false;
  const symbol = scopes.symbolFor(identifier);
  const declaration = symbol ? getValueImportDeclaration(symbol) : null;
  if (
    !symbol ||
    !declaration ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    !isReadonlyCompleteBinding(symbol, program, scopes)
  )
    return false;
  const imported = resolveImportedApiReference(identifier, scopes);
  if (imported?.source !== OIDC_CLIENT_MODULE_SOURCE || imported.importedName !== exportedName)
    return false;
  return symbol.references.every((reference) => {
    if (isTypeScriptTypePosition(reference.identifier)) return true;
    const callee = findTransparentExpressionRoot(reference.identifier);
    const construct = callee.parent;
    return (
      construct === selectedConstructor &&
      isNodeOfType(construct, "NewExpression") &&
      construct.callee === callee &&
      construct.arguments.length === OIDC_CONSTRUCTOR_ARGUMENT_COUNT
    );
  });
};

const getOwnDataProperty = (expression: EsTreeNode, selectedName: string): EsTreeNode | null => {
  const object = stripParenExpression(expression);
  if (!isNodeOfType(object, "ObjectExpression")) return null;
  const names = new Set<string>();
  let selected: EsTreeNode | null = null;
  for (const property of object.properties) {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.method)
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || name === "__proto__" || names.has(name)) return null;
    names.add(name);
    if (name === selectedName) selected = property.value;
  }
  return selected;
};

const isNativeStorageStore = (
  expression: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const store = stripParenExpression(expression);
  if (
    !isNodeOfType(store, "NewExpression") ||
    store.arguments.length !== OIDC_CONSTRUCTOR_ARGUMENT_COUNT ||
    !isDirectSdkConstructor(store.callee, "WebStorageStateStore", store, program, scopes)
  )
    return false;
  const options = store.arguments[OIDC_CONSTRUCTOR_ARGUMENT_INDEX];
  if (
    !isNodeOfType(options, "ObjectExpression") ||
    options.properties.length !== OIDC_STORE_OPTION_PROPERTY_COUNT
  )
    return false;
  const storage = getOwnDataProperty(options, "store");
  if (!storage) return false;
  const member = stripParenExpression(storage);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    !["localStorage", "sessionStorage"].includes(getStaticPropertyName(member) ?? "") ||
    !isNodeOfType(member.object, "Identifier") ||
    member.object.name !== "window" ||
    !scopes.isGlobalReference(member.object) ||
    hasPossibleStaticPropertyMutationOrEscape(
      member.object,
      getStaticPropertyName(member) ?? "",
      scopes,
    )
  )
    return false;
  return true;
};

const getNativeStoreConstructor = (
  expression: EsTreeNode,
  constructor: EsTreeNode,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let settings = stripParenExpression(expression);
  if (isNodeOfType(settings, "Identifier")) {
    const symbol = scopes.symbolFor(settings);
    const initializer = symbol ? getDirectConstInitializer(symbol) : null;
    if (
      !symbol ||
      !initializer ||
      symbol.scope.kind !== "module" ||
      !isReadonlyCompleteBinding(symbol, program, scopes) ||
      symbol.references.some(
        (reference) =>
          !isTypeScriptTypePosition(reference.identifier) &&
          findTransparentExpressionRoot(reference.identifier).parent !== constructor,
      )
    )
      return null;
    settings = stripParenExpression(initializer);
  }
  const store = getOwnDataProperty(settings, "userStore");
  return store && isNativeStorageStore(store, program, scopes) ? stripParenExpression(store) : null;
};

const hasOnlySelectedSdkImports = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  allowedConstructors: ReadonlySet<EsTreeNode>,
): boolean => {
  for (const symbol of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (declaration?.source.value !== OIDC_CLIENT_MODULE_SOURCE) continue;
    if (!isReadonlyCompleteBinding(symbol, program, scopes)) return false;
    const runtimeReferences = symbol.references.filter(
      (reference) => !isTypeScriptTypePosition(reference.identifier),
    );
    if (runtimeReferences.length === 0) continue;
    if (
      !getValueImportDeclaration(symbol) ||
      !isNodeOfType(symbol.declarationNode, "ImportSpecifier")
    )
      return false;
    const imported = resolveImportedApiReference(symbol.bindingIdentifier, scopes);
    if (
      imported?.importedName !== "UserManager" &&
      imported?.importedName !== "WebStorageStateStore"
    )
      return false;
    if (
      !runtimeReferences.every((reference) => {
        const callee = findTransparentExpressionRoot(reference.identifier);
        const construct = callee.parent;
        return (
          isNodeOfType(construct, "NewExpression") &&
          construct.callee === callee &&
          allowedConstructors.has(construct)
        );
      })
    )
      return false;
  }
  if (!isNodeOfType(program, "Program")) return false;
  return program.body.every(
    (statement) =>
      !(
        (isNodeOfType(statement, "ExportNamedDeclaration") ||
          isNodeOfType(statement, "ExportAllDeclaration")) &&
        statement.exportKind !== "type" &&
        statement.source?.value === OIDC_CLIENT_MODULE_SOURCE
      ),
  );
};

const hasDirectErasedInterfaceImportUse = (
  symbol: SymbolDescriptor,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  return program.body.some((statement) => {
    const declaration = isNodeOfType(statement, "ExportNamedDeclaration")
      ? statement.declaration
      : statement;
    if (!isNodeOfType(declaration, "TSInterfaceDeclaration") || declaration.typeParameters)
      return false;
    const isSelectedImportedType = (node: EsTreeNode): boolean =>
      isNodeOfType(node, "Identifier") &&
      node.name === symbol.name &&
      findVisibleSymbol(node, scopes) === symbol;
    if (declaration.extends.some((heritage) => isSelectedImportedType(heritage.expression)))
      return true;
    return declaration.body.body.some((member) => {
      if (!isNodeOfType(member, "TSPropertySignature") || member.computed) return false;
      const annotation = member.typeAnnotation?.typeAnnotation;
      return (
        isNodeOfType(annotation, "TSTypeReference") && isSelectedImportedType(annotation.typeName)
      );
    });
  });
};

const hasSupportedProviderImports = (
  program: EsTreeNode,
  scopes: ScopeAnalysis,
  filename: string,
): boolean => {
  if (!isNodeOfType(program, "Program")) return false;
  if (
    !program.body.every((statement) => {
      if (isNodeOfType(statement, "ImportDeclaration")) return statement.specifiers.length > 0;
      return !(
        (isNodeOfType(statement, "ExportNamedDeclaration") ||
          isNodeOfType(statement, "ExportAllDeclaration")) &&
        statement.source &&
        statement.exportKind !== "type"
      );
    })
  )
    return false;
  for (const symbol of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (!declaration) continue;
    if (!isReadonlyCompleteBinding(symbol, program, scopes)) return false;
    const valueImport = getValueImportDeclaration(symbol);
    const hasOnlyErasedImportUses =
      !symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)) &&
      (!valueImport || hasDirectErasedInterfaceImportUse(symbol, program, scopes));
    if (hasOnlyErasedImportUses) continue;
    if (!valueImport) return false;
    if (declaration.source.value === OIDC_CLIENT_MODULE_SOURCE) continue;
    if (declaration.source.value !== "react" || resolveModulePath(filename, "react") !== null)
      return false;
  }
  return true;
};

const hasUniqueImportedManagerValue = (
  selectedImport: SymbolDescriptor,
  managerConstructor: EsTreeNode,
  providerFilename: string,
  consumerFilename: string,
  program: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  for (const symbol of scopes.rootScope.symbols) {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (!declaration) continue;
    if (!isReadonlyCompleteBinding(symbol, program, scopes)) return false;
    if (!symbol.references.some((reference) => !isTypeScriptTypePosition(reference.identifier)))
      continue;
    if (!getValueImportDeclaration(symbol)) return false;
    const source = declaration.source.value;
    if (typeof source !== "string") return false;
    const directPath = resolveModulePath(consumerFilename, source);
    if (!isNodeOfType(symbol.declarationNode, "ImportSpecifier")) {
      if (directPath !== null) return false;
      continue;
    }
    const imported = resolveImportedApiReference(symbol.bindingIdentifier, scopes);
    if (!imported?.importedName) return false;
    const resolved = resolveCrossFileValueExportWithFilePath(
      consumerFilename,
      source,
      imported.importedName,
    );
    if (
      symbol !== selectedImport &&
      resolved &&
      ((resolved.filePath === providerFilename && resolved.exportedNode === managerConstructor) ||
        isNodeOfType(resolved.exportedNode, "Identifier") ||
        isNodeOfType(resolved.exportedNode, "MemberExpression"))
    )
      return false;
  }
  return true;
};

interface OidcManagerOriginInput {
  readonly receiver: EsTreeNode;
  readonly consumerProgram: EsTreeNode;
  readonly consumerScopes: ScopeAnalysis;
  readonly consumerFilename: string;
}

const hasRejectableOidcManagerOrigin = ({
  receiver,
  consumerProgram,
  consumerScopes,
  consumerFilename,
}: OidcManagerOriginInput): boolean => {
  let symbol = consumerScopes.symbolFor(receiver);
  if (
    !symbol ||
    !hasSupportedVisibleCapabilities(consumerProgram, consumerScopes) ||
    !hasInstanceCallReferences(symbol, consumerProgram, consumerScopes)
  )
    return false;
  const consumerSymbol = symbol;
  let program: EsTreeNode = consumerProgram;
  let scopes = consumerScopes;
  let filename = consumerFilename;
  if (symbol.kind === "import") {
    if (
      !getValueImportDeclaration(symbol) ||
      !isNodeOfType(symbol.declarationNode, "ImportSpecifier")
    )
      return false;
    const imported = resolveImportedApiReference(receiver, scopes);
    if (!imported?.importedName || imported.source === OIDC_CLIENT_MODULE_SOURCE) return false;
    const directPath = resolveModulePath(filename, imported.source);
    if (!directPath) return false;
    const resolved = resolveCrossFileValueExportWithFilePath(
      filename,
      imported.source,
      imported.importedName,
    );
    if (!resolved || resolved.filePath !== directPath) return false;
    const declarator = resolved.exportedNode.parent;
    if (
      !isNodeOfType(declarator, "VariableDeclarator") ||
      !isNodeOfType(declarator.id, "Identifier")
    )
      return false;
    program = resolved.programNode;
    scopes = providerScopesByProgram.get(program) ?? analyzeScopes(program);
    providerScopesByProgram.set(program, scopes);
    symbol = scopes.symbolFor(declarator.id);
    filename = resolved.filePath;
    if (
      !symbol ||
      !hasSupportedVisibleCapabilities(program, scopes) ||
      !hasInstanceCallReferences(symbol, program, scopes)
    )
      return false;
  }
  const initializer = getDirectConstInitializer(symbol);
  const construct = initializer ? stripParenExpression(initializer) : null;
  if (
    symbol.scope.kind !== "module" ||
    !isNodeOfType(construct, "NewExpression") ||
    construct.arguments.length !== OIDC_CONSTRUCTOR_ARGUMENT_COUNT ||
    !isDirectSdkConstructor(construct.callee, "UserManager", construct, program, scopes) ||
    resolveModulePath(filename, OIDC_CLIENT_MODULE_SOURCE) !== null
  )
    return false;
  const settings = construct.arguments[OIDC_CONSTRUCTOR_ARGUMENT_INDEX];
  const storeConstructor = settings
    ? getNativeStoreConstructor(settings, construct, program, scopes)
    : null;
  if (!storeConstructor) return false;
  const allowedConstructors = new Set([construct, storeConstructor]);
  if (!hasOnlySelectedSdkImports(program, scopes, allowedConstructors)) return false;
  if (!hasSupportedProviderImports(program, scopes, filename)) return false;
  if (
    program !== consumerProgram &&
    !hasOnlySelectedSdkImports(consumerProgram, consumerScopes, new Set<EsTreeNode>())
  )
    return false;
  return (
    consumerSymbol.kind !== "import" ||
    hasUniqueImportedManagerValue(
      consumerSymbol,
      construct,
      filename,
      consumerFilename,
      consumerProgram,
      consumerScopes,
    )
  );
};

export const isRejectableOidcUserManagerCall = (
  expression: EsTreeNode,
  context: Pick<RuleContext, "filename" | "scopes">,
): boolean => {
  const call = stripParenExpression(expression);
  if (
    !context.filename ||
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== OIDC_GET_USER_ARGUMENT_COUNT
  )
    return false;
  const member = stripParenExpression(call.callee);
  if (
    !isNodeOfType(member, "MemberExpression") ||
    member.computed ||
    member.optional ||
    getStaticPropertyName(member) !== "getUser"
  )
    return false;
  const receiver = stripParenExpression(member.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const consumerProgram = findProgramRoot(call);
  const symbol = context.scopes.symbolFor(receiver);
  if (!consumerProgram || !symbol) return false;
  const facts = getProgramFacts(consumerProgram, context.scopes);
  const generation = getManifestCacheGeneration();
  if (facts.managerOriginGeneration !== generation) {
    facts.managerOrigins.clear();
    facts.managerOriginGeneration = generation;
  }
  let origins = facts.managerOrigins.get(symbol);
  if (!origins) {
    origins = new Map();
    facts.managerOrigins.set(symbol, origins);
  }
  const cached = origins.get(context.filename);
  if (cached !== undefined) {
    replayCrossFileProbes(cached.trace);
    return cached.value;
  }
  const consumerFilename = context.filename;
  const supported = captureCrossFileProbes(() =>
    hasRejectableOidcManagerOrigin({
      receiver,
      consumerProgram,
      consumerScopes: context.scopes,
      consumerFilename,
    }),
  );
  origins.set(context.filename, supported);
  return supported.value;
};
