import type { ScopeAnalysis, SymbolDescriptor } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import type { EsTreeNodeOfType } from "./es-tree-node-of-type.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { findTransparentExpressionRoot } from "./find-transparent-expression-root.js";
import { getDirectConstInitializer } from "./get-direct-const-initializer.js";
import { getImportedName } from "./get-imported-name.js";
import { getResolvedStaticPropertyName } from "./get-resolved-static-property-name.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { getValueImportSource } from "./get-value-import-declaration.js";
import { isAstDescendant } from "./is-ast-descendant.js";
import { hasRuntimeValueBinding } from "./has-runtime-value-binding.js";
import { isErasedTypeScriptBinding } from "./is-erased-typescript-binding.js";
import { isMemberMutationTarget } from "./is-member-mutation-target.js";
import { isProvenGlobalNamespaceReference } from "./is-proven-global-namespace-reference.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isNodeOnUnconditionalPath } from "./is-node-on-unconditional-path.js";
import { isReactApiCall } from "./is-react-api-call.js";
import { isTypeScriptTypePosition } from "./is-typescript-type-position.js";
import type { RuleContext } from "./rule-context.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";
import { walkOwnFunctionScope } from "./walk-own-function-scope.js";
import {
  CALLBACK_HOOK_ARGUMENT_COUNT,
  DIRECT_HOOK_ARGUMENT_COUNT,
  OWNER_STATE_TUPLE_LENGTH,
  OWNER_RENDER_REFRESH_COUNT,
  REACT_OWNER_API_NAMES,
  SINGLE_EXIT_STATEMENT_COUNT,
  UNSUPPORTED_OWNER_GLOBAL_NAMES,
  UNSUPPORTED_OWNER_PROGRAM_NODE_TYPES,
  UNSUPPORTED_OWNER_PROPERTY_NAMES,
  UNSUPPORTED_OWNER_REGION_NODE_TYPES,
  UNSUPPORTED_OWNER_WINDOW_NODE_TYPES,
} from "./readonly-owner-snapshot/constants.js";

interface OwnerSnapshot {
  input: SymbolDescriptor;
  aliases: SymbolDescriptor[];
}

interface OwnerGuard {
  comparison: EsTreeNodeOfType<"BinaryExpression">;
  exitBranch: EsTreeNode | null;
}

interface OwnerCallbackRegion {
  supported: boolean;
  suspensions: EsTreeNode[];
  suspensionEnds: number[];
  windowNodes: EsTreeNode[];
}

interface OwnerSnapshotAnalysis {
  readonlySymbols: WeakMap<SymbolDescriptor, boolean>;
  closedSetters: WeakMap<SymbolDescriptor, boolean>;
  closedRefs: WeakMap<
    EsTreeNode,
    WeakMap<SymbolDescriptor, WeakMap<SymbolDescriptor, Map<number, boolean>>>
  >;
  callbackRegions: WeakMap<EsTreeNode, OwnerCallbackRegion>;
  loadedProviders: WeakMap<EsTreeNode, boolean>;
  supportedProgram?: boolean;
  runtimeScopes: ScopeAnalysis;
}

const ownerSnapshotAnalyses = new WeakMap<ScopeAnalysis, OwnerSnapshotAnalysis>();

const getOwnerSnapshotAnalysis = (context: RuleContext): OwnerSnapshotAnalysis => {
  const cached = ownerSnapshotAnalyses.get(context.scopes);
  if (cached) return cached;
  const analysis: OwnerSnapshotAnalysis = {
    readonlySymbols: new WeakMap(),
    closedSetters: new WeakMap(),
    closedRefs: new WeakMap(),
    callbackRegions: new WeakMap(),
    loadedProviders: new WeakMap(),
    runtimeScopes: {
      ...context.scopes,
      isGlobalReference: (identifier) => {
        const reference = context.scopes.referenceFor(identifier);
        const symbol = reference?.resolvedSymbol;
        return Boolean(
          reference &&
          (!symbol || (isErasedTypeScriptBinding(symbol) && !hasRuntimeValueBinding(symbol))),
        );
      },
    },
  };
  ownerSnapshotAnalyses.set(context.scopes, analysis);
  return analysis;
};

const getFirstNodeAtOrAfter = (nodes: readonly EsTreeNode[], offset: number): number => {
  let lowerIndex = 0;
  let upperIndex = nodes.length;
  while (lowerIndex < upperIndex) {
    const middleIndex = Math.floor((lowerIndex + upperIndex) / 2);
    if (nodes[middleIndex].range[0] < offset) lowerIndex = middleIndex + 1;
    else upperIndex = middleIndex;
  }
  return lowerIndex;
};

