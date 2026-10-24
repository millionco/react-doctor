import { getTsconfigAliasCacheGeneration } from "../../../utils/resolve-tsconfig-alias.js";
import { getModuleResolutionCacheGeneration } from "../../../utils/resolve-relative-import-path.js";
import * as path from "node:path";
import type { ScopeAnalysis, SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import { buildSourceProjectIndex } from "../../../utils/build-source-project-index.js";
import type {
  SourceProjectIndex,
  SourceProjectModule,
} from "../../../utils/build-source-project-index.js";
import {
  captureCrossFileProbes,
  replayCrossFileProbes,
  type CapturedCrossFileProbes,
} from "../../../utils/cross-file-probe-recorder.js";
import { getManifestCacheGeneration } from "../../../utils/read-nearest-package-manifest.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findExportedValue } from "../../../utils/find-exported-value.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectFunctionBindingIdentifier } from "../../../utils/get-direct-function-binding-identifier.js";
import { getImportDeclarationForSymbol } from "../../../utils/get-import-declaration-for-symbol.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getNodeStartIndex } from "../../../utils/get-node-start-index.js";
import { getReactDoctorStringSetting } from "../../../utils/get-react-doctor-setting.js";
import { getStaticPropertyKeyName } from "../../../utils/get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isNonReferenceIdentifier } from "../../../utils/is-non-reference-identifier.js";
import { isTypeScriptTypePosition } from "../../../utils/is-typescript-type-position.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import { normalizeFilename } from "../../../utils/normalize-filename.js";
import { resolveModulePath } from "../../../utils/resolve-module-path.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";
import {
  QUOTED_PROJECT_NAME_FORWARDING_HOPS,
  QUOTED_PROJECT_NAME_PROCESS_MEMBERS,
  QUOTED_PROJECT_NAME_PATH_SOURCES,
  QUOTED_PROJECT_NAME_FS_SOURCES,
  QUOTED_PROJECT_NAME_REPLACEMENT_SOURCES,
  QUOTED_PROJECT_NAME_CAPTURE_INDEX,
  QUOTED_PROJECT_NAME_CAPABILITIES,
  QUOTED_PROJECT_NAME_CAPABILITY_MODULES,
  QUOTED_PROJECT_NAME_DANGEROUS_MEMBERS,
  QUOTED_PROJECT_NAME_RUNTIME_TYPESCRIPT,
  QUOTED_PROJECT_NAME_CAPTURE_PATTERNS,
  QUOTED_PROJECT_NAME_OPTION_FIELDS,
} from "./constants.js";

interface ProjectNameFunction {
  readonly module: SourceProjectModule;
  readonly node: EsTreeNodeOfType<
    "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
  >;
}

interface ProjectNameCall {
  readonly module: SourceProjectModule;
  readonly node: EsTreeNodeOfType<"CallExpression">;
}

interface ProjectNameOriginFacts {
  readonly generation: number;
  readonly aliasGeneration: number;
  readonly resolutionGeneration: number;
  readonly program: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
  readonly filename: string;
  readonly rootDirectory: string;
  readonly origins: WeakMap<EsTreeNode, Map<string, CapturedCrossFileProbes<boolean>>>;
  index?: CapturedCrossFileProbes<SourceProjectIndex | null>;
  closedSurface?: CapturedCrossFileProbes<boolean>;
  calls?: CapturedCrossFileProbes<ReadonlyMap<EsTreeNode, ReadonlyArray<ProjectNameCall>>>;
}

const isLiteral = (node: EsTreeNode | null | undefined, value: string | number): boolean =>
  Boolean(node && isNodeOfType(node, "Literal") && node.value === value);

const getDirectNamedMember = (
  node: EsTreeNode | null | undefined,
  name: string,
): EsTreeNodeOfType<"MemberExpression"> | null =>
  node &&
  isNodeOfType(node, "MemberExpression") &&
  !node.computed &&
  !node.optional &&
  getStaticPropertyKeyName(node) === name
    ? node
    : null;

