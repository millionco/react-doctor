import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { SourceProjectIndex, SourceProjectModule } from "../build-source-project-index.js";
import type { EsTreeNode } from "../es-tree-node.js";
import type { EsTreeNodeOfType } from "../es-tree-node-of-type.js";
import { findExportedValue } from "../find-exported-value.js";
import { findEnclosingFunction } from "../find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../find-transparent-expression-root.js";
import { getClassBindingSymbol } from "../get-class-binding-symbol.js";
import { getDirectConstInitializer } from "../get-direct-const-initializer.js";
import { getImportDeclarationForSymbol } from "../get-import-declaration-for-symbol.js";
import { getResolvedStaticPropertyName } from "../get-resolved-static-property-name.js";
import { getRuntimeStaticDependencySource } from "../get-runtime-static-dependency-source.js";
import { getSingleReturnExpression } from "../get-single-return-expression.js";
import { getStaticStringExpression } from "../get-static-string-expression.js";
import { isFunctionLike } from "../is-function-like.js";
import { isAstDescendant } from "../is-ast-descendant.js";
import { isReactHookResultReference } from "../is-react-hook-result-reference.js";
import { isReactApiCall } from "../is-react-api-call.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isProvenGlobalNamespaceReference } from "../is-proven-global-namespace-reference.js";
import { isTypeOnlyImport } from "../is-type-only-import.js";
import { resolveImportedExportName } from "../find-exported-function-body.js";
import { stripParenExpression } from "../strip-paren-expression.js";
import { resolveExactLocalFunction } from "../resolve-exact-local-function.js";
import { walkAst } from "../walk-ast.js";
import {
  certifyOwnedRendererBuilder,
  type OwnedRendererBuilderCertificate,
  type OwnedRendererBuilderCallback,
} from "./certify-owned-renderer-builder.js";
import { hasSupportedReadonlySourcePrototypeRole } from "./has-modern-source-scheduling-role.js";
import { isSupportedRuntimeScopeNode } from "./is-supported-runtime-scope-node.js";
import { READONLY_SOURCE_PROTOTYPE_MAX_WORK_STEPS } from "./readonly-source-prototype/constants.js";
import {
  NATIVE_DELAY_MAX_ALIAS_DEPTH,
  NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT,
} from "./native-signal-delay/constants.js";

interface ReadonlyPrototypeConstructor {
  classNode: EsTreeNodeOfType<"ClassExpression" | "ClassDeclaration"> | null;
  module: SourceProjectModule;
  source: string | null;
  exportName: string | null;
}

interface ReadonlyPrototypeCall {
  constructor: EsTreeNode;
  methodName: string;
  call: EsTreeNodeOfType<"CallExpression">;
}

interface ReadonlyPrototypeProof {
  project: SourceProjectIndex;
  methodName: string;
  steps: number;
  failed: boolean;
  bySymbol: Map<SymbolDescriptor, ReadonlyPrototypeConstructor | null>;
  byClass: Map<EsTreeNode, ReadonlyPrototypeConstructor>;
  sdkCapabilities: Map<SymbolDescriptor, ReadonlySdkCapability | null>;
  sdkInstances: Map<SymbolDescriptor, EsTreeNode | null>;
  rendererCallbacks: Set<EsTreeNode>;
  ownedBuilders: Map<EsTreeNode, OwnedRendererBuilderCertificate | null>;
  selectedConstructor: ReadonlyPrototypeConstructor | null;
  callbackGlobals: Set<string>;
  globalWrites: Set<string>;
}

interface ReadonlySdkCapability {
  source: string;
  exportName: string | null;
  module: SourceProjectModule;
}

const MARKED_BOOLEAN_OPTIONS = new Set(["async", "breaks", "gfm", "pedantic", "silent"]);
const MARKED_CALLBACK_NATIVE_MEMBERS = new Set([
  "constructor",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "current",
  "signal",
  "aborted",
  "abort",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "defaultView",
]);
const MARKED_CALLBACK_REF_HOOKS = new Set(["useRef", "createRef"]);
const MARKED_CALLBACK_STATE_HOOKS = new Set(["useState", "useReducer"]);

const spendPrototypeStep = (proof: ReadonlyPrototypeProof): boolean => {
  proof.steps += 1;
  if (proof.steps <= READONLY_SOURCE_PROTOTYPE_MAX_WORK_STEPS) return true;
  proof.failed = true;
  return false;
};

const isReadonlyBinding = (symbol: SymbolDescriptor): boolean =>
  symbol.references.every((reference) => reference.flag === "read");

const sameConstructor = (
  left: ReadonlyPrototypeConstructor | null,
  right: ReadonlyPrototypeConstructor,
): boolean =>
  Boolean(
    left &&
    (right.classNode
      ? left.classNode === right.classNode
      : left.source === right.source && left.exportName === right.exportName),
  );