const getOwnerCallbackRegion = (
  callback: EsTreeNode,
  context: RuleContext,
): OwnerCallbackRegion => {
  const regions = getOwnerSnapshotAnalysis(context).callbackRegions;
  const cached = regions.get(callback);
  if (cached) return cached;
  const region: OwnerCallbackRegion = {
    supported: true,
    suspensions: [],
    suspensionEnds: [],
    windowNodes: [],
  };
  walkOwnFunctionScope(callback, (node) => {
    if (
      UNSUPPORTED_OWNER_REGION_NODE_TYPES.has(node.type) ||
      (isNodeOfType(node, "TryStatement") && node.finalizer)
    )
      region.supported = false;
    if (isNodeOfType(node, "AwaitExpression")) region.suspensions.push(node);
    if (
      UNSUPPORTED_OWNER_WINDOW_NODE_TYPES.has(node.type) ||
      UNSUPPORTED_OWNER_REGION_NODE_TYPES.has(node.type) ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    )
      region.windowNodes.push(node);
  });
  region.suspensions.sort((left, right) => left.range[0] - right.range[0]);
  region.windowNodes.sort((left, right) => left.range[0] - right.range[0]);
  let lastSuspensionEnd = -Infinity;
  for (const suspension of region.suspensions) {
    lastSuspensionEnd = Math.max(lastSuspensionEnd, suspension.range[1]);
    region.suspensionEnds.push(lastSuspensionEnd);
  }
  regions.set(callback, region);
  return region;
};

const isLoadedOwnerReactProvider = (node: EsTreeNode, context: RuleContext): boolean => {
  const expression = stripParenExpression(node);
  const analysis = getOwnerSnapshotAnalysis(context);
  const cached = analysis.loadedProviders.get(expression);
  if (cached !== undefined) return cached;
  analysis.loadedProviders.set(expression, false);
  let loaded = false;
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    const initializer = symbol && getDirectConstInitializer(symbol);
    loaded = Boolean(initializer && isLoadedOwnerReactProvider(initializer, context));
  } else if (
    isNodeOfType(expression, "MemberExpression") &&
    getStaticPropertyName(expression) === "default"
  ) {
    loaded = isLoadedOwnerReactProvider(expression.object, context);
  } else if (
    isNodeOfType(expression, "CallExpression") &&
    !expression.optional &&
    expression.arguments.length === DIRECT_HOOK_ARGUMENT_COUNT &&
    isNodeOfType(expression.callee, "MemberExpression") &&
    !expression.callee.optional &&
    getStaticPropertyName(expression.callee) === "require" &&
    isProvenGlobalNamespaceReference(expression.callee.object, "module", analysis.runtimeScopes)
  ) {
    const [moduleSource] = expression.arguments;
    loaded = isNodeOfType(moduleSource, "Literal") && moduleSource.value === "react";
  }
  analysis.loadedProviders.set(expression, loaded);
  return loaded;
};

const hasClosedLoadedOwnerProviderUse = (node: EsTreeNode, context: RuleContext): boolean => {
  if (
    (!isNodeOfType(node, "Identifier") || context.scopes.referenceFor(node)) &&
    isLoadedOwnerReactProvider(node, context)
  ) {
    const expression = findTransparentExpressionRoot(node);
    const parent = expression.parent;
    if (isNodeOfType(parent, "MemberExpression") && parent.object === expression) {
      const property = getStaticPropertyName(parent);
      return (
        property !== null &&
        ((!REACT_OWNER_API_NAMES.has(property) && property !== "default") ||
          !isMemberMutationTarget(parent))
      );
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === expression &&
      isNodeOfType(parent.id, "Identifier") &&
      isNodeOfType(parent.parent, "VariableDeclaration") &&
      parent.parent.kind === "const"
    )
      return true;
    return isNodeOfType(parent, "UnaryExpression") && parent.operator === "void";
  }
  return true;
};

const isPlainNullLiteral = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  return (
    isNodeOfType(expression, "Literal") &&
    expression.value === null &&
    !("regex" in expression && expression.regex != null) &&
    !("bigint" in expression && expression.bigint != null)
  );
};