const getDirectCall = (
  node: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"CallExpression"> | null =>
  node &&
  isNodeOfType(node, "CallExpression") &&
  !node.optional &&
  node.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? node
    : null;

const readonlySymbolsByScopes = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, Map<SymbolDescriptor, boolean>>
>();

const getReadonlySymbol = (
  node: EsTreeNode,
  module: SourceProjectModule,
): SymbolDescriptor | null => {
  const symbol = module.scopes.symbolFor(node);
  if (!symbol) return null;
  let programs = readonlySymbolsByScopes.get(module.scopes);
  if (!programs) {
    programs = new WeakMap();
    readonlySymbolsByScopes.set(module.scopes, programs);
  }
  let symbols = programs.get(module.programNode);
  if (!symbols) {
    symbols = new Map();
    programs.set(module.programNode, symbols);
  }
  let readonly = symbols.get(symbol);
  if (readonly === undefined) {
    readonly =
      hasCompleteSymbolReferences(symbol, module.programNode, module.scopes) &&
      symbol.references.every(
        (reference) => reference.flag === "read" && !isWithinAssignmentTarget(reference.identifier),
      );
    symbols.set(symbol, readonly);
  }
  return readonly ? symbol : null;
};

const hasSameBinding = (
  node: EsTreeNode,
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
): boolean => isNodeOfType(node, "Identifier") && module.scopes.symbolFor(node) === symbol;

const getReadonlyConstInitializer = (
  node: EsTreeNode,
  module: SourceProjectModule,
): EsTreeNode | null => {
  const symbol = getReadonlySymbol(node, module);
  const declaration = symbol?.declarationNode;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "Identifier") ||
    !isNodeOfType(declaration.parent, "VariableDeclaration") ||
    declaration.parent.kind !== "const" ||
    !declaration.init ||
    getNodeStartIndex(declaration) >= getNodeStartIndex(node)
  )
    return null;
  return stripParenExpression(declaration.init);
};

const getOwnStaticProperties = (node: EsTreeNode): ReadonlyMap<string, EsTreeNode> | null => {
  if (!isNodeOfType(node, "ObjectExpression") && !isNodeOfType(node, "ObjectPattern")) return null;
  const values = new Map<string, EsTreeNode>();
  for (const property of node.properties) {
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init"
    )
      return null;
    const name = getStaticPropertyKeyName(property);
    if (!name || values.has(name) || QUOTED_PROJECT_NAME_DANGEROUS_MEMBERS.has(name)) return null;
    values.set(name, property.value);
  }
  return values;
};