const getPrototypeCall = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
): ReadonlyPrototypeCall | null => {
  const prototype = stripParenExpression(node);
  if (
    !isNodeOfType(prototype, "MemberExpression") ||
    prototype.optional ||
    getResolvedStaticPropertyName(prototype, scopes) !== "prototype"
  )
    return null;
  const prototypeRoot = findTransparentExpressionRoot(prototype);
  const method = prototypeRoot.parent;
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.optional ||
    method.object !== prototypeRoot
  )
    return null;
  const methodName = getResolvedStaticPropertyName(method, scopes);
  if (methodName === null) return null;
  const methodRoot = findTransparentExpressionRoot(method);
  const callMember = methodRoot.parent;
  if (
    !isNodeOfType(callMember, "MemberExpression") ||
    callMember.optional ||
    callMember.object !== methodRoot ||
    getResolvedStaticPropertyName(callMember, scopes) !== "call"
  )
    return null;
  const callRoot = findTransparentExpressionRoot(callMember);
  const call = callRoot.parent;
  return isNodeOfType(call, "CallExpression") && !call.optional && call.callee === callRoot
    ? { constructor: prototype.object, methodName, call }
    : null;
};

const isLexicalArgumentRead = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ThisExpression")) return true;
  if (isNodeOfType(candidate, "Literal"))
    return candidate.value === null || typeof candidate.value !== "object";
  if (!isNodeOfType(candidate, "Identifier") || !isSupportedRuntimeScopeNode(candidate, scopes))
    return false;
  const symbol = scopes.symbolFor(candidate);
  return symbol
    ? isReadonlyBinding(symbol)
    : candidate.name === "undefined" && scopes.isGlobalReference(candidate);
};

const hasFreshClassShape = (
  classNode: EsTreeNodeOfType<"ClassExpression" | "ClassDeclaration">,
  module: SourceProjectModule,
): boolean => {
  if (
    classNode.superClass ||
    Boolean(classNode.decorators?.length) ||
    ("declare" in classNode && classNode.declare)
  )
    return false;
  const binding = getClassBindingSymbol(classNode, module.scopes);
  if (binding && !isReadonlyBinding(binding)) return false;
  const names = new Set<string>();
  return classNode.body.body.every((member) => {
    if (
      !isNodeOfType(member, "MethodDefinition") ||
      member.static ||
      member.computed ||
      member.kind !== "method" ||
      Boolean(member.decorators?.length) ||
      !isFunctionLike(member.value)
    )
      return false;
    const name = getResolvedStaticPropertyName(member, module.scopes);
    if (name === null || names.has(name)) return false;
    names.add(name);
    return true;
  });
};

const resolveConstructor = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
  depth = 0,
): ReadonlyPrototypeConstructor | null => {
  if (!spendPrototypeStep(proof) || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return null;
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "ClassExpression") || isNodeOfType(candidate, "ClassDeclaration")) {
    if (!hasFreshClassShape(candidate, module)) return null;
    const cached = proof.byClass.get(candidate);
    if (cached) return cached;
    const resolved: ReadonlyPrototypeConstructor = {
      classNode: candidate,
      module,
      source: null,
      exportName: null,
    };
    proof.byClass.set(candidate, resolved);
    return resolved;
  }
  if (
    !isNodeOfType(candidate, "Identifier") ||
    !isSupportedRuntimeScopeNode(candidate, module.scopes)
  )
    return null;
  const symbol = module.scopes.symbolFor(candidate);
  if (!symbol || !isReadonlyBinding(symbol)) return null;
  if (proof.bySymbol.has(symbol)) return proof.bySymbol.get(symbol) ?? null;
  proof.bySymbol.set(symbol, null);
  let resolved: ReadonlyPrototypeConstructor | null = null;
  if (symbol.kind === "const") {
    const initializer = getDirectConstInitializer(symbol);
    if (initializer) resolved = resolveConstructor(initializer, module, proof, depth + 1);
  } else if (symbol.kind === "class" && symbol.initializer) {
    resolved = resolveConstructor(symbol.initializer, module, proof, depth + 1);
  } else if (symbol.kind === "import") {
    const declaration = getImportDeclarationForSymbol(symbol);
    const name = resolveImportedExportName(symbol.declarationNode);
    if (
      declaration &&
      !isTypeOnlyImport(declaration) &&
      name &&
      !(
        isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
        symbol.declarationNode.importKind === "type"
      )
    ) {
      const sourcePath = proof.project.resolvedSourcePathByNode.get(declaration);
      const sourceModule = sourcePath ? proof.project.modulesByFilePath.get(sourcePath) : null;
      if (sourceModule) {
        const exportedClassDeclaration = sourceModule.programNode.body.find(
          (statement) =>
            isNodeOfType(statement, "ExportNamedDeclaration") &&
            statement.exportKind !== "type" &&
            isNodeOfType(statement.declaration, "ClassDeclaration") &&
            statement.declaration.id?.name === name,
        );
        const exported =
          findExportedValue(sourceModule.programNode, name) ??
          (isNodeOfType(exportedClassDeclaration, "ExportNamedDeclaration")
            ? exportedClassDeclaration.declaration
            : null);
        if (exported) resolved = resolveConstructor(exported, sourceModule, proof, depth + 1);
      } else if (
        typeof declaration.source.value === "string" &&
        hasSupportedReadonlySourcePrototypeRole(
          module.filePath,
          declaration.source.value,
          name,
          proof.methodName,
          proof.project,
        )
      ) {
        resolved = { classNode: null, module, source: declaration.source.value, exportName: name };
      }
    }
  }
  proof.bySymbol.set(symbol, resolved);
  return resolved;
};