const isReadonlySymbol = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const proofs = getOwnerSnapshotAnalysis(context).readonlySymbols;
  const cached = proofs.get(symbol);
  if (cached !== undefined) return cached;
  const readonly = symbol.references.every(
    (reference) => reference.flag === "read" && !isMemberMutationTarget(reference.identifier),
  );
  proofs.set(symbol, readonly);
  return readonly;
};

const isDirectCall = (node: EsTreeNode): boolean =>
  isNodeOfType(node.parent, "CallExpression") &&
  node.parent.callee === node &&
  !node.parent.optional;

const isActualOwnerHook = (call: EsTreeNode, apiName: string, context: RuleContext): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isReactApiCall(call, apiName, context.scopes)
  )
    return false;
  const callee = call.callee;
  let provider: EsTreeNode | null = null;
  if (isNodeOfType(callee, "Identifier")) provider = callee;
  else if (
    isNodeOfType(callee, "MemberExpression") &&
    !callee.optional &&
    isNodeOfType(callee.object, "Identifier")
  )
    provider = callee.object;
  const symbol = provider ? context.scopes.symbolFor(provider) : null;
  return Boolean(
    symbol && getValueImportSource(symbol) === "react" && isReadonlySymbol(symbol, context),
  );
};

const getOwnerSnapshot = (
  node: EsTreeNode,
  callback: EsTreeNode,
  owner: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): OwnerSnapshot | null => {
  const aliases: SymbolDescriptor[] = [];
  const seen = new Set<SymbolDescriptor>();
  let current: EsTreeNode = stripParenExpression(node);
  while (isNodeOfType(current, "Identifier")) {
    const symbol = context.scopes.symbolFor(current);
    if (!symbol || !isReadonlySymbol(symbol, context) || seen.has(symbol)) return null;
    seen.add(symbol);
    if (symbol.kind === "parameter") {
      return aliases.length > 0 &&
        isFunctionLike(owner) &&
        owner.params.some((parameter) => parameter === symbol.bindingIdentifier)
        ? { input: symbol, aliases }
        : null;
    }
    const initializer = getDirectConstInitializer(symbol);
    if (
      !initializer ||
      findEnclosingFunction(symbol.declarationNode) !== callback ||
      symbol.declarationNode.range[1] > firstSuspensionStart ||
      symbol.declarationNode.range[1] > current.range[0] ||
      !isNodeOnUnconditionalPath(symbol.declarationNode, callback)
    )
      return null;
    aliases.push(symbol);
    current = stripParenExpression(initializer);
  }
  return null;
};

const comparisonUsesRefAndInput = (
  comparison: EsTreeNode,
  ref: SymbolDescriptor,
  input: SymbolDescriptor,
  callback: EsTreeNode,
  owner: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(comparison, "BinaryExpression") ||
    (comparison.operator !== "===" && comparison.operator !== "!==")
  )
    return false;
  return [comparison.left, comparison.right].some((side) => {
    const member = stripParenExpression(side);
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.optional ||
      getStaticPropertyName(member) !== "current" ||
      !isNodeOfType(member.object, "Identifier") ||
      context.scopes.symbolFor(member.object) !== ref
    )
      return false;
    const counterpart = side === comparison.left ? comparison.right : comparison.left;
    const direct = stripParenExpression(counterpart);
    return (
      (isNodeOfType(direct, "Identifier") && context.scopes.symbolFor(direct) === input) ||
      getOwnerSnapshot(counterpart, callback, owner, firstSuspensionStart, context)?.input === input
    );
  });
};