const hasClosedNativeSurface = (module: SourceProjectModule): boolean => {
  let supported = true;
  walkAst(module.programNode, (node) => {
    if (QUOTED_PROJECT_NAME_RUNTIME_TYPESCRIPT.has(node.type)) {
      supported = false;
      return false;
    }
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "CallExpression") &&
      isNodeOfType(node.callee, "Identifier") &&
      node.callee.name === "require"
    ) {
      const source = node.arguments[0];
      if (
        !module.scopes.isGlobalReference(node.callee) ||
        node.arguments.length !== 1 ||
        !source ||
        !isNodeOfType(source, "Literal") ||
        typeof source.value !== "string" ||
        source.value.startsWith("node:") ||
        QUOTED_PROJECT_NAME_CAPABILITY_MODULES.has(source.value)
      )
        supported = false;
    }
    if (
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "ThisExpression") ||
      isNodeOfType(node, "Super")
    )
      supported = false;
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      typeof node.source.value === "string" &&
      !QUOTED_PROJECT_NAME_FS_SOURCES.has(node.source.value) &&
      !QUOTED_PROJECT_NAME_PATH_SOURCES.has(node.source.value) &&
      !QUOTED_PROJECT_NAME_REPLACEMENT_SOURCES.has(node.source.value) &&
      (node.source.value.startsWith("node:") ||
        QUOTED_PROJECT_NAME_CAPABILITY_MODULES.has(node.source.value))
    )
      supported = false;
    if (isNodeOfType(node, "MemberExpression")) {
      if (
        node.computed &&
        (!isNodeOfType(node.property, "Literal") ||
          typeof node.property.value !== "number" ||
          !Number.isInteger(node.property.value) ||
          node.property.value < 0)
      )
        supported = false;
      const name = getStaticPropertyKeyName(node, { allowComputedString: true });
      if (name && QUOTED_PROJECT_NAME_DANGEROUS_MEMBERS.has(name)) supported = false;
    }
    if (
      isNodeOfType(node, "Property") &&
      (node.computed ||
        node.kind !== "init" ||
        QUOTED_PROJECT_NAME_DANGEROUS_MEMBERS.has(getStaticPropertyKeyName(node) ?? ""))
    )
      supported = false;
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (QUOTED_PROJECT_NAME_CAPABILITIES.has(node.name)) supported = false;
    if (
      node.name === "process" &&
      (!module.scopes.isGlobalReference(node) ||
        !isNodeOfType(node.parent, "MemberExpression") ||
        node.parent.object !== node ||
        !QUOTED_PROJECT_NAME_PROCESS_MEMBERS.has(getStaticPropertyKeyName(node.parent) ?? "") ||
        isWithinAssignmentTarget(node))
    )
      supported = false;
    if (node.name === "String" || node.name === "RegExp") {
      const parent = node.parent;
      if (
        !module.scopes.isGlobalReference(node) ||
        !parent ||
        (parent.type !== "CallExpression" && parent.type !== "NewExpression") ||
        parent.callee !== node
      )
        supported = false;
    }
  });
  if (!supported) return false;
  for (const statement of module.programNode.body) {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      typeof statement.source.value !== "string"
    )
      continue;
    const source = statement.source.value;
    const sources = [
      QUOTED_PROJECT_NAME_FS_SOURCES,
      QUOTED_PROJECT_NAME_PATH_SOURCES,
      QUOTED_PROJECT_NAME_REPLACEMENT_SOURCES,
    ].find((providerSources) => providerSources.has(source));
    if (
      sources &&
      !statement.specifiers.every(
        (specifier) =>
          isNodeOfType(specifier, "ImportDefaultSpecifier") &&
          Boolean(importedProvider(specifier.local, sources, module)),
      )
    )
      return false;
  }
  return true;
};

const importedProvider = (
  node: EsTreeNode,
  sources: ReadonlySet<string>,
  module: SourceProjectModule,
): SymbolDescriptor | null => {
  const symbol = getReadonlySymbol(node, module);
  if (!symbol || !isNodeOfType(symbol.declarationNode, "ImportDefaultSpecifier")) return null;
  const declaration = getImportDeclarationForSymbol(symbol);
  const source = declaration?.source.value;
  if (
    !declaration ||
    declaration.importKind === "type" ||
    typeof source !== "string" ||
    !sources.has(source) ||
    resolveModulePath(module.filePath, source)
  )
    return null;
  for (const statement of module.programNode.body) {
    if (
      !isNodeOfType(statement, "ImportDeclaration") ||
      statement.importKind === "type" ||
      typeof statement.source.value !== "string" ||
      !sources.has(statement.source.value)
    )
      continue;
    if (statement !== declaration || statement.specifiers.length !== 1) return null;
  }
  const isCallable = source === "replace-in-file";
  if (
    !symbol.references.every((reference) => {
      let current = findTransparentExpressionRoot(reference.identifier);
      if (!isCallable) {
        if (!isNodeOfType(current.parent, "MemberExpression") || current.parent.object !== current)
          return false;
        while (
          isNodeOfType(current.parent, "MemberExpression") &&
          current.parent.object === current
        ) {
          if (current.parent.computed || current.parent.optional) return false;
          current = current.parent;
        }
      }
      return Boolean(getDirectCall(current.parent)?.callee === current);
    })
  )
    return null;
  return symbol;
};