const isClosedOwnMethod = (
  constructor: ReadonlyPrototypeConstructor,
  methodName: string,
  call: EsTreeNodeOfType<"CallExpression">,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): boolean => {
  if (
    !call.arguments.length ||
    !call.arguments.every((argument) => isLexicalArgumentRead(argument, module.scopes))
  )
    return false;
  if (!constructor.classNode) {
    return Boolean(
      constructor.source &&
      constructor.exportName &&
      hasSupportedReadonlySourcePrototypeRole(
        constructor.module.filePath,
        constructor.source,
        constructor.exportName,
        methodName,
        proof.project,
      ),
    );
  }
  const method = constructor.classNode.body.body.find(
    (member) =>
      isNodeOfType(member, "MethodDefinition") &&
      getResolvedStaticPropertyName(member, constructor.module.scopes) === methodName,
  );
  if (
    !isNodeOfType(method, "MethodDefinition") ||
    !isFunctionLike(method.value) ||
    method.value.async ||
    method.value.generator ||
    method.value.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
  )
    return false;
  const [, ...argumentsWithoutReceiver] = call.arguments;
  if (argumentsWithoutReceiver.length !== method.value.params.length) return false;
  const returned = getSingleReturnExpression(method.value);
  if (!returned) return false;
  const value = stripParenExpression(returned);
  if (isNodeOfType(value, "Literal"))
    return value.value === null || typeof value.value !== "object";
  if (!isNodeOfType(value, "Identifier")) return false;
  const symbol = constructor.module.scopes.symbolFor(value);
  return Boolean(
    symbol &&
    isReadonlyBinding(symbol) &&
    method.value.params.some(
      (parameter) => constructor.module.scopes.symbolFor(parameter) === symbol,
    ),
  );
};

const sourceMayExposeConstructor = (
  constructor: ReadonlyPrototypeConstructor,
  proof: ReadonlyPrototypeProof,
): Set<string> | null => {
  const paths = new Set<string>();
  if (constructor.classNode) paths.add(constructor.module.filePath);
  else
    for (const module of proof.project.modulesByFilePath.values()) {
      if (
        module.programNode.body.some(
          (statement) => getRuntimeStaticDependencySource(statement) === constructor.source,
        )
      )
        paths.add(module.filePath);
    }
  const pending = [...paths];
  while (pending.length > 0) {
    if (paths.size > NATIVE_DELAY_MAX_RECORD_ALIAS_COUNT) return null;
    const filePath = pending.pop();
    if (!filePath) break;
    for (const consumer of proof.project.consumerModulesByFilePath.get(filePath) ?? []) {
      if (paths.has(consumer.filePath)) continue;
      paths.add(consumer.filePath);
      pending.push(consumer.filePath);
    }
  }
  return paths;
};

const isSdkSource = (source: string, constructor: ReadonlyPrototypeConstructor): boolean =>
  Boolean(
    constructor.source &&
    (source === constructor.source || source.startsWith(`${constructor.source}/`)),
  );

const isClosedConstructorReference = (
  identifier: EsTreeNode,
  module: SourceProjectModule,
  constructor: ReadonlyPrototypeConstructor,
  proof: ReadonlyPrototypeProof,
): boolean => {
  const root = findTransparentExpressionRoot(identifier);
  const consumer = root.parent;
  if (
    isNodeOfType(consumer, "VariableDeclarator") &&
    consumer.init === root &&
    isNodeOfType(consumer.id, "Identifier")
  ) {
    return (
      (!constructor.source || isPrivateSdkAlias(consumer, module)) &&
      sameConstructor(resolveConstructor(consumer.id, module, proof), constructor)
    );
  }
  if (
    constructor.source &&
    (isNodeOfType(consumer, "ExportSpecifier") ||
      isNodeOfType(consumer, "ExportDefaultDeclaration"))
  )
    return false;
  if (isNodeOfType(consumer, "ExportSpecifier"))
    return consumer.local === root && consumer.exportKind !== "type";
  if (isNodeOfType(consumer, "ExportDefaultDeclaration")) return consumer.declaration === root;
  if (!isNodeOfType(consumer, "MemberExpression") || consumer.object !== root) return false;
  const use = getPrototypeCall(consumer, module.scopes);
  return Boolean(use && isClosedOwnMethod(constructor, use.methodName, use.call, module, proof));
};