const hasClosedOwnerRef = (
  ref: SymbolDescriptor,
  snapshot: OwnerSnapshot,
  callback: EsTreeNode,
  owner: EsTreeNode,
  firstSuspensionStart: number,
  context: RuleContext,
): boolean => {
  const initializer = getDirectConstInitializer(ref);
  if (
    !initializer ||
    !isActualOwnerHook(initializer, "useRef", context) ||
    !isNodeOfType(initializer, "CallExpression") ||
    initializer.arguments.length !== DIRECT_HOOK_ARGUMENT_COUNT ||
    findEnclosingFunction(ref.declarationNode) !== owner ||
    !isNodeOnUnconditionalPath(ref.declarationNode, owner) ||
    ref.declarationNode.range[1] > callback.range[0]
  )
    return false;
  const initialInput = initializer.arguments[0];
  if (
    !isNodeOfType(initialInput, "Identifier") ||
    context.scopes.symbolFor(initialInput) !== snapshot.input ||
    !isReadonlySymbol(ref, context)
  )
    return false;
  const analysis = getOwnerSnapshotAnalysis(context);
  let callbackProofs = analysis.closedRefs.get(callback);
  if (!callbackProofs) {
    callbackProofs = new WeakMap();
    analysis.closedRefs.set(callback, callbackProofs);
  }
  let inputProofs = callbackProofs.get(ref);
  if (!inputProofs) {
    inputProofs = new WeakMap();
    callbackProofs.set(ref, inputProofs);
  }
  let suspensionProofs = inputProofs.get(snapshot.input);
  if (!suspensionProofs) {
    suspensionProofs = new Map();
    inputProofs.set(snapshot.input, suspensionProofs);
  }
  const cached = suspensionProofs.get(firstSuspensionStart);
  if (cached !== undefined) return cached;
  suspensionProofs.set(firstSuspensionStart, false);
  let refreshCount = 0;
  for (const reference of ref.references) {
    const root = findTransparentExpressionRoot(reference.identifier);
    const member = root.parent;
    if (
      !isNodeOfType(member, "MemberExpression") ||
      member.object !== root ||
      member.optional ||
      getStaticPropertyName(member) !== "current"
    )
      return false;
    const expression = findTransparentExpressionRoot(member);
    const parent = expression.parent;
    if (isNodeOfType(parent, "AssignmentExpression") && parent.left === expression) {
      if (
        parent.operator !== "=" ||
        !isNodeOfType(parent.right, "Identifier") ||
        context.scopes.symbolFor(parent.right) !== snapshot.input ||
        findEnclosingFunction(parent) !== owner ||
        !isNodeOnUnconditionalPath(parent, owner) ||
        parent.range[0] < ref.declarationNode.range[1] ||
        parent.range[1] > callback.range[0]
      )
        return false;
      refreshCount++;
    } else if (
      !parent ||
      !comparisonUsesRefAndInput(
        parent,
        ref,
        snapshot.input,
        callback,
        owner,
        firstSuspensionStart,
        context,
      )
    )
      return false;
  }
  const closed = refreshCount === OWNER_RENDER_REFRESH_COUNT;
  suspensionProofs.set(firstSuspensionStart, closed);
  return closed;
};

const hasSupportedOwnerProgram = (context: RuleContext): boolean => {
  const analysis = getOwnerSnapshotAnalysis(context);
  if (analysis.supportedProgram !== undefined) return analysis.supportedProgram;
  let supported = true;
  walkAst(context.scopes.rootScope.node, (node) => {
    if (!supported) return false;
    if (
      UNSUPPORTED_OWNER_PROGRAM_NODE_TYPES.has(node.type) ||
      ("declare" in node && node.declare === true)
    ) {
      supported = false;
      return false;
    }
    if (isNodeOfType(node, "ImportDeclaration") && node.importKind === "type") return false;
    if (
      (isNodeOfType(node, "ExportNamedDeclaration") &&
        node.exportKind === "type" &&
        !node.declaration) ||
      (isNodeOfType(node, "ExportAllDeclaration") && node.exportKind === "type") ||
      (isNodeOfType(node, "ExportSpecifier") && node.exportKind === "type")
    )
      return false;
    if (isTypeScriptTypePosition(node)) return false;
    if (
      isNodeOfType(node, "MemberExpression") ||
      (isNodeOfType(node, "Property") && isNodeOfType(node.parent, "ObjectPattern"))
    ) {
      const property = getResolvedStaticPropertyName(node, context.scopes);
      if (property === null || UNSUPPORTED_OWNER_PROPERTY_NAMES.has(property)) {
        supported = false;
        return false;
      }
    }
    if (
      (isNodeOfType(node, "Property") || isNodeOfType(node, "MethodDefinition")) &&
      (node.kind === "get" || node.kind === "set")
    ) {
      supported = false;
      return false;
    }
    if (!hasClosedLoadedOwnerProviderUse(node, context)) {
      supported = false;
      return false;
    }
    if (!isNodeOfType(node, "Identifier")) return;
    const reference = context.scopes.referenceFor(node);
    if (!reference) return;
    const symbol = reference.resolvedSymbol;
    if (
      UNSUPPORTED_OWNER_GLOBAL_NAMES.has(node.name) ||
      symbol?.kind === "ts-interface" ||
      symbol?.kind === "ts-type-alias" ||
      (symbol?.kind === "import" && getValueImportSource(symbol) === null)
    )
      supported = false;
  });
  if (!supported) {
    analysis.supportedProgram = false;
    return false;
  }
  analysis.supportedProgram = context.scopes.rootScope.symbols.every((symbol) => {
    if (getValueImportSource(symbol) !== "react") return true;
    const named =
      isNodeOfType(symbol.declarationNode, "ImportSpecifier") &&
      getImportedName(symbol.declarationNode) !== "default";
    return symbol.references.every((reference) => {
      if (reference.flag !== "read") return false;
      if (named) return isDirectCall(reference.identifier);
      const member = reference.identifier.parent;
      return (
        isNodeOfType(member, "MemberExpression") &&
        member.object === reference.identifier &&
        !member.optional &&
        REACT_OWNER_API_NAMES.has(getStaticPropertyName(member) ?? "") &&
        isDirectCall(member)
      );
    });
  });
  return analysis.supportedProgram;
};