const resolveDirectFunction = (
  identifier: EsTreeNode,
  module: SourceProjectModule,
  index: SourceProjectIndex,
): ProjectNameFunction | null => {
  if (!isNodeOfType(identifier, "Identifier")) return null;
  const symbol = getReadonlySymbol(identifier, module);
  if (!symbol) return null;
  if (symbol.kind !== "import") {
    const value = symbol.initializer;
    const declaration = symbol.declarationNode;
    const isConstFunction =
      isNodeOfType(declaration, "VariableDeclarator") &&
      isNodeOfType(declaration.parent, "VariableDeclaration") &&
      declaration.parent.kind === "const";
    return value &&
      isFunctionLike(value) &&
      !("generator" in value && value.generator) &&
      (isConstFunction || isNodeOfType(declaration, "FunctionDeclaration"))
      ? { module, node: value }
      : null;
  }
  const declaration = getImportDeclarationForSymbol(symbol);
  const exportedName = getImportedName(symbol.declarationNode);
  if (
    !declaration ||
    declaration.importKind === "type" ||
    !isNodeOfType(symbol.declarationNode, "ImportSpecifier") ||
    symbol.declarationNode.importKind === "type" ||
    !exportedName ||
    typeof declaration.source.value !== "string"
  )
    return null;
  const resolvedPath = resolveModulePath(module.filePath, declaration.source.value);
  const importedModule = resolvedPath
    ? index.modulesByFilePath.get(normalizeFilename(resolvedPath))
    : null;
  if (!importedModule) return null;
  const value = findExportedValue(importedModule.programNode, exportedName);
  if (!value || !isFunctionLike(value) || ("generator" in value && value.generator)) return null;
  const binding = getDirectFunctionBindingIdentifier(value);
  if (!binding || !getReadonlySymbol(binding, importedModule)) return null;
  return { module: importedModule, node: value };
};

const collectProjectNameCalls = (
  index: SourceProjectIndex,
): ReadonlyMap<EsTreeNode, ReadonlyArray<ProjectNameCall>> => {
  const calls = new Map<EsTreeNode, ProjectNameCall[]>();
  for (const module of index.modulesByFilePath.values()) {
    walkAst(module.programNode, (node) => {
      const invocation = getDirectCall(node);
      if (!invocation || !isNodeOfType(invocation.callee, "Identifier")) return;
      const resolved = resolveDirectFunction(invocation.callee, module, index);
      if (!resolved) return;
      const invocations = calls.get(resolved.node) ?? [];
      invocations.push({ module, node: invocation });
      calls.set(resolved.node, invocations);
    });
  }
  return calls;
};

const getParameterProperty = (
  identifier: EsTreeNode,
  owner: ProjectNameFunction,
): string | null => {
  if (!("params" in owner.node) || owner.node.params.length !== 1) return null;
  const parameter = owner.node.params[0];
  if (!parameter || !isNodeOfType(parameter, "ObjectPattern")) return null;
  const symbol = getReadonlySymbol(identifier, owner.module);
  if (!symbol) return null;
  const properties = getOwnStaticProperties(parameter);
  if (!properties) return null;
  for (const [name, binding] of properties) {
    if (isNodeOfType(binding, "Identifier") && owner.module.scopes.symbolFor(binding) === symbol)
      return name;
  }
  return null;
};

const hasLiteralOnlyCaptureUses = (symbol: SymbolDescriptor, owner: ProjectNameFunction): boolean =>
  symbol.references.every((reference) => {
    const parent = findTransparentExpressionRoot(reference.identifier).parent;
    return Boolean(
      parent &&
      findEnclosingFunction(reference.identifier) === owner.node &&
      ((isNodeOfType(parent, "ReturnStatement") && parent.argument === reference.identifier) ||
        (isNodeOfType(parent, "IfStatement") && parent.test === reference.identifier)),
    );
  });

const isOrdinaryProjectDirectory = (node: EsTreeNode, module: SourceProjectModule): boolean => {
  const value = isNodeOfType(node, "Identifier") ? getReadonlyConstInitializer(node, module) : node;
  if (!value) return false;
  if (isNodeOfType(value, "Literal") && typeof value.value === "string") return true;
  if (!isNodeOfType(value, "LogicalExpression") || value.operator !== "||") return false;
  const environment = getDirectNamedMember(value.left, getStaticPropertyKeyName(value.left) ?? "");
  const environmentReceiver = environment ? getDirectNamedMember(environment.object, "env") : null;
  const fallback = getDirectCall(value.right);
  const cwd = fallback ? getDirectNamedMember(fallback.callee, "cwd") : null;
  return Boolean(
    environmentReceiver &&
    isNodeOfType(environmentReceiver.object, "Identifier") &&
    environmentReceiver.object.name === "process" &&
    module.scopes.isGlobalReference(environmentReceiver.object) &&
    fallback?.arguments.length === 0 &&
    cwd &&
    isNodeOfType(cwd.object, "Identifier") &&
    cwd.object.name === "process" &&
    module.scopes.isGlobalReference(cwd.object),
  );
};