const getSdkCapability = (
  identifier: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
  depth = 0,
): ReadonlySdkCapability | null => {
  if (!spendPrototypeStep(proof) || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) {
    proof.failed = true;
    return null;
  }
  const candidate = stripParenExpression(identifier);
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    const isUseMember =
      isNodeOfType(callee, "MemberExpression") &&
      getResolvedStaticPropertyName(callee, module.scopes) === "use";
    const capability = isUseMember
      ? getSdkCapability(callee.object, module, proof, depth + 1)
      : getSdkCapability(callee, module, proof, depth + 1);
    return capability &&
      (isUseMember
        ? ["marked", "parse"].includes(capability.exportName ?? "")
        : capability.exportName === "use")
      ? { ...capability, exportName: "marked" }
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(candidate);
  if (!symbol) return null;
  if (proof.sdkCapabilities.has(symbol)) return proof.sdkCapabilities.get(symbol) ?? null;
  proof.sdkCapabilities.set(symbol, null);
  let capability: ReadonlySdkCapability | null = null;
  if (symbol.kind === "import") {
    const declaration = getImportDeclarationForSymbol(symbol);
    if (
      declaration &&
      !isTypeOnlyImport(declaration) &&
      typeof declaration.source.value === "string"
    )
      capability = {
        source: declaration.source.value,
        exportName: resolveImportedExportName(symbol.declarationNode),
        module,
      };
  } else {
    const initializer = getDirectConstInitializer(symbol);
    if (initializer) capability = getSdkCapability(initializer, module, proof, depth + 1);
  }
  proof.sdkCapabilities.set(symbol, capability);
  return capability;
};

const isPrivateSdkAlias = (node: EsTreeNode, module: SourceProjectModule): boolean => {
  if (
    !isNodeOfType(node, "VariableDeclarator") ||
    !isNodeOfType(node.id, "Identifier") ||
    node.parent?.parent?.type === "ExportNamedDeclaration" ||
    node.parent?.parent?.type === "ExportDefaultDeclaration"
  )
    return false;
  const symbol = module.scopes.symbolFor(node.id);
  return Boolean(symbol && symbol.kind === "const" && isReadonlyBinding(symbol));
};

const isVerifiedMarkedCapability = (
  capability: ReadonlySdkCapability | null,
  proof: ReadonlyPrototypeProof,
): capability is ReadonlySdkCapability =>
  Boolean(
    capability &&
    capability.source === proof.selectedConstructor?.source &&
    hasSupportedReadonlySourcePrototypeRole(
      capability.module.filePath,
      capability.source,
      "Renderer",
      proof.methodName,
      proof.project,
    ),
  );

const getMarkedInstance = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
  depth = 0,
): EsTreeNode | null => {
  if (!spendPrototypeStep(proof) || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) {
    proof.failed = true;
    return null;
  }
  const candidate = stripParenExpression(expression);
  if (isNodeOfType(candidate, "NewExpression")) {
    const capability = getSdkCapability(candidate.callee, module, proof);
    return isVerifiedMarkedCapability(capability, proof) && capability.exportName === "Marked"
      ? candidate
      : null;
  }
  if (isNodeOfType(candidate, "CallExpression")) {
    const callee = stripParenExpression(candidate.callee);
    return isNodeOfType(callee, "MemberExpression") &&
      getResolvedStaticPropertyName(callee, module.scopes) === "use"
      ? getMarkedInstance(callee.object, module, proof, depth + 1)
      : null;
  }
  if (!isNodeOfType(candidate, "Identifier")) return null;
  const symbol = module.scopes.symbolFor(candidate);
  if (!symbol || !isReadonlyBinding(symbol)) return null;
  if (proof.sdkInstances.has(symbol)) return proof.sdkInstances.get(symbol) ?? null;
  proof.sdkInstances.set(symbol, null);
  const initializer = getDirectConstInitializer(symbol);
  const instance = initializer ? getMarkedInstance(initializer, module, proof, depth + 1) : null;
  proof.sdkInstances.set(symbol, instance);
  return instance;
};

const isVerifiedRendererFallback = (
  call: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): boolean => {
  if (!isNodeOfType(call, "CallExpression")) return false;
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const method = stripParenExpression(callee.object);
  if (!isNodeOfType(method, "MemberExpression")) return false;
  const use = getPrototypeCall(method.object, module.scopes);
  const constructor = use && resolveConstructor(use.constructor, module, proof);
  return Boolean(
    use &&
    use.call === call &&
    proof.selectedConstructor &&
    sameConstructor(constructor, proof.selectedConstructor) &&
    isClosedOwnMethod(proof.selectedConstructor, use.methodName, call, module, proof),
  );
};

const isClosedRendererThisUse = (
  node: EsTreeNode,
  callback: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): boolean => {
  if (isNodeOfType(callback, "ArrowFunctionExpression") || findEnclosingFunction(node) !== callback)
    return false;
  const root = findTransparentExpressionRoot(node);
  const parent = root.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    parent.arguments[0] === root &&
    isVerifiedRendererFallback(parent, module, proof)
  )
    return true;
  if (
    !isNodeOfType(parent, "MemberExpression") ||
    parent.object !== root ||
    parent.optional ||
    getResolvedStaticPropertyName(parent, module.scopes) !== "parser"
  )
    return false;
  const parserRoot = findTransparentExpressionRoot(parent);
  const method = parserRoot.parent;
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.object !== parserRoot ||
    method.optional ||
    !["parse", "parseInline"].includes(getResolvedStaticPropertyName(method, module.scopes) ?? "")
  )
    return false;
  const methodRoot = findTransparentExpressionRoot(method);
  const call = methodRoot.parent;
  return (
    isNodeOfType(call, "CallExpression") &&
    call.callee === methodRoot &&
    !call.optional &&
    call.arguments.every((argument) => !isNodeOfType(argument, "SpreadElement"))
  );
};

