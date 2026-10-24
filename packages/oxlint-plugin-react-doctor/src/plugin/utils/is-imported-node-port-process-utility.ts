import { getTsconfigAliasCacheGeneration } from "./resolve-tsconfig-alias.js";
import { getModuleResolutionCacheGeneration } from "./resolve-relative-import-path.js";
import * as path from "node:path";
import { BUILTIN_GLOBAL_NAMESPACE_NAMES } from "../constants/js.js";
import {
  analyzeScopes,
  type ScopeAnalysis,
  type SymbolDescriptor,
} from "../semantic/scope-analysis.js";
import {
  NODE_PORT_PROCESS_CAPABILITY_NAMES,
  NODE_PORT_PROCESS_PROVIDER_METHODS,
  NODE_PORT_PROCESS_ARGUMENT_COUNT,
  NODE_PORT_PROCESS_SINGLE_VALUE_COUNT,
  NODE_PORT_PROCESS_CAPABILITY_MEMBER_NAMES,
  NODE_PORT_PROCESS_GLOBAL_NAMES,
  NODE_PORT_PROCESS_MODULE_COUNT,
  NODE_PORT_PROCESS_LOADER_SOURCES,
  NODE_PORT_PROCESS_REQUIRED_SOURCES,
  NODE_PORT_PROCESS_TIMER_ARGUMENT_COUNT,
  NODE_PORT_PROCESS_TIMER_RESERVED_NAMES,
  NODE_PORT_PROCESS_CONSUMER_GLOBAL_NAMES,
  NODE_PORT_PROCESS_RANGE_PREFIX_PATTERN,
} from "../constants/react.js";
import {
  captureCrossFileProbes,
  replayCrossFileProbes,
  type CapturedCrossFileProbes,
} from "./cross-file-probe-recorder.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findProgramRoot } from "./find-program-root.js";
import { getGlobalRequireModuleSource } from "./get-global-require-module-source.js";
import { getStaticPropertyKeyName } from "./get-static-property-key-name.js";
import { hasCompleteSymbolReferences } from "./has-complete-symbol-references.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNonReferenceIdentifier } from "./is-non-reference-identifier.js";
import { isWithinAssignmentTarget } from "./is-within-assignment-target.js";
import { getParseSourceFileCacheGeneration, parseSourceFile } from "./parse-source-file.js";
import { parsePackageVersion } from "./parse-package-version.js";
import {
  getManifestCacheGeneration,
  readNearestPackageManifest,
} from "./read-nearest-package-manifest.js";
import { resolveModulePath } from "./resolve-module-path.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface NodePortProcessEnvironment {
  readonly program: EsTreeNodeOfType<"Program">;
  readonly scopes: ScopeAnalysis;
  readonly filename: string;
}

interface NodePortProcessFacts {
  readonly generation: number;
  readonly aliasGeneration: number;
  readonly resolutionGeneration: number;
  readonly parserGeneration: number;
  readonly origins: Map<SymbolDescriptor, CapturedCrossFileProbes<boolean>>;
  readonly providerBodies: Map<string, CapturedCrossFileProbes<boolean>>;
  closedProviders?: CapturedCrossFileProbes<boolean>;
  exposures?: CapturedCrossFileProbes<Map<string, Set<EsTreeNode>>>;
}

const nodePortProcessFacts = new WeakMap<
  ScopeAnalysis,
  WeakMap<EsTreeNode, Map<string, NodePortProcessFacts>>
>();

const getNodePortProcessFacts = (environment: NodePortProcessEnvironment): NodePortProcessFacts => {
  let programs = nodePortProcessFacts.get(environment.scopes);
  if (!programs) {
    programs = new WeakMap();
    nodePortProcessFacts.set(environment.scopes, programs);
  }
  let filenames = programs.get(environment.program);
  if (!filenames) {
    filenames = new Map();
    programs.set(environment.program, filenames);
  }
  const generation = getManifestCacheGeneration();
  const aliasGeneration = getTsconfigAliasCacheGeneration();
  const resolutionGeneration = getModuleResolutionCacheGeneration();
  const parserGeneration = getParseSourceFileCacheGeneration();
  let facts = filenames.get(environment.filename);
  if (
    !facts ||
    facts.generation !== generation ||
    facts.aliasGeneration !== aliasGeneration ||
    facts.resolutionGeneration !== resolutionGeneration ||
    facts.parserGeneration !== parserGeneration
  ) {
    facts = {
      generation,
      aliasGeneration,
      resolutionGeneration,
      parserGeneration,
      origins: new Map(),
      providerBodies: new Map(),
    };
    filenames.set(environment.filename, facts);
  }
  return facts;
};

const directCall = (
  node: EsTreeNode | null | undefined,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!node) return null;
  const candidate = stripParenExpression(node);
  return isNodeOfType(candidate, "CallExpression") &&
    !candidate.optional &&
    candidate.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
    ? candidate
    : null;
};