const isQuotedProjectNameProducer = (owner: ProjectNameFunction): boolean => {
  const functionNode = owner.node;
  if (
    !("params" in functionNode) ||
    functionNode.params.length !== 0 ||
    !("body" in functionNode) ||
    !isNodeOfType(functionNode.body, "BlockStatement") ||
    ("async" in functionNode && functionNode.async)
  )
    return false;
  const statements = functionNode.body.body;
  const declarations = statements.flatMap((statement) =>
    isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const"
      ? statement.declarations
      : [],
  );
  if (declarations.length !== 3) return false;
  const [fileDeclaration, textDeclaration, captureDeclaration] = declarations;
  if (
    !fileDeclaration ||
    !textDeclaration ||
    !captureDeclaration ||
    !fileDeclaration.init ||
    !textDeclaration.init ||
    !captureDeclaration.init ||
    !isNodeOfType(fileDeclaration.id, "Identifier") ||
    !isNodeOfType(textDeclaration.id, "Identifier") ||
    !isNodeOfType(captureDeclaration.id, "Identifier")
  )
    return false;
  const fileSymbol = getReadonlySymbol(fileDeclaration.id, owner.module);
  const textSymbol = getReadonlySymbol(textDeclaration.id, owner.module);
  const captureSymbol = getReadonlySymbol(captureDeclaration.id, owner.module);
  const fileCall = getDirectCall(fileDeclaration.init);
  const join = fileCall ? getDirectNamedMember(fileCall.callee, "join") : null;
  const fileProvider =
    join && importedProvider(join.object, QUOTED_PROJECT_NAME_PATH_SOURCES, owner.module);
  if (
    !fileSymbol ||
    !textSymbol ||
    !captureSymbol ||
    !fileCall ||
    !join ||
    !fileProvider ||
    fileCall.arguments.length !== 3 ||
    !fileCall.arguments[0] ||
    !isOrdinaryProjectDirectory(fileCall.arguments[0], owner.module) ||
    !isLiteral(fileCall.arguments[1], "android") ||
    !isLiteral(fileCall.arguments[2], "settings.gradle")
  )
    return false;
  const textCall = getDirectCall(textDeclaration.init);
  const read = textCall ? getDirectNamedMember(textCall.callee, "readFileSync") : null;
  if (
    !textCall ||
    !read ||
    !importedProvider(read.object, QUOTED_PROJECT_NAME_FS_SOURCES, owner.module) ||
    textCall.arguments.length !== 2 ||
    !textCall.arguments[0] ||
    !hasSameBinding(textCall.arguments[0], fileSymbol, owner.module) ||
    !isLiteral(textCall.arguments[1], "utf8")
  )
    return false;
  const capture = stripParenExpression(captureDeclaration.init);
  if (
    !isNodeOfType(capture, "MemberExpression") ||
    !capture.computed ||
    capture.optional ||
    !isLiteral(capture.property, QUOTED_PROJECT_NAME_CAPTURE_INDEX)
  )
    return false;
  const matchCall = getDirectCall(capture.object);
  const match = matchCall ? getDirectNamedMember(matchCall.callee, "match") : null;
  const pattern = matchCall?.arguments[0];
  if (
    !matchCall ||
    !match ||
    !hasSameBinding(match.object, textSymbol, owner.module) ||
    matchCall.arguments.length !== 1 ||
    !pattern ||
    !isNodeOfType(pattern, "Literal") ||
    !("regex" in pattern) ||
    !pattern.regex ||
    pattern.regex.flags !== "" ||
    !QUOTED_PROJECT_NAME_CAPTURE_PATTERNS.has(pattern.regex.pattern)
  )
    return false;
  if (
    fileSymbol.references.length !== 1 ||
    textSymbol.references.length !== 1 ||
    !hasLiteralOnlyCaptureUses(captureSymbol, owner)
  )
    return false;
  const guard = statements.find((statement) => isNodeOfType(statement, "IfStatement"));
  if (
    !guard ||
    !isNodeOfType(guard, "IfStatement") ||
    !hasSameBinding(guard.test, captureSymbol, owner.module) ||
    guard.alternate ||
    !isNodeOfType(guard.consequent, "BlockStatement") ||
    guard.consequent.body.length !== 1
  )
    return false;
  const returned = guard.consequent.body[0];
  const final = statements[statements.length - 1];
  return Boolean(
    returned &&
    isNodeOfType(returned, "ReturnStatement") &&
    returned.argument &&
    hasSameBinding(returned.argument, captureSymbol, owner.module) &&
    final &&
    isNodeOfType(final, "ThrowStatement") &&
    statements.length === declarations.length + 2,
  );
};