const isNativeCallbackCapability = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
  depth = 0,
): boolean => {
  if (!spendPrototypeStep(proof) || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) {
    proof.failed = true;
    return true;
  }
  const candidate = stripParenExpression(expression);
  if (
    [
      "AbortController",
      "AbortSignal",
      "EventTarget",
      "document",
      "window",
      "self",
      "globalThis",
      "global",
      "parent",
      "top",
      "opener",
      "frames",
    ].some((name) => isProvenGlobalNamespaceReference(candidate, name, module.scopes))
  )
    return true;
  if (isNodeOfType(candidate, "NewExpression") || isNodeOfType(candidate, "CallExpression"))
    return isNativeCallbackCapability(candidate.callee, module, proof, depth + 1);
  if (isNodeOfType(candidate, "MemberExpression"))
    return isNativeCallbackCapability(candidate.object, module, proof, depth + 1);
  if (!isNodeOfType(candidate, "Identifier")) return false;
  const symbol = module.scopes.symbolFor(candidate);
  const initializer = symbol && getDirectConstInitializer(symbol);
  return Boolean(initializer && isNativeCallbackCapability(initializer, module, proof, depth + 1));
};

const getRendererCaptureSymbol = (
  symbol: SymbolDescriptor,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): SymbolDescriptor | null => {
  let current = symbol;
  const visited = new Set<SymbolDescriptor>();
  for (let depth = 0; depth < NATIVE_DELAY_MAX_ALIAS_DEPTH; depth += 1) {
    if (!spendPrototypeStep(proof) || visited.has(current) || !isReadonlyBinding(current))
      return null;
    visited.add(current);
    const initializer = getDirectConstInitializer(current);
    const candidate = initializer && stripParenExpression(initializer);
    const next = isNodeOfType(candidate, "Identifier") ? module.scopes.symbolFor(candidate) : null;
    if (!next) return current;
    current = next;
  }
  proof.failed = true;
  return null;
};

const isDirectCallbackCall = (node: EsTreeNode): boolean => {
  const root = findTransparentExpressionRoot(node);
  return (
    isNodeOfType(root.parent, "CallExpression") &&
    root.parent.callee === root &&
    !root.parent.optional
  );
};