const hasClosedStateSetter = (
  setter: SymbolDescriptor,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  const declaration = setter.declarationNode;
  if (findEnclosingFunction(declaration) !== owner) return false;
  const proofs = getOwnerSnapshotAnalysis(context).closedSetters;
  const cached = proofs.get(setter);
  if (cached !== undefined) return cached;
  proofs.set(setter, false);
  if (
    setter.kind !== "const" ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    declaration.id.elements.length !== OWNER_STATE_TUPLE_LENGTH ||
    declaration.id.elements[1] !== setter.bindingIdentifier ||
    !isNodeOfType(declaration.id.elements[0], "Identifier") ||
    findEnclosingFunction(declaration) !== owner ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    !isActualOwnerHook(declaration.init, "useState", context) ||
    declaration.init.arguments.length !== DIRECT_HOOK_ARGUMENT_COUNT
  )
    return false;
  const [initial] = declaration.init.arguments;
  if (!isPlainNullLiteral(initial)) return false;
  const closed = setter.references.every((reference) => {
    const call = reference.identifier.parent;
    return (
      reference.flag === "read" &&
      isDirectCall(reference.identifier) &&
      isNodeOfType(call, "CallExpression") &&
      call.arguments.length === DIRECT_HOOK_ARGUMENT_COUNT &&
      !isNodeOfType(call.arguments[0], "SpreadElement") &&
      !isFunctionLike(stripParenExpression(call.arguments[0]))
    );
  });
  proofs.set(setter, closed);
  return closed;
};

const isSupportedCallbackCarrier = (
  callback: EsTreeNode,
  owner: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (
    !isNodeOfType(callback, "ArrowFunctionExpression") ||
    !callback.async ||
    callback.generator ||
    callback.params.some((parameter) => !isNodeOfType(parameter, "Identifier")) ||
    findEnclosingFunction(callback) !== owner
  )
    return false;
  const parent = callback.parent;
  if (isNodeOfType(parent, "VariableDeclarator")) {
    const binding = isNodeOfType(parent.id, "Identifier")
      ? context.scopes.symbolFor(parent.id)
      : null;
    return (
      parent.init === callback && binding?.kind === "const" && isReadonlySymbol(binding, context)
    );
  }
  if (
    !isNodeOfType(parent, "CallExpression") ||
    parent.arguments[0] !== callback ||
    parent.arguments.length !== CALLBACK_HOOK_ARGUMENT_COUNT ||
    !isActualOwnerHook(parent, "useCallback", context) ||
    !isNodeOfType(parent.arguments[1], "ArrayExpression")
  )
    return false;
  if (
    !parent.arguments[1].elements.every((element) => {
      if (!isNodeOfType(element, "Identifier")) return false;
      const input = context.scopes.symbolFor(element);
      return (
        input?.kind === "parameter" &&
        isReadonlySymbol(input, context) &&
        isFunctionLike(owner) &&
        owner.params.some((parameter) => parameter === input.bindingIdentifier)
      );
    })
  )
    return false;
  const declaration = parent.parent;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== parent ||
    !isNodeOfType(declaration.id, "Identifier")
  )
    return false;
  const binding = context.scopes.symbolFor(declaration.id);
  return binding?.kind === "const" && isReadonlySymbol(binding, context);
};

const isDirectOwnerExit = (node: EsTreeNode, callback: EsTreeNode): boolean => {
  let statement = node;
  if (isNodeOfType(statement, "BlockStatement")) {
    if (statement.body.length !== SINGLE_EXIT_STATEMENT_COUNT) return false;
    statement = statement.body[0];
  }
  if (isNodeOfType(statement, "ReturnStatement"))
    return !statement.argument || isNodeOfType(statement.argument, "Literal");
  if (!isNodeOfType(statement, "ThrowStatement")) return false;
  let ancestor = statement.parent;
  while (ancestor && ancestor !== callback) {
    if (isNodeOfType(ancestor, "TryStatement") && (ancestor.handler || ancestor.finalizer))
      return false;
    ancestor = ancestor.parent;
  }
  return ancestor === callback;
};