const tracesQuotedProjectName = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  index: SourceProjectIndex,
  hops: number,
  calls: ReadonlyMap<EsTreeNode, ReadonlyArray<ProjectNameCall>>,
): boolean => {
  const inner = stripParenExpression(expression);
  if (isNodeOfType(inner, "Identifier")) {
    const value = getReadonlyConstInitializer(inner, module);
    if (value && getDirectCall(value)) {
      const invocation = getDirectCall(value);
      if (
        !invocation ||
        invocation.arguments.length !== 0 ||
        !isNodeOfType(invocation.callee, "Identifier")
      )
        return false;
      const producer = resolveDirectFunction(invocation.callee, module, index);
      const symbol = getReadonlySymbol(inner, module);
      return Boolean(
        producer &&
        symbol &&
        symbol.references.every((reference) => {
          if (isNonReferenceIdentifier(reference.identifier)) return true;
          const parent = reference.identifier.parent;
          return (
            parent &&
            isNodeOfType(parent, "Property") &&
            parent.value === reference.identifier &&
            isNodeOfType(parent.parent, "ObjectExpression")
          );
        }) &&
        isQuotedProjectNameProducer(producer),
      );
    }
    const functionNode = findEnclosingFunction(inner);
    if (!isFunctionLike(functionNode) || hops === 0) return false;
    const owner = { module, node: functionNode };
    const property = getParameterProperty(inner, owner);
    const symbol = getReadonlySymbol(inner, module);
    if (
      !property ||
      !symbol ||
      !symbol.references.every((reference) => {
        if (isNonReferenceIdentifier(reference.identifier)) return true;
        const parent = reference.identifier.parent;
        return Boolean(
          parent &&
          isNodeOfType(parent, "Property") &&
          parent.value === reference.identifier &&
          isNodeOfType(parent.parent, "ObjectExpression"),
        );
      })
    )
      return false;
    return (calls.get(owner.node) ?? []).some((caller) => {
      if (caller.node.arguments.length !== 1) return false;
      const argument = caller.node.arguments[0];
      const properties = argument ? getOwnStaticProperties(argument) : null;
      const value = properties?.get(property);
      return Boolean(
        value && tracesQuotedProjectName(value, caller.module, index, hops - 1, calls),
      );
    });
  }
  return false;
};

const getReturnedDescriptors = (
  owner: ProjectNameFunction,
): EsTreeNodeOfType<"ArrayExpression"> | null => {
  if (!("body" in owner.node)) return null;
  const body = owner.node.body;
  if (isNodeOfType(body, "ArrayExpression")) return body;
  if (!isNodeOfType(body, "BlockStatement")) return null;
  const returned = body.body.filter((statement) => isNodeOfType(statement, "ReturnStatement"));
  if (
    returned.length !== 1 ||
    !returned[0] ||
    !isNodeOfType(returned[0], "ReturnStatement") ||
    !returned[0].argument
  )
    return null;
  const value = stripParenExpression(returned[0].argument);
  return isNodeOfType(value, "ArrayExpression") ? value : null;
};