const getOwnedBuilder = (
  callback: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): OwnedRendererBuilderCertificate | null => {
  const wrapper = findEnclosingFunction(callback);
  if (!wrapper) return null;
  if (proof.ownedBuilders.has(wrapper)) return proof.ownedBuilders.get(wrapper) ?? null;
  proof.ownedBuilders.set(wrapper, null);
  const certificate = certifyOwnedRendererBuilder(callback, {
    module,
    projectIndex: proof.project,
    getInstance: (expression) => getMarkedInstance(expression, module, proof),
    getConfigurationCallbacks: (expression) => {
      if (
        !isClosedMarkedOptions(expression, module, proof, true, false) ||
        !isNodeOfType(expression, "ObjectExpression")
      )
        return null;
      const callbacks: OwnedRendererBuilderCallback[] = [];
      for (const property of expression.properties) {
        if (
          !isNodeOfType(property, "Property") ||
          getResolvedStaticPropertyName(property, module.scopes) !== "renderer" ||
          !isNodeOfType(property.value, "ObjectExpression")
        )
          continue;
        for (const method of property.value.properties) {
          if (!isNodeOfType(method, "Property")) return null;
          const methodName = getResolvedStaticPropertyName(method, module.scopes);
          if (!methodName) return null;
          callbacks.push({ callback: method.value, methodName });
        }
      }
      return callbacks;
    },
    getFallbackMethod: (call, sourceModule) => {
      if (
        !isVerifiedRendererFallback(call, sourceModule, proof) ||
        !isNodeOfType(call, "CallExpression")
      )
        return null;
      const callee = stripParenExpression(call.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return null;
      const method = stripParenExpression(callee.object);
      return isNodeOfType(method, "MemberExpression")
        ? getResolvedStaticPropertyName(method, sourceModule.scopes)
        : null;
    },
    isParserCall: (call, rendererCallback) => {
      if (!isNodeOfType(call, "CallExpression")) return false;
      const callee = stripParenExpression(call.callee);
      if (!isNodeOfType(callee, "MemberExpression")) return false;
      const parser = stripParenExpression(callee.object);
      if (!isNodeOfType(parser, "MemberExpression")) return false;
      const receiver = stripParenExpression(parser.object);
      return (
        isNodeOfType(receiver, "ThisExpression") &&
        isClosedRendererThisUse(receiver, rendererCallback, module, proof)
      );
    },
    spendStep: () => spendPrototypeStep(proof),
  });
  proof.ownedBuilders.set(wrapper, certificate);
  return certificate;
};

const isClosedRendererCallback = (
  callback: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): boolean => {
  if (!isFunctionLike(callback) || callback.async || callback.generator) return false;
  if (proof.rendererCallbacks.has(callback)) return true;
  proof.rendererCallbacks.add(callback);
  const pending: EsTreeNode[] = [callback];
  const visited = new Set<EsTreeNode>();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    walkAst(current, (node) => {
      if (proof.failed || !spendPrototypeStep(proof)) return false;
      if (isFunctionLike(node) && (node.async || node.generator)) {
        proof.failed = true;
        return false;
      }
      if (
        isNodeOfType(node, "ThisExpression") &&
        !isClosedRendererThisUse(node, callback, module, proof)
      ) {
        proof.failed = true;
        return false;
      }
      if (isNodeOfType(node, "MemberExpression")) {
        const name = getResolvedStaticPropertyName(node, module.scopes, {
          allowConstNumericLiteral: true,
          allowConstTemplateLiteral: true,
          stringifyNonStringLiterals: true,
        });
        if (
          name === null ||
          MARKED_CALLBACK_NATIVE_MEMBERS.has(name) ||
          (name === "prototype" &&
            !isVerifiedRendererFallback(
              getPrototypeCall(node, module.scopes)?.call ?? node,
              module,
              proof,
            ))
        ) {
          proof.failed = true;
          return false;
        }
      }
      if (isNodeOfType(node, "CallExpression")) {
        if (
          isReactApiCall(node, MARKED_CALLBACK_REF_HOOKS, module.scopes, {
            allowGlobalReactNamespace: true,
            allowUnboundBareCalls: true,
          })
        ) {
          proof.failed = true;
          return false;
        }
        const target = resolveExactLocalFunction(node.callee, module.scopes);
        if (target) pending.push(target);
      }
      if (!isNodeOfType(node, "Identifier") || !module.scopes.referenceFor(node)) return;
      const referencedSymbol = module.scopes.symbolFor(node);
      const isOriginalLocal =
        referencedSymbol &&
        (isAstDescendant(referencedSymbol.declarationNode, callback) ||
          (isFunctionLike(current) && isAstDescendant(referencedSymbol.declarationNode, current)));
      const symbol =
        referencedSymbol &&
        (isOriginalLocal && !isReadonlyBinding(referencedSymbol)
          ? referencedSymbol
          : getRendererCaptureSymbol(referencedSymbol, module, proof));
      if (referencedSymbol && !symbol) {
        proof.failed = true;
        return false;
      }
      const origin = symbol?.bindingIdentifier ?? node;
      if (
        isReactHookResultReference(origin, MARKED_CALLBACK_STATE_HOOKS, 1, module.scopes) ||
        isReactHookResultReference(origin, MARKED_CALLBACK_REF_HOOKS, null, module.scopes) ||
        isNativeCallbackCapability(node, module, proof)
      ) {
        proof.failed = true;
        return false;
      }
      if (!symbol) {
        if (isDirectCallbackCall(node)) proof.callbackGlobals.add(node.name);
        else if (!["undefined", "NaN", "Infinity"].includes(node.name)) proof.failed = true;
        return;
      }
      const isLocal =
        isAstDescendant(symbol.declarationNode, callback) ||
        (isFunctionLike(current) && isAstDescendant(symbol.declarationNode, current));
      const initializer =
        symbol.kind === "function" ? symbol.declarationNode : getDirectConstInitializer(symbol);
      if (!isLocal) {
        const builder = getOwnedBuilder(callback, module, proof);
        if (builder?.callbacks.has(callback) && builder.captures.has(symbol)) return;
        const capability = getSdkCapability(node, module, proof);
        if (isVerifiedMarkedCapability(capability, proof) || getMarkedInstance(node, module, proof))
          return;
        if (symbol.kind === "import") {
          if (!isDirectCallbackCall(node)) proof.failed = true;
          return;
        }
        const value = initializer && stripParenExpression(initializer);
        const isPrimitive =
          isNodeOfType(value, "Literal") &&
          (value.value === null || typeof value.value !== "object");
        if (isPrimitive) return;
        if (
          !isFunctionLike(value) ||
          value.async ||
          value.generator ||
          !isDirectCallbackCall(node)
        ) {
          proof.failed = true;
          return false;
        }
        pending.push(value);
        return;
      }
      if (initializer) pending.push(initializer);
      return;
    });
    if (proof.failed) return false;
  }
  return true;
};