const member = (
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

const sameBinding = (
  node: EsTreeNode | null | undefined,
  symbol: SymbolDescriptor,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(node && isNodeOfType(node, "Identifier") && scopes.symbolFor(node) === symbol);

const genuineGlobal = (
  node: EsTreeNode | null | undefined,
  name: string,
  scopes: ScopeAnalysis,
): boolean =>
  Boolean(
    node &&
    isNodeOfType(node, "Identifier") &&
    node.name === name &&
    scopes.isGlobalReference(node),
  );

const closedReferences = (
  symbol: SymbolDescriptor,
  environment: NodePortProcessEnvironment,
  allowed: ReadonlySet<EsTreeNode>,
): boolean =>
  hasCompleteSymbolReferences(symbol, environment.program, environment.scopes) &&
  symbol.references.every(
    (reference) =>
      isNonReferenceIdentifier(reference.identifier) ||
      (reference.flag === "read" &&
        !isWithinAssignmentTarget(reference.identifier) &&
        allowed.has(reference.identifier)),
  );

const requireSource = (node: EsTreeNode, scopes: ScopeAnalysis): string | null => {
  const call = directCall(node);
  if (
    !call ||
    call.arguments.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
    !genuineGlobal(call.callee, "require", scopes)
  )
    return null;
  return getGlobalRequireModuleSource(call, scopes);
};

const isNativeJsonPath = (node: EsTreeNode, environment: NodePortProcessEnvironment): boolean => {
  if (!isNodeOfType(node, "Identifier")) return false;
  const symbol = environment.scopes.symbolFor(node);
  const call =
    symbol?.kind === "const" && symbol.initializer ? directCall(symbol.initializer) : null;
  const join = call ? member(call.callee, "join") : null;
  const namespaceSource = (
    reference: EsTreeNode,
    source: string,
    propertyName: string,
  ): boolean => {
    if (!isNodeOfType(reference, "Identifier")) return false;
    const binding = environment.scopes.symbolFor(reference);
    if (
      binding?.kind !== "const" ||
      !binding.initializer ||
      requireSource(binding.initializer, environment.scopes) !== source ||
      resolveModulePath(environment.filename, source) ||
      !hasCompleteSymbolReferences(binding, environment.program, environment.scopes)
    )
      return false;
    return binding.references.every((use) => {
      if (isNonReferenceIdentifier(use.identifier)) return true;
      const property = member(use.identifier.parent, propertyName);
      const invocation = property ? directCall(property.parent) : null;
      return (
        use.flag === "read" &&
        !isWithinAssignmentTarget(use.identifier) &&
        property?.object === use.identifier &&
        invocation?.callee === property
      );
    });
  };
  if (
    !symbol ||
    !call ||
    !join ||
    !namespaceSource(join.object, "path", "join") ||
    !hasCompleteSymbolReferences(symbol, environment.program, environment.scopes) ||
    !symbol.references.every(
      (use) => use.flag === "read" && !isWithinAssignmentTarget(use.identifier),
    )
  )
    return false;
  const [home, filename, extra] = call.arguments;
  const homeCall = home ? directCall(home) : null;
  const homedir = homeCall ? member(homeCall.callee, "homedir") : null;
  return Boolean(
    !extra &&
    homedir &&
    homeCall &&
    !homeCall.arguments.length &&
    namespaceSource(homedir.object, "os", "homedir") &&
    isNodeOfType(filename, "Literal") &&
    typeof filename.value === "string" &&
    filename.value.endsWith(".json"),
  );
};

interface ClosedNodeProviderValidator {
  readonly inspect: (node: EsTreeNode) => boolean | void;
  readonly isClosed: () => boolean;
}

const createClosedNodeProviderValidator = (
  environment: NodePortProcessEnvironment,
): ClosedNodeProviderValidator => {
  const clearedProperties = new Set<string>();
  const scheduledProperties = new Set<string>();
  const allowedTimerReferences = new Set<EsTreeNode>();
  const timerReferences = new Set<EsTreeNode>();
  let valid = true;
  const inspectTimer = (node: EsTreeNode): boolean | void => {
    if (!valid) return false;
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (
      (node.name === "setInterval" || node.name === "clearInterval") &&
      environment.scopes.isGlobalReference(node)
    )
      timerReferences.add(node);
    if (!genuineGlobal(node, "global", environment.scopes)) return;
    const property = node.parent;
    if (
      !isNodeOfType(property, "MemberExpression") ||
      property.object !== node ||
      property.computed ||
      property.optional
    ) {
      valid = false;
      return false;
    }
    const propertyName = getStaticPropertyKeyName(property);
    if (
      !propertyName ||
      NODE_PORT_PROCESS_CAPABILITY_NAMES.has(propertyName) ||
      NODE_PORT_PROCESS_CAPABILITY_MEMBER_NAMES.has(propertyName) ||
      NODE_PORT_PROCESS_GLOBAL_NAMES.has(propertyName) ||
      BUILTIN_GLOBAL_NAMESPACE_NAMES.has(propertyName) ||
      NODE_PORT_PROCESS_TIMER_RESERVED_NAMES.has(propertyName)
    ) {
      valid = false;
      return false;
    }
    const clear = directCall(property.parent);
    if (
      clear &&
      genuineGlobal(clear.callee, "clearInterval", environment.scopes) &&
      clear.arguments.length === NODE_PORT_PROCESS_SINGLE_VALUE_COUNT &&
      clear.arguments[0] === property
    ) {
      clearedProperties.add(propertyName);
      allowedTimerReferences.add(clear.callee);
      return;
    }
    const assignment = property.parent;
    const schedule =
      isNodeOfType(assignment, "AssignmentExpression") &&
      assignment.operator === "=" &&
      assignment.left === property
        ? directCall(assignment.right)
        : null;
    const callback = schedule?.arguments[0];
    const delay = schedule?.arguments[1];
    if (
      !schedule ||
      !genuineGlobal(schedule.callee, "setInterval", environment.scopes) ||
      schedule.arguments.length !== NODE_PORT_PROCESS_TIMER_ARGUMENT_COUNT ||
      !isFunctionLike(callback) ||
      callback.generator ||
      callback.params.length ||
      !isNodeOfType(delay, "Literal") ||
      typeof delay.value !== "number" ||
      !Number.isFinite(delay.value) ||
      delay.value < 0
    ) {
      valid = false;
      return false;
    }
    scheduledProperties.add(propertyName);
    allowedTimerReferences.add(schedule.callee);
  };
  const inspectProvider = (node: EsTreeNode): boolean | void => {
    if (!valid) return false;
    if (
      isNodeOfType(node, "ThisExpression") ||
      (isNodeOfType(node, "Property") && node.kind !== "init") ||
      isNodeOfType(node, "ClassDeclaration") ||
      isNodeOfType(node, "ClassExpression")
    ) {
      valid = false;
      return false;
    }
    if (
      node.type.startsWith("TS") ||
      node.type.startsWith("JSX") ||
      isNodeOfType(node, "ImportExpression") ||
      isNodeOfType(node, "WithStatement") ||
      isNodeOfType(node, "TaggedTemplateExpression")
    ) {
      valid = false;
      return false;
    }
    if (
      ((isNodeOfType(node, "MemberExpression") || isNodeOfType(node, "Property")) &&
        NODE_PORT_PROCESS_CAPABILITY_MEMBER_NAMES.has(
          getStaticPropertyKeyName(node, { allowComputedString: true }) ?? "",
        )) ||
      (isNodeOfType(node, "Property") && node.computed) ||
      (isNodeOfType(node, "MemberExpression") &&
        node.computed &&
        (!isNodeOfType(node.property, "Literal") ||
          typeof node.property.value !== "number" ||
          !Number.isSafeInteger(node.property.value) ||
          node.property.value < 0))
    ) {
      valid = false;
      return false;
    }
    if (
      isNodeOfType(node, "ImportDeclaration") &&
      node.importKind !== "type" &&
      NODE_PORT_PROCESS_PROVIDER_METHODS.has(String(node.source.value))
    ) {
      valid = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier") || isNonReferenceIdentifier(node)) return;
    if (
      environment.scopes.isGlobalReference(node) &&
      !NODE_PORT_PROCESS_CONSUMER_GLOBAL_NAMES.has(node.name)
    ) {
      valid = false;
      return false;
    }
    if (NODE_PORT_PROCESS_CAPABILITY_NAMES.has(node.name)) {
      valid = false;
      return false;
    }
    if (node.name === "console" && environment.scopes.isGlobalReference(node)) {
      const property = member(node.parent, "log");
      const call = property ? directCall(property.parent) : null;
      if (!call || call.callee !== property || isWithinAssignmentTarget(node)) {
        valid = false;
        return false;
      }
    }
    if (
      node.name === "Promise" &&
      environment.scopes.isGlobalReference(node) &&
      (!isNodeOfType(node.parent, "NewExpression") || node.parent.callee !== node)
    ) {
      valid = false;
      return false;
    }
    if (
      node.name === "module" &&
      environment.scopes.isGlobalReference(node) &&
      !member(node.parent, "exports")
    ) {
      valid = false;
      return false;
    }
    if (node.name === "require" && environment.scopes.isGlobalReference(node)) {
      const call = directCall(node.parent);
      if (
        !call ||
        call.callee !== node ||
        call.arguments.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT
      ) {
        valid = false;
        return false;
      }
      const [argument] = call.arguments;
      if (!isNodeOfType(argument, "Literal") && !isNativeJsonPath(argument, environment)) {
        valid = false;
        return false;
      }
      const source = requireSource(call, environment.scopes);
      if (
        source &&
        (NODE_PORT_PROCESS_LOADER_SOURCES.has(source) ||
          [...NODE_PORT_PROCESS_PROVIDER_METHODS.keys()].some((provider) =>
            source.startsWith(`${provider}/`),
          ))
      ) {
        valid = false;
        return false;
      }
      if (
        source &&
        NODE_PORT_PROCESS_PROVIDER_METHODS.has(source) &&
        (!isNodeOfType(call.parent, "VariableDeclarator") ||
          call.parent.init !== call ||
          !isNodeOfType(call.parent.id, "Identifier"))
      ) {
        valid = false;
        return false;
      }
    }
    if (node.name === "process" && environment.scopes.isGlobalReference(node)) {
      const property = member(node.parent, "cwd");
      const call = property ? directCall(property.parent) : null;
      if (!call || call.callee !== property || call.arguments.length) valid = false;
    }
    if (
      !isNodeOfType(node.parent, "VariableDeclarator") ||
      node.parent.id !== node ||
      !node.parent.init
    )
      return;
    const source = requireSource(node.parent.init, environment.scopes);
    const methods = source ? NODE_PORT_PROCESS_PROVIDER_METHODS.get(source) : undefined;
    if (!source || !methods) return;
    if (resolveModulePath(environment.filename, source)) {
      valid = false;
      return false;
    }
    const symbol = environment.scopes.symbolFor(node);
    if (
      symbol?.kind !== "const" ||
      !hasCompleteSymbolReferences(symbol, environment.program, environment.scopes)
    ) {
      valid = false;
      return false;
    }
    for (const reference of symbol.references) {
      if (isNonReferenceIdentifier(reference.identifier)) continue;
      const property = reference.identifier.parent;
      if (!methods.size) {
        const call = directCall(property);
        if (
          reference.flag !== "read" ||
          isWithinAssignmentTarget(reference.identifier) ||
          !call ||
          call.callee !== reference.identifier
        )
          valid = false;
        continue;
      }
      const call = property ? directCall(property.parent) : null;
      if (
        reference.flag !== "read" ||
        isWithinAssignmentTarget(reference.identifier) ||
        !property ||
        !isNodeOfType(property, "MemberExpression") ||
        property.object !== reference.identifier ||
        property.computed ||
        property.optional ||
        !methods.has(getStaticPropertyKeyName(property) ?? "") ||
        !call ||
        call.callee !== property
      ) {
        valid = false;
        break;
      }
    }
  };
  return {
    inspect: (node) => {
      if (!valid) return false;
      switch (node.type) {
        case "Identifier":
          if (inspectTimer(node) === false) return false;
          return inspectProvider(node);
        case "ThisExpression":
        case "Property":
        case "ClassDeclaration":
        case "ClassExpression":
        case "ImportExpression":
        case "WithStatement":
        case "TaggedTemplateExpression":
        case "MemberExpression":
        case "ImportDeclaration":
          return inspectProvider(node);
        default:
          if (node.type.startsWith("TS") || node.type.startsWith("JSX")) {
            return inspectProvider(node);
          }
      }
    },
    isClosed: () =>
      valid &&
      [...clearedProperties].every((property) => scheduledProperties.has(property)) &&
      [...scheduledProperties].every((property) => clearedProperties.has(property)) &&
      [...timerReferences].every(
        (reference) =>
          !isWithinAssignmentTarget(reference) && allowedTimerReferences.has(reference),
      ),
  };
};

const hasClosedNodeProviders = (environment: NodePortProcessEnvironment): boolean => {
  const validator = createClosedNodeProviderValidator(environment);
  walkAst(environment.program, validator.inspect);
  return validator.isClosed();
};

const hasPortProcessBody = (environment: NodePortProcessEnvironment): boolean => {
  const imports = new Map<string, SymbolDescriptor>();
  const importCalls = new Set<EsTreeNode>();
  let factory: EsTreeNodeOfType<"ArrowFunctionExpression"> | null = null;
  let factorySymbol: SymbolDescriptor | undefined;
  let exportAssignment: EsTreeNodeOfType<"AssignmentExpression"> | null = null;
  for (const statement of environment.program.body) {
    if (exportAssignment) return false;
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.kind === "const" &&
      statement.declarations.length === NODE_PORT_PROCESS_SINGLE_VALUE_COUNT
    ) {
      const [declaration] = statement.declarations;
      if (!isNodeOfType(declaration.id, "Identifier") || !declaration.init) return false;
      const symbol = environment.scopes.symbolFor(declaration.id);
      if (!symbol) return false;
      const source = requireSource(declaration.init, environment.scopes);
      if (source) {
        if (
          imports.has(source) ||
          !NODE_PORT_PROCESS_PROVIDER_METHODS.has(source) ||
          resolveModulePath(environment.filename, source)
        )
          return false;
        imports.set(source, symbol);
        importCalls.add(declaration.init);
      } else if (
        !factory &&
        isNodeOfType(declaration.init, "ArrowFunctionExpression") &&
        declaration.init.async &&
        !declaration.init.generator
      ) {
        factory = declaration.init;
        factorySymbol = symbol;
      } else return false;
      continue;
    }
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      isNodeOfType(statement.expression, "AssignmentExpression") &&
      statement.expression.operator === "=" &&
      !exportAssignment
    ) {
      const target = member(statement.expression.left, "exports");
      if (!target || !genuineGlobal(target.object, "module", environment.scopes)) return false;
      exportAssignment = statement.expression;
    } else return false;
  }
  if (
    !factory ||
    !factorySymbol ||
    !exportAssignment ||
    !sameBinding(exportAssignment.right, factorySymbol, environment.scopes) ||
    !closedReferences(factorySymbol, environment, new Set([exportAssignment.right])) ||
    imports.size !== NODE_PORT_PROCESS_MODULE_COUNT ||
    ![...NODE_PORT_PROCESS_REQUIRED_SOURCES].every((source) => imports.has(source)) ||
    factory.params.length !== NODE_PORT_PROCESS_ARGUMENT_COUNT ||
    !isNodeOfType(factory.body, "BlockStatement") ||
    factory.body.body.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT
  )
    return false;
  const [pathParameter, commandParameter, portParameter] = factory.params;
  if (
    !isNodeOfType(pathParameter, "Identifier") ||
    !isNodeOfType(commandParameter, "Identifier") ||
    !isNodeOfType(portParameter, "AssignmentPattern") ||
    !isNodeOfType(portParameter.left, "Identifier") ||
    !isNodeOfType(portParameter.right, "Literal") ||
    typeof portParameter.right.value !== "number"
  )
    return false;
  const pathSymbol = environment.scopes.symbolFor(pathParameter);
  const commandSymbol = environment.scopes.symbolFor(commandParameter);
  const requestedPortSymbol = environment.scopes.symbolFor(portParameter.left);
  const [returned] = factory.body.body;
  if (
    !pathSymbol ||
    !commandSymbol ||
    !requestedPortSymbol ||
    !isNodeOfType(returned, "ReturnStatement") ||
    !isNodeOfType(returned.argument, "NewExpression") ||
    !genuineGlobal(returned.argument.callee, "Promise", environment.scopes) ||
    returned.argument.arguments.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT
  )
    return false;
  const [executor] = returned.argument.arguments;
  if (
    !isNodeOfType(executor, "ArrowFunctionExpression") ||
    !executor.async ||
    executor.generator ||
    executor.params.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
    !isNodeOfType(executor.body, "BlockStatement")
  )
    return false;
  const [resolveParameter] = executor.params;
  const resolveSymbol = isNodeOfType(resolveParameter, "Identifier")
    ? environment.scopes.symbolFor(resolveParameter)
    : undefined;
  if (!resolveSymbol) return false;
  const allowedFunctions = new Set<EsTreeNode>([factory, executor]);
  const allowedCalls = new Set<EsTreeNode>();
  const allowedAwaits = new Set<EsTreeNode>();
  const allowedMembers = new Set<EsTreeNode>([exportAssignment.left]);
  const allowedAssignments = new Set<EsTreeNode>([exportAssignment]);
  const allowedImportReferences = new Map<SymbolDescriptor, Set<EsTreeNode>>();
  for (const symbol of imports.values()) allowedImportReferences.set(symbol, new Set());
  const allowedResolveReferences = new Set<EsTreeNode>();
  let allocatedPort: SymbolDescriptor | undefined;
  let childProcess: SymbolDescriptor | undefined;
  let errorParameter: SymbolDescriptor | undefined;
  let dataParameter: SymbolDescriptor | undefined;
  let trimmedParameter: SymbolDescriptor | undefined;
  let valid = true;
  const acceptMember = (node: EsTreeNodeOfType<"MemberExpression">): void => {
    allowedMembers.add(node);
  };
  const providerNodes: EsTreeNode[] = [];
  walkAst(environment.program, (node) => {
    if (!valid) return;
    providerNodes.push(node);
    if (!isNodeOfType(node, "CallExpression")) return;
    const call = directCall(node);
    if (!call) {
      valid = false;
      return;
    }
    if (requireSource(call, environment.scopes)) {
      if (!importCalls.has(call)) {
        valid = false;
        return;
      }
      allowedCalls.add(call);
      return;
    }
    const imported = isNodeOfType(call.callee, "Identifier")
      ? environment.scopes.symbolFor(call.callee)
      : undefined;
    if (imported && imported === imports.get("use-port")) {
      const [argument] = call.arguments;
      const awaited = call.parent;
      const declaration = awaited?.parent;
      if (
        allocatedPort ||
        call.arguments.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
        !sameBinding(argument, requestedPortSymbol, environment.scopes) ||
        !isNodeOfType(awaited, "AwaitExpression") ||
        !isNodeOfType(declaration, "VariableDeclarator") ||
        declaration.init !== awaited ||
        !isNodeOfType(declaration.id, "Identifier") ||
        !isNodeOfType(declaration.parent, "VariableDeclaration") ||
        declaration.parent.kind !== "const"
      ) {
        valid = false;
        return;
      }
      allocatedPort = environment.scopes.symbolFor(declaration.id) ?? undefined;
      allowedAwaits.add(awaited);
      allowedImportReferences.get(imported)?.add(call.callee);
      allowedCalls.add(call);
      return;
    }
    if (imported && imported === imports.get("execa")) {
      const [command, argumentsList, options, extra] = call.arguments;
      const declaration = call.parent;
      if (
        childProcess ||
        extra ||
        !isNodeOfType(command, "Literal") ||
        typeof command.value !== "string" ||
        !isNodeOfType(argumentsList, "ArrayExpression") ||
        !isNodeOfType(options, "ObjectExpression") ||
        options.properties.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
        !isNodeOfType(declaration, "VariableDeclarator") ||
        !isNodeOfType(declaration.id, "Identifier") ||
        !isNodeOfType(declaration.parent, "VariableDeclaration") ||
        declaration.parent.kind !== "const"
      ) {
        valid = false;
        return;
      }
      const [option] = options.properties;
      if (
        !isNodeOfType(option, "Property") ||
        option.computed ||
        option.kind !== "init" ||
        option.method ||
        getStaticPropertyKeyName(option) !== "cwd" ||
        !isNodeOfType(option.value, "LogicalExpression") ||
        option.value.operator !== "||" ||
        !sameBinding(option.value.left, pathSymbol, environment.scopes) ||
        !argumentsList.elements.every((element) =>
          Boolean(
            element &&
            ((isNodeOfType(element, "Literal") &&
              (typeof element.value === "string" || typeof element.value === "number")) ||
              (allocatedPort && sameBinding(element, allocatedPort, environment.scopes)) ||
              (isNodeOfType(element, "SpreadElement") &&
                sameBinding(element.argument, commandSymbol, environment.scopes))),
          ),
        )
      ) {
        valid = false;
        return;
      }
      const fallback = directCall(option.value.right);
      const fallbackMember = fallback ? member(fallback.callee, "cwd") : null;
      if (
        !fallback ||
        fallback.arguments.length ||
        !fallbackMember ||
        !genuineGlobal(fallbackMember.object, "process", environment.scopes)
      ) {
        valid = false;
        return;
      }
      childProcess = environment.scopes.symbolFor(declaration.id) ?? undefined;
      allowedImportReferences.get(imported)?.add(call.callee);
      allowedCalls.add(call);
      return;
    }
    if (sameBinding(call.callee, resolveSymbol, environment.scopes)) {
      const [value] = call.arguments;
      const portSymbol = allocatedPort;
      if (
        !portSymbol ||
        call.arguments.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
        !isNodeOfType(value, "TemplateLiteral") ||
        value.expressions.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
        !value.expressions.every((expression) =>
          sameBinding(expression, portSymbol, environment.scopes),
        )
      ) {
        valid = false;
        return;
      }
      allowedResolveReferences.add(call.callee);
      allowedCalls.add(call);
      return;
    }
    if (
      !isNodeOfType(call.callee, "MemberExpression") ||
      call.callee.computed ||
      call.callee.optional
    ) {
      valid = false;
      return;
    }
    const property = call.callee;
    const propertyName = getStaticPropertyKeyName(property);
    const receiver = property.object;
    const receiverSymbol = isNodeOfType(receiver, "Identifier")
      ? environment.scopes.symbolFor(receiver)
      : undefined;
    const importedMethods = receiverSymbol
      ? allowedImportReferences.get(receiverSymbol)
      : undefined;
    if (
      (receiverSymbol === imports.get("fs") &&
        propertyName === "existsSync" &&
        call.arguments.length === NODE_PORT_PROCESS_SINGLE_VALUE_COUNT &&
        call.arguments.every((argument) =>
          sameBinding(argument, pathSymbol, environment.scopes),
        )) ||
      (receiverSymbol === imports.get("chalk") &&
        (propertyName === "red" || propertyName === "yellow") &&
        call.arguments.length === NODE_PORT_PROCESS_SINGLE_VALUE_COUNT)
    ) {
      importedMethods?.add(receiver);
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    if (
      (genuineGlobal(receiver, "console", environment.scopes) && propertyName === "log") ||
      (genuineGlobal(receiver, "process", environment.scopes) &&
        propertyName === "cwd" &&
        !call.arguments.length)
    ) {
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    const stdout = member(receiver, "stdout");
    if (
      childProcess &&
      propertyName === "on" &&
      (sameBinding(receiver, childProcess, environment.scopes) ||
        (stdout && sameBinding(stdout.object, childProcess, environment.scopes)))
    ) {
      const [event, callback, extra] = call.arguments;
      if (
        extra ||
        !isNodeOfType(event, "Literal") ||
        event.value !== (stdout ? "data" : "error") ||
        !isFunctionLike(callback) ||
        callback.async ||
        callback.generator ||
        callback.params.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
        !isNodeOfType(callback.body, "BlockStatement")
      ) {
        valid = false;
        return;
      }
      const [parameter] = callback.params;
      const symbol = isNodeOfType(parameter, "Identifier")
        ? environment.scopes.symbolFor(parameter)
        : undefined;
      if (!symbol || (stdout ? dataParameter : errorParameter)) {
        valid = false;
        return;
      }
      if (stdout) {
        dataParameter = symbol;
        acceptMember(stdout);
      } else errorParameter = symbol;
      allowedFunctions.add(callback);
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    if (
      sameBinding(receiver, commandSymbol, environment.scopes) &&
      propertyName === "split" &&
      call.arguments.length === NODE_PORT_PROCESS_SINGLE_VALUE_COUNT &&
      call.arguments.every(
        (argument) => isNodeOfType(argument, "Literal") && typeof argument.value === "string",
      )
    ) {
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    if (
      propertyName === "filter" &&
      directCall(receiver) &&
      member(directCall(receiver)?.callee, "split")
    ) {
      const [callback] = call.arguments;
      if (
        trimmedParameter ||
        call.arguments.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
        !isNodeOfType(callback, "ArrowFunctionExpression") ||
        callback.async ||
        callback.params.length !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT
      ) {
        valid = false;
        return;
      }
      const [parameter] = callback.params;
      trimmedParameter = isNodeOfType(parameter, "Identifier")
        ? (environment.scopes.symbolFor(parameter) ?? undefined)
        : undefined;
      const trim = directCall(callback.body);
      const trimMember = trim ? member(trim.callee, "trim") : null;
      if (
        !trimmedParameter ||
        !trim ||
        trim.arguments.length ||
        !trimMember ||
        !sameBinding(trimMember.object, trimmedParameter, environment.scopes)
      ) {
        valid = false;
        return;
      }
      allowedFunctions.add(callback);
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    if (
      (trimmedParameter &&
        sameBinding(receiver, trimmedParameter, environment.scopes) &&
        propertyName === "trim" &&
        !call.arguments.length) ||
      (dataParameter &&
        sameBinding(receiver, dataParameter, environment.scopes) &&
        propertyName === "toString" &&
        !call.arguments.length)
    ) {
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    if (
      propertyName === "replace" &&
      directCall(receiver) &&
      member(directCall(receiver)?.callee, "toString")
    ) {
      const [pattern, replacement, extra] = call.arguments;
      if (
        extra ||
        !isNodeOfType(pattern, "Literal") ||
        !("regex" in pattern) ||
        !pattern.regex ||
        !isNodeOfType(replacement, "Literal") ||
        typeof replacement.value !== "string"
      ) {
        valid = false;
        return;
      }
      acceptMember(property);
      allowedCalls.add(call);
      return;
    }
    valid = false;
  });
  if (
    !valid ||
    !allocatedPort ||
    !childProcess ||
    !errorParameter ||
    !dataParameter ||
    !trimmedParameter ||
    !allowedResolveReferences.size
  )
    return false;
  const providerValidator = createClosedNodeProviderValidator(environment);
  for (const node of providerNodes) {
    if (!valid) break;
    if (providerValidator.inspect(node) === false) {
      valid = false;
      break;
    }
    switch (node.type) {
      case "MemberExpression":
        if (
          errorParameter &&
          member(node, "code") &&
          sameBinding(node.object, errorParameter, environment.scopes)
        )
          allowedMembers.add(node);
        if (!allowedMembers.has(node)) valid = false;
        break;
      case "AssignmentExpression": {
        if (node.operator === "=" && sameBinding(node.left, commandSymbol, environment.scopes)) {
          const filtered = directCall(node.right);
          if (filtered && allowedCalls.has(filtered) && member(filtered.callee, "filter"))
            allowedAssignments.add(node);
        }
        if (!allowedAssignments.has(node)) valid = false;
        break;
      }
      case "ArrowFunctionExpression":
      case "FunctionExpression":
      case "FunctionDeclaration":
        if (!allowedFunctions.has(node)) valid = false;
        break;
      case "CallExpression":
        if (!allowedCalls.has(node)) valid = false;
        break;
      case "NewExpression":
        if (node !== returned.argument) valid = false;
        break;
      case "AwaitExpression":
        if (!allowedAwaits.has(node)) valid = false;
        break;
      case "UpdateExpression":
      case "YieldExpression":
        valid = false;
        break;
      case "Identifier": {
        if (isNonReferenceIdentifier(node)) break;
        if (
          environment.scopes.isGlobalReference(node) &&
          !NODE_PORT_PROCESS_GLOBAL_NAMES.has(node.name)
        )
          valid = false;
        const symbol = environment.scopes.symbolFor(node);
        if (symbol && !hasCompleteSymbolReferences(symbol, environment.program, environment.scopes))
          valid = false;
        if (symbol && symbol !== commandSymbol) {
          const referenceFlag = environment.scopes.referenceFor(node)?.flag;
          if (referenceFlag !== undefined && referenceFlag !== "read") valid = false;
        }
        break;
      }
    }
  }
  return (
    valid &&
    providerValidator.isClosed() &&
    closedReferences(resolveSymbol, environment, allowedResolveReferences) &&
    [...allowedImportReferences].every(([symbol, references]) =>
      closedReferences(symbol, environment, references),
    )
  );
};

const hasNodePortProcessOrigin = (
  symbol: SymbolDescriptor,
  source: string,
  environment: NodePortProcessEnvironment,
  facts: NodePortProcessFacts,
): boolean => {
  const { filename } = environment;
  if (!symbol.initializer) return false;
  const references = new Set<EsTreeNode>();
  for (const reference of symbol.references) {
    const use = directCall(reference.identifier.parent);
    if (!use || use.callee !== reference.identifier) return false;
    references.add(reference.identifier);
  }
  if (!closedReferences(symbol, environment, references)) return false;
  const extension = path.extname(source);
  if (extension && extension !== ".js") return false;
  const filePath = resolveModulePath(filename, source);
  const expectedPath = path.resolve(path.dirname(filename), extension ? source : `${source}.js`);
  if (!filePath || filePath !== expectedPath) return false;
  const manifest = readNearestPackageManifest(filePath);
  if (
    !manifest ||
    ("type" in manifest && manifest.type !== "commonjs") ||
    typeof manifest.dependencies?.["use-port"] !== "string"
  )
    return false;
  const declarations = [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ];
  if (
    ![...NODE_PORT_PROCESS_REQUIRED_SOURCES].every(
      (source) =>
        source === "fs" ||
        declarations.every((declaration) => {
          const version = declaration?.[source];
          return (
            version === undefined ||
            (typeof version === "string" &&
              Boolean(
                parsePackageVersion(
                  version.trim().replace(NODE_PORT_PROCESS_RANGE_PREFIX_PATTERN, ""),
                ),
              ))
          );
        }),
    )
  )
    return false;
  if (!facts.exposures) {
    facts.exposures = captureCrossFileProbes(() => {
      const exposures = new Map<string, Set<EsTreeNode>>();
      walkAst(environment.program, (node) => {
        const moduleSource =
          isNodeOfType(node, "ImportDeclaration") &&
          node.importKind !== "type" &&
          typeof node.source.value === "string"
            ? node.source.value
            : isNodeOfType(node, "CallExpression")
              ? requireSource(node, environment.scopes)
              : null;
        if (!moduleSource || (!moduleSource.startsWith("./") && !moduleSource.startsWith("../")))
          return;
        const resolved = resolveModulePath(filename, moduleSource);
        if (!resolved) return;
        let references = exposures.get(resolved);
        if (!references) {
          references = new Set();
          exposures.set(resolved, references);
        }
        references.add(node);
      });
      return exposures;
    });
  }
  const exposures = facts.exposures?.value.get(filePath);
  if (
    exposures?.size !== NODE_PORT_PROCESS_SINGLE_VALUE_COUNT ||
    !exposures.has(symbol.initializer)
  )
    return false;
  let supported = facts.providerBodies.get(filePath);
  if (supported) {
    replayCrossFileProbes(supported.trace);
    return supported.value;
  }
  supported = captureCrossFileProbes(() => {
    const provider = parseSourceFile(filePath);
    return (
      isNodeOfType(provider, "Program") &&
      hasPortProcessBody({
        program: provider,
        scopes: analyzeScopes(provider),
        filename: filePath,
      })
    );
  });
  facts.providerBodies.set(filePath, supported);
  return supported.value;
};

export const isImportedNodePortProcessUtility = (
  call: EsTreeNodeOfType<"CallExpression">,
  context: Pick<RuleContext, "filename" | "scopes">,
): boolean => {
  const selectedCall = directCall(call);
  const filename = context.filename;
  if (
    !filename ||
    !selectedCall ||
    !isNodeOfType(selectedCall.callee, "Identifier") ||
    selectedCall.arguments.length !== NODE_PORT_PROCESS_ARGUMENT_COUNT
  )
    return false;
  const [, , port] = selectedCall.arguments;
  if (
    !isNodeOfType(port, "Literal") ||
    typeof port.value !== "number" ||
    !Number.isFinite(port.value)
  )
    return false;
  const program = findProgramRoot(call);
  const symbol = context.scopes.symbolFor(selectedCall.callee);
  if (!program || symbol?.kind !== "const" || !symbol.initializer) return false;
  const source = requireSource(symbol.initializer, context.scopes);
  if (!source || (!source.startsWith("./") && !source.startsWith("../"))) return false;
  const environment = { program, scopes: context.scopes, filename: filename };
  const facts = getNodePortProcessFacts(environment);
  if (!facts.closedProviders)
    facts.closedProviders = captureCrossFileProbes(() => hasClosedNodeProviders(environment));
  replayCrossFileProbes(facts.closedProviders.trace);
  if (!facts.closedProviders.value) return false;
  const cached = facts.origins.get(symbol);
  if (cached) {
    replayCrossFileProbes(cached.trace);
    if (facts.exposures) replayCrossFileProbes(facts.exposures.trace);
    return cached.value;
  }
  const supported = captureCrossFileProbes(() =>
    hasNodePortProcessOrigin(symbol, source, environment, facts),
  );
  facts.origins.set(symbol, supported);
  if (facts.exposures) replayCrossFileProbes(facts.exposures.trace);
  return supported.value;
};