const isUninterruptedOwnerWindow = (
  guard: OwnerGuard,
  call: EsTreeNode,
  region: OwnerCallbackRegion,
): boolean => {
  const startIndex = getFirstNodeAtOrAfter(region.windowNodes, guard.comparison.range[1]);
  for (let nodeIndex = startIndex; nodeIndex < region.windowNodes.length; nodeIndex++) {
    const node = region.windowNodes[nodeIndex];
    if (node.range[0] >= call.range[0]) return true;
    if (guard.exitBranch && (node === guard.exitBranch || isAstDescendant(node, guard.exitBranch)))
      continue;
    return false;
  }
  return true;
};

export const isReadonlyOwnerSnapshotGuardedClear = (
  call: EsTreeNodeOfType<"CallExpression">,
  callback: EsTreeNode,
  owner: EsTreeNode,
  setter: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  if (
    call.optional ||
    call.arguments.length !== DIRECT_HOOK_ARGUMENT_COUNT ||
    !isPlainNullLiteral(call.arguments[0]) ||
    !isFunctionLike(owner) ||
    owner.async ||
    owner.generator ||
    !isSupportedCallbackCarrier(callback, owner, context) ||
    !hasClosedStateSetter(setter, owner, context)
  )
    return false;
  const region = getOwnerCallbackRegion(callback, context);
  const suspensionCount = getFirstNodeAtOrAfter(region.suspensions, call.range[0]);
  if (!region.supported || suspensionCount === 0) return false;
  const firstSuspensionStart = region.suspensions[0].range[0];
  const lastSuspensionEnd = region.suspensionEnds[suspensionCount - 1];
  const getGuard = (
    condition: EsTreeNode,
    equality: boolean,
    exitBranch: EsTreeNode | null,
  ): OwnerGuard | null => {
    let expression = stripParenExpression(condition);
    while (
      equality &&
      isNodeOfType(expression, "LogicalExpression") &&
      expression.operator === "&&"
    )
      expression = stripParenExpression(expression.left);
    if (
      !isNodeOfType(expression, "BinaryExpression") ||
      expression.operator !== (equality ? "===" : "!==") ||
      expression.range[0] < lastSuspensionEnd
    )
      return null;
    for (const side of [expression.left, expression.right]) {
      const member = stripParenExpression(side);
      if (
        !isNodeOfType(member, "MemberExpression") ||
        member.optional ||
        getStaticPropertyName(member) !== "current" ||
        !isNodeOfType(member.object, "Identifier")
      )
        continue;
      const ref = context.scopes.symbolFor(member.object);
      const snapshot = getOwnerSnapshot(
        side === expression.left ? expression.right : expression.left,
        callback,
        owner,
        firstSuspensionStart,
        context,
      );
      if (
        !ref ||
        !snapshot ||
        !hasClosedOwnerRef(ref, snapshot, callback, owner, firstSuspensionStart, context)
      )
        continue;
      if (!hasSupportedOwnerProgram(context)) continue;
      const guard = { comparison: expression, exitBranch };
      if (isUninterruptedOwnerWindow(guard, call, region)) return guard;
    }
    return null;
  };
  let current: EsTreeNode | null | undefined = call;
  while (current?.parent && current.parent !== callback) {
    const parent: EsTreeNode = current.parent;
    if (
      isNodeOfType(parent, "IfStatement") &&
      isAstDescendant(call, parent.consequent) &&
      getGuard(parent.test, true, null)
    )
      return true;
    if (isNodeOfType(parent, "BlockStatement")) {
      for (const statement of parent.body) {
        if (isAstDescendant(call, statement)) break;
        if (
          isNodeOfType(statement, "IfStatement") &&
          !statement.alternate &&
          isDirectOwnerExit(statement.consequent, callback) &&
          getGuard(statement.test, false, statement.consequent)
        )
          return true;
      }
    }
    if (
      isNodeOfType(parent, "TryStatement") ||
      isNodeOfType(parent, "CatchClause") ||
      UNSUPPORTED_OWNER_REGION_NODE_TYPES.has(parent.type)
    )
      return false;
    current = parent;
  }
  return false;
};