const isClosedMarkedOptions = (
  expression: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
  rendererAllowed: boolean,
  validateCaptures = true,
): boolean => {
  const options = stripParenExpression(expression);
  if (!isNodeOfType(options, "ObjectExpression")) return false;
  const keys = new Set<string>();
  return options.properties.every((property) => {
    if (!isNodeOfType(property, "Property") || property.kind !== "init" || property.computed)
      return false;
    const key = getResolvedStaticPropertyName(property, module.scopes);
    if (!key || keys.has(key)) return false;
    keys.add(key);
    if (MARKED_BOOLEAN_OPTIONS.has(key))
      return isNodeOfType(property.value, "Literal") && typeof property.value.value === "boolean";
    if (key !== "renderer" || !rendererAllowed || !isNodeOfType(property.value, "ObjectExpression"))
      return false;
    const methods = new Set<string>();
    return property.value.properties.every((method) => {
      if (!isNodeOfType(method, "Property") || method.kind !== "init" || method.computed)
        return false;
      const name = getResolvedStaticPropertyName(method, module.scopes);
      if (
        !name ||
        methods.has(name) ||
        !proof.selectedConstructor?.source ||
        !hasSupportedReadonlySourcePrototypeRole(
          module.filePath,
          proof.selectedConstructor.source,
          "Renderer",
          name,
          proof.project,
        )
      )
        return false;
      methods.add(name);
      if (
        !isFunctionLike(method.value) ||
        method.value.async ||
        method.value.generator ||
        !method.value.params.every(
          (parameter) =>
            isNodeOfType(parameter, "Identifier") ||
            (isNodeOfType(parameter, "ObjectPattern") &&
              parameter.properties.every(
                (binding) =>
                  isNodeOfType(binding, "Property") &&
                  binding.kind === "init" &&
                  !binding.computed &&
                  isNodeOfType(binding.value, "Identifier") &&
                  !MARKED_CALLBACK_NATIVE_MEMBERS.has(
                    getResolvedStaticPropertyName(binding, module.scopes) ?? "",
                  ),
              )),
        )
      )
        return false;
      return !validateCaptures || isClosedRendererCallback(method.value, module, proof);
    });
  });
};

const isClosedMarkedParse = (
  call: EsTreeNodeOfType<"CallExpression">,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): boolean => {
  const [source, options, ...remaining] = call.arguments;
  return Boolean(
    source &&
    remaining.length === 0 &&
    !isNodeOfType(source, "ThisExpression") &&
    isLexicalArgumentRead(source, module.scopes) &&
    (!options || isClosedMarkedOptions(options, module, proof, false)),
  );
};

const isClosedMarkedResultUse = (
  node: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
  depth = 0,
): boolean => {
  if (!spendPrototypeStep(proof) || depth >= NATIVE_DELAY_MAX_ALIAS_DEPTH) return false;
  const root = findTransparentExpressionRoot(node);
  const parent = root.parent;
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (isPrivateSdkAlias(parent ?? root, module)) return true;
  if (!isNodeOfType(parent, "MemberExpression") || parent.object !== root || parent.optional)
    return false;
  const memberRoot = findTransparentExpressionRoot(parent);
  const call = memberRoot.parent;
  if (!isNodeOfType(call, "CallExpression") || call.callee !== memberRoot || call.optional)
    return false;
  const method = getResolvedStaticPropertyName(parent, module.scopes);
  if (method === "parse") return isClosedMarkedParse(call, module, proof);
  return (
    method === "use" &&
    call.arguments.length > 0 &&
    call.arguments.every((argument) => isClosedMarkedOptions(argument, module, proof, true)) &&
    isClosedMarkedResultUse(call, module, proof, depth + 1)
  );
};

const isClosedSdkCapabilityReference = (
  identifier: EsTreeNode,
  module: SourceProjectModule,
  proof: ReadonlyPrototypeProof,
): boolean => {
  const symbol = module.scopes.symbolFor(identifier);
  const capability = getSdkCapability(identifier, module, proof);
  if (!symbol || !isReadonlyBinding(symbol) || !isVerifiedMarkedCapability(capability, proof))
    return false;
  const root = findTransparentExpressionRoot(identifier);
  const parent = root.parent;
  if (isNodeOfType(parent, "VariableDeclarator") && parent.init === root)
    return isPrivateSdkAlias(parent, module);
  if (capability.exportName === "Marked") {
    if (!isNodeOfType(parent, "NewExpression") || parent.callee !== root) return false;
    const [options, ...remaining] = parent.arguments;
    return (
      remaining.length === 0 &&
      (!options || isClosedMarkedOptions(options, module, proof, true)) &&
      isClosedMarkedResultUse(parent, module, proof)
    );
  }
  if (capability.exportName === "use")
    return (
      isNodeOfType(parent, "CallExpression") &&
      parent.callee === root &&
      !parent.optional &&
      parent.arguments.length > 0 &&
      parent.arguments.every((argument) => isClosedMarkedOptions(argument, module, proof, true)) &&
      isClosedMarkedResultUse(parent, module, proof)
    );
  if (!["marked", "parse"].includes(capability.exportName ?? "")) return false;
  if (isNodeOfType(parent, "CallExpression") && parent.callee === root && !parent.optional)
    return isClosedMarkedParse(parent, module, proof);
  return isClosedMarkedResultUse(root, module, proof);
};