const isDescriptorPattern = (construction: EsTreeNode, owner: ProjectNameFunction): boolean => {
  if ("async" in owner.node && owner.node.async) return false;
  let current = findTransparentExpressionRoot(construction);
  if (isNodeOfType(current.parent, "ArrayExpression")) current = current.parent;
  const property = current.parent;
  if (
    !property ||
    !isNodeOfType(property, "Property") ||
    property.value !== current ||
    getStaticPropertyKeyName(property) !== "from" ||
    !isNodeOfType(property.parent, "ObjectExpression")
  )
    return false;
  const descriptor = getOwnStaticProperties(property.parent);
  const descriptors = getReturnedDescriptors(owner);
  return Boolean(
    descriptor?.has("files") &&
    descriptor.has("to") &&
    descriptors &&
    property.parent.parent === descriptors,
  );
};

const hasPreservingReplacementConsumer = (
  invocation: ProjectNameCall,
  index: SourceProjectIndex,
): boolean => {
  const root = findTransparentExpressionRoot(invocation.node);
  const declaration = root.parent;
  if (
    !declaration ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== root ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const options = getReadonlySymbol(declaration.id, invocation.module);
  if (!options || options.references.length !== 1) return false;
  const reference = options.references[0]?.identifier;
  const consumerCall = reference ? getDirectCall(reference.parent) : null;
  if (
    !consumerCall ||
    consumerCall.arguments.length !== 1 ||
    consumerCall.arguments[0] !== reference ||
    !isNodeOfType(consumerCall.callee, "Identifier")
  )
    return false;
  const consumer = resolveDirectFunction(consumerCall.callee, invocation.module, index);
  if (
    !consumer ||
    !("params" in consumer.node) ||
    consumer.node.params.length !== 1 ||
    !consumer.node.params[0] ||
    !isNodeOfType(consumer.node.params[0], "Identifier")
  )
    return false;
  const parameter = getReadonlySymbol(consumer.node.params[0], consumer.module);
  if (!parameter || parameter.references.length !== 1) return false;
  const parameterRead = parameter.references[0]?.identifier;
  const map = parameterRead ? getDirectNamedMember(parameterRead.parent, "map") : null;
  const mapCall = map ? getDirectCall(map.parent) : null;
  const callback = mapCall?.arguments[0];
  if (
    !map ||
    map.object !== parameterRead ||
    !mapCall ||
    mapCall.arguments.length !== 1 ||
    !callback ||
    !isFunctionLike(callback) ||
    ("generator" in callback && callback.generator) ||
    !("params" in callback) ||
    !callback.params[0] ||
    !isNodeOfType(callback.params[0], "Identifier")
  )
    return false;
  const option = getReadonlySymbol(callback.params[0], consumer.module);
  if (!option) return false;
  const spreads = option.references.filter(
    (reference) =>
      isNodeOfType(reference.identifier.parent, "SpreadElement") &&
      reference.identifier.parent.argument === reference.identifier,
  );
  if (spreads.length !== 1) return false;
  for (const reference of option.references) {
    if (reference === spreads[0]) continue;
    const read = getDirectNamedMember(reference.identifier.parent, "files");
    if (!read || read.object !== reference.identifier) return false;
  }
  const spread = spreads[0]?.identifier.parent;
  const object = spread?.parent;
  if (!spread || !object || !isNodeOfType(object, "ObjectExpression")) return false;
  for (const property of object.properties) {
    if (property === spread) continue;
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      property.method ||
      property.kind !== "init" ||
      !QUOTED_PROJECT_NAME_OPTION_FIELDS.has(getStaticPropertyKeyName(property) ?? "")
    )
      return false;
  }
  const updated = object.parent;
  if (
    !updated ||
    !isNodeOfType(updated, "VariableDeclarator") ||
    updated.init !== object ||
    !isNodeOfType(updated.id, "Identifier")
  )
    return false;
  const updatedSymbol = getReadonlySymbol(updated.id, consumer.module);
  if (!updatedSymbol || updatedSymbol.references.length !== 1) return false;
  const updatedRead = updatedSymbol.references[0]?.identifier;
  const replaceCall = updatedRead ? getDirectCall(updatedRead.parent) : null;
  return Boolean(
    replaceCall &&
    replaceCall.arguments.length === 1 &&
    Boolean(updatedRead && findEnclosingFunction(updatedRead) === callback) &&
    replaceCall.arguments[0] === updatedRead &&
    isNodeOfType(replaceCall.callee, "Identifier") &&
    importedProvider(replaceCall.callee, QUOTED_PROJECT_NAME_REPLACEMENT_SOURCES, consumer.module),
  );
};

export const createQuotedProjectNameRegexpOriginChecker = (
  context: RuleContext,
): ((construction: EsTreeNode, argument: EsTreeNode) => boolean) => {
  let facts: ProjectNameOriginFacts | undefined;
  return (construction, argument) => {
    if (!isNodeOfType(argument, "Identifier")) return false;
    const program = findProgramRoot(construction);
    const filename = context.filename;
    const rootDirectory = getReactDoctorStringSetting(context.settings, "rootDirectory");
    if (
      !program ||
      !filename ||
      !rootDirectory ||
      !path.isAbsolute(filename) ||
      !path.isAbsolute(rootDirectory) ||
      path.relative(rootDirectory, filename).startsWith("..")
    )
      return false;
    const module: SourceProjectModule = {
      filePath: normalizeFilename(filename),
      programNode: program,
      scopes: context.scopes,
    };
    const functionNode = findEnclosingFunction(construction);
    if (!isFunctionLike(functionNode)) return false;
    const owner = { module, node: functionNode };
    const property = getParameterProperty(argument, owner);
    if (!property || !isDescriptorPattern(construction, owner)) return false;
    const generation = getManifestCacheGeneration();
    const aliasGeneration = getTsconfigAliasCacheGeneration();
    const resolutionGeneration = getModuleResolutionCacheGeneration();
    if (
      !facts ||
      facts.generation !== generation ||
      facts.aliasGeneration !== aliasGeneration ||
      facts.resolutionGeneration !== resolutionGeneration ||
      facts.program !== program ||
      facts.scopes !== context.scopes ||
      facts.filename !== filename ||
      facts.rootDirectory !== rootDirectory
    ) {
      facts = {
        generation,
        aliasGeneration,
        resolutionGeneration,
        program,
        scopes: context.scopes,
        filename,
        rootDirectory,
        origins: new WeakMap(),
      };
    }
    const currentFacts = facts;
    let origins = currentFacts.origins.get(functionNode);
    if (!origins) {
      origins = new Map();
      currentFacts.origins.set(functionNode, origins);
    }
    currentFacts.index ??= captureCrossFileProbes(() =>
      buildSourceProjectIndex({
        rootDirectory,
        currentFilePath: module.filePath,
        currentProgramNode: program,
        currentScopes: context.scopes,
      }),
    );
    replayCrossFileProbes(currentFacts.index.trace);
    const index = currentFacts.index.value;
    if (!index) return false;
    currentFacts.closedSurface ??= captureCrossFileProbes(() =>
      [...index.modulesByFilePath.values()].every(hasClosedNativeSurface),
    );
    replayCrossFileProbes(currentFacts.closedSurface.trace);
    if (!currentFacts.closedSurface.value) return false;
    currentFacts.calls ??= captureCrossFileProbes(() => collectProjectNameCalls(index));
    replayCrossFileProbes(currentFacts.calls.trace);
    const calls = currentFacts.calls.value;
    const cached = origins.get(property);
    if (cached) {
      replayCrossFileProbes(cached.trace);
      return cached.value;
    }
    const proof = captureCrossFileProbes(() => {
      const selectedModule = index.modulesByFilePath.get(module.filePath);
      if (!selectedModule) return false;
      const currentIndex = index;
      const indexedOwner = { module: selectedModule, node: functionNode };
      return (calls.get(indexedOwner.node) ?? []).some((caller) => {
        if (caller.node.arguments.length !== 1) return false;
        const argumentObject = caller.node.arguments[0];
        const values = argumentObject ? getOwnStaticProperties(argumentObject) : null;
        const value = values?.get(property);
        return Boolean(
          value &&
          tracesQuotedProjectName(
            value,
            caller.module,
            currentIndex,
            QUOTED_PROJECT_NAME_FORWARDING_HOPS,
            calls,
          ) &&
          hasPreservingReplacementConsumer(caller, currentIndex),
        );
      });
    });
    origins.set(property, proof);
    return proof.value;
  };
};