export const certifyReadonlySourcePrototypeUse = (
  node: EsTreeNode,
  module: SourceProjectModule,
  projectIndex: SourceProjectIndex,
): boolean => {
  if (
    projectIndex.hasOpaqueMdxConsumerSurface ||
    projectIndex.htmlFilePaths.length > 0 ||
    projectIndex.modulesByFilePath.get(module.filePath) !== module ||
    module.scopes.rootScope.node !== module.programNode
  )
    return false;
  const use = getPrototypeCall(node, module.scopes);
  if (!use) return false;
  const proof: ReadonlyPrototypeProof = {
    project: projectIndex,
    methodName: use.methodName,
    steps: 0,
    failed: false,
    bySymbol: new Map(),
    byClass: new Map(),
    sdkCapabilities: new Map(),
    sdkInstances: new Map(),
    rendererCallbacks: new Set(),
    ownedBuilders: new Map(),
    selectedConstructor: null,
    callbackGlobals: new Set(),
    globalWrites: new Set(),
  };
  const constructor = resolveConstructor(use.constructor, module, proof);
  if (!constructor || !isClosedOwnMethod(constructor, use.methodName, use.call, module, proof))
    return false;
  proof.selectedConstructor = constructor;
  const exposedPaths = sourceMayExposeConstructor(constructor, proof);
  if (!exposedPaths) return false;
  for (const candidateModule of projectIndex.modulesByFilePath.values()) {
    walkAst(candidateModule.programNode, (candidate) => {
      if (proof.failed || !spendPrototypeStep(proof)) return false;
      if (!isSupportedRuntimeScopeNode(candidate, candidateModule.scopes)) {
        proof.failed = true;
        return false;
      }
      const sourcePath = projectIndex.resolvedSourcePathByNode.get(candidate);
      if (
        (isNodeOfType(candidate, "ExportNamedDeclaration") ||
          isNodeOfType(candidate, "ExportAllDeclaration")) &&
        getRuntimeStaticDependencySource(candidate) &&
        ((sourcePath && exposedPaths.has(sourcePath)) ||
          isSdkSource(getRuntimeStaticDependencySource(candidate) ?? "", constructor))
      ) {
        proof.failed = true;
        return false;
      }
      if (
        isNodeOfType(candidate, "ImportExpression") &&
        (!getStaticStringExpression(candidate.source) ||
          (sourcePath && exposedPaths.has(sourcePath)) ||
          ["module", "node:module"].includes(getStaticStringExpression(candidate.source) ?? "") ||
          isSdkSource(getStaticStringExpression(candidate.source) ?? "", constructor))
      ) {
        proof.failed = true;
        return false;
      }
      if (isNodeOfType(candidate, "TSImportEqualsDeclaration") && candidate.importKind !== "type") {
        proof.failed = true;
        return false;
      }
      if (
        isNodeOfType(candidate, "ImportDeclaration") &&
        !isTypeOnlyImport(candidate) &&
        constructor.source &&
        ((typeof candidate.source.value === "string" &&
          candidate.source.value.startsWith(`${constructor.source}/`)) ||
          (sourcePath?.includes(`/node_modules/${constructor.source}/`) &&
            candidate.source.value !== constructor.source))
      ) {
        proof.failed = true;
        return false;
      }
      if (
        isNodeOfType(candidate, "ImportDeclaration") &&
        !isTypeOnlyImport(candidate) &&
        ["module", "node:module"].includes(String(candidate.source.value))
      ) {
        proof.failed = true;
        return false;
      }
      if (
        (isNodeOfType(candidate, "Identifier") || isNodeOfType(candidate, "MemberExpression")) &&
        (isProvenGlobalNamespaceReference(candidate, "require", candidateModule.scopes) ||
          isProvenGlobalNamespaceReference(candidate, "module", candidateModule.scopes))
      ) {
        proof.failed = true;
        return false;
      }
      if (!isNodeOfType(candidate, "Identifier")) return;
      const reference = candidateModule.scopes.referenceFor(candidate);
      if (!reference) return;
      if (reference.flag !== "read" && candidateModule.scopes.isGlobalReference(candidate))
        proof.globalWrites.add(candidate.name);
      const instance = constructor.source
        ? getMarkedInstance(candidate, candidateModule, proof)
        : null;
      if (instance) {
        const root = findTransparentExpressionRoot(candidate);
        const parent = root.parent;
        if (
          reference.flag !== "read" ||
          !(isNodeOfType(parent, "VariableDeclarator") && parent.init === root
            ? isPrivateSdkAlias(parent, candidateModule)
            : isClosedMarkedResultUse(root, candidateModule, proof))
        )
          proof.failed = true;
        return;
      }
      const resolved = resolveConstructor(candidate, candidateModule, proof);
      if (sameConstructor(resolved, constructor)) {
        if (
          reference.flag !== "read" ||
          !isClosedConstructorReference(candidate, candidateModule, constructor, proof)
        )
          proof.failed = true;
        return;
      }
      const importedSource = constructor.source
        ? getSdkCapability(candidate, candidateModule, proof)?.source
        : null;
      if (
        constructor.source &&
        importedSource === constructor.source &&
        (reference.flag !== "read" ||
          !isClosedSdkCapabilityReference(candidate, candidateModule, proof))
      ) {
        proof.failed = true;
        return false;
      }
      const binding = reference.resolvedSymbol;
      const declaration = binding && getImportDeclarationForSymbol(binding);
      const importedPath = declaration && projectIndex.resolvedSourcePathByNode.get(declaration);
      if (
        binding &&
        isNodeOfType(binding.declarationNode, "ImportNamespaceSpecifier") &&
        importedPath &&
        exposedPaths.has(importedPath)
      )
        proof.failed = true;
      return;
    });
    if (proof.failed) return false;
  }
  return ![...proof.callbackGlobals].some((name) => proof.globalWrites.has(name));
};
