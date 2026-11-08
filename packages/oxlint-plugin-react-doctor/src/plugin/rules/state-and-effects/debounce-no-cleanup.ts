import { defineRule } from "../../utils/define-rule.js";
import { collectReturnedCleanupFunctions } from "../../utils/collect-returned-cleanup-functions.js";
import { collectBindingAliases } from "../../utils/collect-binding-aliases.js";
import { collectFunctionReturnStatements } from "../../utils/collect-function-return-statements.js";
import { getImportSourceForName } from "../../utils/find-import-source-for-name.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getDestructuredBindingPropertyName } from "../../utils/get-destructured-binding-property-name.js";
import { getDirectConstInitializer } from "../../utils/get-direct-const-initializer.js";
import { getEquivalentSymbols } from "../../utils/get-equivalent-symbols.js";
import { getSymbolMutationInspector } from "../../utils/get-symbol-mutation-inspector.js";
import { getEffectCallback } from "../../utils/get-effect-callback.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isNoOpStatement } from "../../utils/is-no-op-statement.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { hasPossibleStaticPropertyWrite } from "../../utils/has-static-property-write-before.js";
import { isSymbolReadOnly } from "../../utils/is-symbol-read-only.js";
import {
  isProvenEffectHookCall,
  isProvenReactHookCall,
} from "../../utils/is-proven-effect-hook-call.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { walkSynchronousCallbackFlow } from "../../utils/walk-synchronous-callback-flow.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { resolveStableOptionsObject } from "../../utils/resolve-stable-options-object.js";
import { resolveConstIdentifierAlias } from "../../utils/resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "../../utils/resolve-exact-local-function.js";

const DEBOUNCE_WRAPPER_HOOK_NAMES = new Set(["useMemo", "useCallback", "useRef"]);
const USE_MEMO_HOOK_NAMES = new Set(["useMemo"]);
const PASSIVE_EFFECT_HOOK_NAMES = new Set(["useEffect"]);
const LAYOUT_EFFECT_HOOK_NAMES = new Set(["useLayoutEffect"]);
const USE_REF_HOOK_NAMES = new Set(["useRef"]);
const DEBOUNCE_FACTORY_NAMES = new Set(["debounce", "throttle"]);
const DEBOUNCE_RELEASE_METHOD_NAMES = new Set(["cancel", "flush"]);
const NO_OP_STATEMENT_OPTIONS = { isNoOpIdentifier: () => false };
const BROWSER_GLOBAL_NAMES = new Set(["document", "window"]);
const PROMISE_CHAIN_METHOD_NAMES = new Set(["then", "catch", "finally"]);

type FunctionEsTreeNode = EsTreeNodeOfType<
  "ArrowFunctionExpression" | "FunctionExpression" | "FunctionDeclaration"
>;

interface DebounceFunctionUsageIndex {
  effectCallbacks: FunctionEsTreeNode[];
  escapedSymbolIds: Set<number>;
  invokedSymbolIds: Set<number>;
  releasedSymbolIds: Set<number>;
}

interface CompatEffectRegistration {
  effect: FunctionEsTreeNode;
  phase: "layout" | "passive";
  dependencies: EsTreeNodeOfType<"ArrayExpression"> | undefined;
}

interface CompatCleanupGuard {
  identity: SymbolDescriptor | EsTreeNode;
  value: boolean;
}

interface CompatGuardedAction {
  action: "schedule" | "release";
  guard?: CompatCleanupGuard;
}

const isLodashModuleSource = (source: string | null): boolean =>
  source !== null &&
  (source === "lodash" ||
    source === "lodash-es" ||
    source === "lodash.debounce" ||
    source === "lodash.throttle" ||
    source.startsWith("lodash/") ||
    source.startsWith("lodash-es/"));

const isLodashDebounceCall = (callExpression: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpression, "CallExpression")) return false;
  const callee = stripParenExpression(callExpression.callee);
  if (isNodeOfType(callee, "Identifier")) {
    if (!DEBOUNCE_FACTORY_NAMES.has(callee.name)) return false;
    const binding = findVariableInitializer(callee, callee.name);
    if (
      !binding?.initializer ||
      (!isNodeOfType(binding.initializer, "ImportSpecifier") &&
        !isNodeOfType(binding.initializer, "ImportDefaultSpecifier"))
    ) {
      return false;
    }
    return isLodashModuleSource(getImportSourceForName(callee, callee.name));
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    DEBOUNCE_FACTORY_NAMES.has(getStaticPropertyName(callee) ?? "")
  ) {
    const receiver = stripParenExpression(callee.object);
    if (!isNodeOfType(receiver, "Identifier")) return false;
    const binding = findVariableInitializer(receiver, receiver.name);
    if (
      !binding?.initializer ||
      (!isNodeOfType(binding.initializer, "ImportNamespaceSpecifier") &&
        !isNodeOfType(binding.initializer, "ImportDefaultSpecifier"))
    ) {
      return false;
    }
    const receiverSource = getImportSourceForName(receiver, receiver.name);
    return isLodashModuleSource(receiverSource);
  }
  return false;
};

const isCompatDebounceCall = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  if (
    !isNodeOfType(expression, "CallExpression") ||
    expression.optional ||
    expression.arguments.length !== 2 ||
    isNodeOfType(expression.arguments[0], "SpreadElement")
  ) {
    return false;
  }
  const wait = stripParenExpression(expression.arguments[1]);
  if (
    !isNodeOfType(wait, "Literal") ||
    typeof wait.value !== "number" ||
    !Number.isFinite(wait.value) ||
    wait.value < 0
  ) {
    return false;
  }
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const specifier = scopes.symbolFor(callee)?.declarationNode;
  if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") {
    return false;
  }
  const declaration = specifier.parent;
  return (
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "es-toolkit/compat" &&
    getImportedName(specifier) === "debounce"
  );
};

const findDebounceCallInHookInitializer = (
  hookCall: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  if (!isNodeOfType(hookCall, "CallExpression")) return null;
  const firstArgument = hookCall.arguments?.[0];
  if (!firstArgument) return null;
  const strippedArgument = stripParenExpression(firstArgument);
  if (isLodashDebounceCall(strippedArgument)) return strippedArgument;
  if (
    !isNodeOfType(strippedArgument, "ArrowFunctionExpression") &&
    !isNodeOfType(strippedArgument, "FunctionExpression")
  ) {
    return null;
  }
  const allowsCompatFactory =
    !strippedArgument.async &&
    !strippedArgument.generator &&
    isProvenReactHookCall(hookCall, USE_MEMO_HOOK_NAMES, scopes);
  if (!isNodeOfType(strippedArgument.body, "BlockStatement")) {
    const returned = stripParenExpression(strippedArgument.body);
    return isLodashDebounceCall(returned) ||
      (allowsCompatFactory && isCompatDebounceCall(returned, scopes))
      ? returned
      : null;
  }
  const significantStatements = strippedArgument.body.body.filter(
    (statement) => !isNoOpStatement(statement, NO_OP_STATEMENT_OPTIONS),
  );
  for (const statement of strippedArgument.body.body ?? []) {
    if (isNodeOfType(statement, "ReturnStatement") && statement.argument) {
      const returned = stripParenExpression(statement.argument);
      if (
        isLodashDebounceCall(returned) ||
        (allowsCompatFactory &&
          significantStatements.length === 1 &&
          isCompatDebounceCall(returned, scopes))
      ) {
        return returned;
      }
    }
  }
  return null;
};

const hasTrailingFalseOption = (
  debounceCall: EsTreeNode,
  scopes: ScopeAnalysis,
  optionsReadAnchor: EsTreeNode,
): boolean => {
  if (!isNodeOfType(debounceCall, "CallExpression")) return false;
  const optionsArgument = debounceCall.arguments?.[2] as EsTreeNode | undefined;
  if (!optionsArgument) return false;
  const optionsObject = resolveStableOptionsObject(
    optionsArgument,
    ["trailing"],
    scopes,
    optionsReadAnchor,
  );
  if (!optionsObject) return false;
  return optionsObject.properties.some(
    (property) =>
      isNodeOfType(property, "Property") &&
      getStaticPropertyKeyName(property, { allowComputedString: true }) === "trailing" &&
      isNodeOfType(property.value, "Literal") &&
      property.value.value === false,
  );
};

const baseReferenceIdentifier = (expression: EsTreeNode): EsTreeNodeOfType<"Identifier"> | null => {
  let base = stripParenExpression(expression);
  while (isNodeOfType(base, "MemberExpression")) {
    base = stripParenExpression(base.object as EsTreeNode);
  }
  return isNodeOfType(base, "Identifier") ? base : null;
};

const symbolIdForReferenceExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): number | null => {
  const identifier = baseReferenceIdentifier(expression);
  return identifier ? (scopes.symbolFor(identifier)?.id ?? null) : null;
};

const releaseTargetSymbolId = (expression: EsTreeNode, scopes: ScopeAnalysis): number | null => {
  const unwrappedExpression = stripParenExpression(expression);
  if (isNodeOfType(unwrappedExpression, "MemberExpression")) {
    if (!DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(unwrappedExpression) ?? "")) {
      return null;
    }
    return symbolIdForReferenceExpression(unwrappedExpression.object, scopes);
  }
  if (!isNodeOfType(unwrappedExpression, "Identifier")) return null;
  const bindingIdentifier = findVariableInitializer(
    unwrappedExpression,
    unwrappedExpression.name,
  )?.bindingIdentifier;
  const property = bindingIdentifier?.parent;
  if (!isNodeOfType(property, "Property")) return null;
  const propertyName = isNodeOfType(property.key, "Identifier")
    ? property.key.name
    : isNodeOfType(property.key, "Literal") && typeof property.key.value === "string"
      ? property.key.value
      : null;
  if (!propertyName || !DEBOUNCE_RELEASE_METHOD_NAMES.has(propertyName)) return null;
  const pattern = property.parent;
  const declarator = pattern?.parent;
  if (
    !isNodeOfType(pattern, "ObjectPattern") ||
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !declarator.init
  ) {
    return null;
  }
  return symbolIdForReferenceExpression(declarator.init as EsTreeNode, scopes);
};

const addCleanupReleaseSymbols = (
  cleanupFunction: EsTreeNode,
  releasedSymbolIds: Set<number>,
  scopes: ScopeAnalysis,
): void => {
  walkAst(cleanupFunction, (child: EsTreeNode) => {
    if (child !== cleanupFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const symbolId = releaseTargetSymbolId(child.callee as EsTreeNode, scopes);
    if (symbolId !== null) releasedSymbolIds.add(symbolId);
  });
};

const buildFunctionUsageIndex = (
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): DebounceFunctionUsageIndex => {
  const escapedSymbolIds = new Set<number>();
  const invokedSymbolIds = new Set<number>();
  const releasedSymbolIds = new Set<number>();
  const effectCallbacks: FunctionEsTreeNode[] = [];

  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = stripParenExpression(child.callee);
    if (isProvenEffectHookCall(child, scopes)) {
      const effectArgument = child.arguments?.[0];
      const effectCallback = effectArgument ? stripParenExpression(effectArgument) : null;
      if (effectCallback && isFunctionLike(effectCallback)) {
        if (findEnclosingFunction(child) === enclosingFunction)
          effectCallbacks.push(effectCallback);
        walkSynchronousCallbackFlow(effectCallback, (effectChild: EsTreeNode) => {
          if (!isNodeOfType(effectChild, "CallExpression")) return;
          const symbolId = symbolIdForReferenceExpression(effectChild.callee as EsTreeNode, scopes);
          if (symbolId !== null) invokedSymbolIds.add(symbolId);
        });
        if (!isNodeOfType(effectCallback.body, "BlockStatement")) {
          const symbolId = releaseTargetSymbolId(effectCallback.body, scopes);
          if (symbolId !== null) releasedSymbolIds.add(symbolId);
        } else {
          for (const returnStatement of collectFunctionReturnStatements(effectCallback)) {
            if (!returnStatement.argument) continue;
            const symbolId = releaseTargetSymbolId(returnStatement.argument, scopes);
            if (symbolId !== null) releasedSymbolIds.add(symbolId);
          }
        }
        for (const cleanupFunction of collectReturnedCleanupFunctions(effectCallback)) {
          addCleanupReleaseSymbols(cleanupFunction, releasedSymbolIds, scopes);
        }
      }
    }
    if (
      isNodeOfType(callee, "Identifier") &&
      callee.name === "useUnmount" &&
      (getImportSourceForName(callee, callee.name) === "react-use" ||
        !findVariableInitializer(callee, callee.name))
    ) {
      for (const argument of child.arguments ?? []) {
        const symbolId = releaseTargetSymbolId(argument as EsTreeNode, scopes);
        if (symbolId !== null) releasedSymbolIds.add(symbolId);
      }
    }
    if (!isNodeOfType(callee, "Identifier")) return;
    if (!isReactHookName(callee.name)) return;
    const helper = findVariableInitializer(callee, callee.name)?.initializer;
    if (!helper || !isFunctionLike(helper)) return;
    const releasingParameterNames = new Set<string>();
    walkAst(helper, (helperChild: EsTreeNode) => {
      if (
        !isNodeOfType(helperChild, "CallExpression") ||
        !isProvenEffectHookCall(helperChild, scopes)
      )
        return;
      const effectCallback = getEffectCallback(helperChild);
      if (!effectCallback) return;
      for (const cleanupFunction of collectReturnedCleanupFunctions(effectCallback)) {
        walkAst(cleanupFunction, (cleanupChild: EsTreeNode) => {
          if (!isNodeOfType(cleanupChild, "CallExpression")) return;
          const cleanupCallee = stripParenExpression(cleanupChild.callee);
          if (
            !isNodeOfType(cleanupCallee, "MemberExpression") ||
            !DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(cleanupCallee) ?? "")
          ) {
            return;
          }
          const receiver = baseReferenceIdentifier(cleanupCallee.object as EsTreeNode);
          if (receiver) releasingParameterNames.add(receiver.name);
        });
      }
    });
    for (const [parameterIndex, parameter] of (helper.params ?? []).entries()) {
      if (!isNodeOfType(parameter, "Identifier") || !releasingParameterNames.has(parameter.name)) {
        continue;
      }
      const argument = child.arguments?.[parameterIndex];
      const symbolId = argument
        ? symbolIdForReferenceExpression(argument as EsTreeNode, scopes)
        : null;
      if (symbolId !== null) releasedSymbolIds.add(symbolId);
    }
  });

  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (child !== enclosingFunction && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "ReturnStatement") || !child.argument) return;
    const returned = stripParenExpression(child.argument);
    if (
      !isNodeOfType(returned, "Identifier") &&
      !isNodeOfType(returned, "ObjectExpression") &&
      !isNodeOfType(returned, "ArrayExpression")
    ) {
      return;
    }
    walkAst(returned, (returnChild: EsTreeNode) => {
      if (!isNodeOfType(returnChild, "Identifier")) return;
      const symbolId = scopes.symbolFor(returnChild)?.id;
      if (symbolId !== undefined) escapedSymbolIds.add(symbolId);
    });
  });

  return { effectCallbacks, escapedSymbolIds, invokedSymbolIds, releasedSymbolIds };
};

const getStableCompatSymbolId = (expression: EsTreeNode, scopes: ScopeAnalysis): number | null => {
  const symbol = resolveConstIdentifierAlias(stripParenExpression(expression), scopes);
  return symbol?.kind === "const" && isSymbolReadOnly(symbol) ? symbol.id : null;
};

const hasCompatReleaseWrite = (
  receiver: EsTreeNode,
  method: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (hasPossibleStaticPropertyWrite(receiver, method, scopes)) return true;
  const mutations = getSymbolMutationInspector(scopes);
  return getEquivalentSymbols(receiver, scopes).some((symbol) =>
    symbol.references.some((reference) => {
      const properties = mutations.getMutationPropertyNames(reference.identifier);
      return properties === null || Boolean(properties?.has(method));
    }),
  );
};

const hasCompatContainerEscape = (
  identifier: EsTreeNode,
  scopes: ScopeAnalysis,
  effectCallbacks: ReadonlyArray<FunctionEsTreeNode>,
): boolean => {
  const symbolId = getStableCompatSymbolId(identifier, scopes);
  const owner = findEnclosingFunction(identifier);
  if (symbolId === null || !owner) return true;
  const inlineEffectCallbacks = effectCallbacks.filter((effect) => {
    const callback = findTransparentExpressionRoot(effect);
    const call = callback.parent;
    return (
      isNodeOfType(call, "CallExpression") &&
      call.arguments[0] === callback &&
      isProvenEffectHookCall(call, scopes)
    );
  });
  const allowedCapturingFunctions = new Set<EsTreeNode>([
    owner,
    ...inlineEffectCallbacks,
    ...inlineEffectCallbacks.flatMap((effect) =>
      collectReturnedCleanupFunctions(effect, scopes).filter((cleanup) => {
        const returned = findTransparentExpressionRoot(cleanup);
        const statement = returned.parent;
        return (
          returned === effect.body ||
          (isNodeOfType(statement, "ReturnStatement") &&
            statement.argument === returned &&
            findEnclosingFunction(statement) === effect)
        );
      }),
    ),
  ]);
  let didEscape = false;
  walkAst(owner, (node) => {
    if (didEscape) return false;
    if (
      (isNodeOfType(node, "CallExpression") || isNodeOfType(node, "NewExpression")) &&
      !(isNodeOfType(node, "CallExpression") && isProvenEffectHookCall(node, scopes))
    ) {
      for (const [argumentIndex, argument] of node.arguments.entries()) {
        if (
          argumentIndex === 1 &&
          isNodeOfType(node, "CallExpression") &&
          isProvenReactHookCall(node, DEBOUNCE_WRAPPER_HOOK_NAMES, scopes)
        ) {
          continue;
        }
        const localFunction = resolveExactLocalFunction(argument, scopes);
        walkAst(localFunction ?? argument, (child) => {
          if (
            isNodeOfType(child, "Identifier") &&
            (getStableCompatSymbolId(child, scopes) === symbolId ||
              isClosedCompatReleaseAlias(child, symbolId, scopes))
          ) {
            didEscape = true;
          }
          return !didEscape;
        });
        if (didEscape) return false;
      }
    }
    if (
      !isNodeOfType(node, "Identifier") ||
      (getStableCompatSymbolId(node, scopes) !== symbolId &&
        !isClosedCompatReleaseAlias(node, symbolId, scopes))
    ) {
      return;
    }
    const capturingFunction = findEnclosingFunction(node);
    if (!capturingFunction || !allowedCapturingFunctions.has(capturingFunction)) {
      didEscape = true;
      return false;
    }
    let root = findTransparentExpressionRoot(node);
    if (isNodeOfType(root.parent, "MemberExpression") && root.parent.object === root) {
      if (!DEBOUNCE_RELEASE_METHOD_NAMES.has(getStaticPropertyName(root.parent) ?? "")) {
        didEscape = true;
        return false;
      }
      root = findTransparentExpressionRoot(root.parent);
    }
    const container = root.parent;
    if (isNodeOfType(container, "ArrayExpression")) {
      const array = findTransparentExpressionRoot(container);
      const hook = array.parent;
      didEscape = !(
        isNodeOfType(hook, "CallExpression") &&
        hook.arguments[1] === array &&
        (isProvenEffectHookCall(hook, scopes) ||
          isProvenReactHookCall(hook, DEBOUNCE_WRAPPER_HOOK_NAMES, scopes))
      );
      return;
    }
    didEscape = Boolean(
      ((isNodeOfType(container, "CallExpression") || isNodeOfType(container, "NewExpression")) &&
        container.arguments.some((argument) => argument === root)) ||
      (isNodeOfType(container, "Property") &&
        container.value === root &&
        isNodeOfType(container.parent, "ObjectExpression")) ||
      (isNodeOfType(container, "AssignmentExpression") && container.right === root) ||
      (isNodeOfType(container, "VariableDeclarator") &&
        container.init === root &&
        isNodeOfType(container.parent, "VariableDeclaration") &&
        container.parent.kind !== "const") ||
      (isNodeOfType(container, "ReturnStatement") && findEnclosingFunction(node) === owner) ||
      isNodeOfType(container, "SpreadElement") ||
      isNodeOfType(container, "JSXExpressionContainer"),
    );
  });
  return didEscape;
};

const isStableCompatReleaseMember = (
  expression: EsTreeNode,
  symbolId: number,
  scopes: ScopeAnalysis,
): boolean => {
  const member = stripParenExpression(expression);
  if (!isNodeOfType(member, "MemberExpression")) return false;
  const method = getStaticPropertyName(member);
  const receiver = stripParenExpression(member.object);
  return (
    method !== null &&
    DEBOUNCE_RELEASE_METHOD_NAMES.has(method) &&
    getStableCompatSymbolId(receiver, scopes) === symbolId &&
    !hasCompatReleaseWrite(receiver, method, scopes)
  );
};

const isClosedCompatReleaseAlias = (
  expression: EsTreeNode,
  symbolId: number,
  scopes: ScopeAnalysis,
): boolean => {
  const symbol = resolveConstIdentifierAlias(stripParenExpression(expression), scopes, true);
  if (
    symbol?.kind !== "const" ||
    !isSymbolReadOnly(symbol) ||
    !isNodeOfType(symbol.declarationNode, "VariableDeclarator")
  ) {
    return false;
  }
  const declaration = symbol.declarationNode;
  if (!declaration.init) return false;
  const initializer = stripParenExpression(declaration.init);
  let receiver: EsTreeNode;
  let method: string | null;
  if (declaration.id === symbol.bindingIdentifier) {
    if (!isNodeOfType(initializer, "MemberExpression")) return false;
    receiver = initializer.object;
    method = getStaticPropertyName(initializer);
  } else {
    const assignment = symbol.bindingIdentifier.parent;
    const binding =
      isNodeOfType(assignment, "AssignmentPattern") && assignment.left === symbol.bindingIdentifier
        ? assignment
        : symbol.bindingIdentifier;
    const property = binding.parent;
    if (
      !isNodeOfType(declaration.id, "ObjectPattern") ||
      !isNodeOfType(property, "Property") ||
      property.parent !== declaration.id ||
      property.value !== binding
    ) {
      return false;
    }
    receiver = initializer;
    method = getDestructuredBindingPropertyName(symbol.bindingIdentifier);
  }
  return (
    method !== null &&
    DEBOUNCE_RELEASE_METHOD_NAMES.has(method) &&
    getStableCompatSymbolId(receiver, scopes) === symbolId &&
    !hasCompatReleaseWrite(stripParenExpression(receiver), method, scopes)
  );
};

const getStableCompatValueBinding = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): SymbolDescriptor | null => {
  const readBinding = (value: EsTreeNode): SymbolDescriptor | null => {
    const identifier = stripParenExpression(value);
    if (!isNodeOfType(identifier, "Identifier")) return null;
    const symbol = scopes.symbolFor(identifier);
    return symbol && symbol.kind !== "import" && symbol.kind !== "var" && isSymbolReadOnly(symbol)
      ? symbol
      : null;
  };
  let binding = readBinding(expression);
  const visited = new Set<number>();
  while (binding) {
    if (visited.has(binding.id)) return null;
    visited.add(binding.id);
    const initializer = getDirectConstInitializer(binding);
    const source = initializer && readBinding(initializer);
    if (!source) return binding;
    binding = source;
  }
  return null;
};

const summarizeCompatGuardedActions = (
  actions: ReadonlyArray<CompatGuardedAction>,
): CompatGuardedAction["action"] | "none" => {
  const remainingGuards = new Map<CompatCleanupGuard["identity"], boolean>();
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const step = actions[index];
    if (!step.guard) return step.action;
    const { identity, value } = step.guard;
    const required = remainingGuards.get(identity);
    if (required !== undefined && required !== value) continue;
    if (step.action === "schedule") return "schedule";
    if (required === value) return "release";
    remainingGuards.set(identity, !value);
  }
  return "none";
};

const getCompatSetupAction = (
  effect: FunctionEsTreeNode,
  symbolId: number,
  scopes: ScopeAnalysis,
  onSchedule?: () => void,
  allowConditionalCleanup = false,
): CompatGuardedAction["action"] | "none" | null => {
  if (effect.async || effect.generator) return null;
  const isSameInstance = (expression: EsTreeNode): boolean =>
    getStableCompatSymbolId(expression, scopes) === symbolId;
  const referencesInstance = (expression: EsTreeNode): boolean => {
    let references = false;
    walkAst(expression, (child) => {
      if (isNodeOfType(child, "Identifier") && isSameInstance(child)) {
        references = true;
      }
      return !references;
    });
    return references;
  };
  const actions: CompatGuardedAction[] = [];
  const readCall = (expression: EsTreeNode): CompatGuardedAction["action"] | null => {
    const call = stripParenExpression(expression);
    if (!isNodeOfType(call, "CallExpression")) return null;
    const callee = stripParenExpression(call.callee);
    if (call.arguments.some((argument) => referencesInstance(argument))) return null;
    if (isNodeOfType(callee, "Identifier") && isSameInstance(callee)) {
      onSchedule?.();
      return "schedule";
    }
    if (
      isClosedCompatReleaseAlias(callee, symbolId, scopes) ||
      isStableCompatReleaseMember(callee, symbolId, scopes)
    ) {
      return "release";
    }
    return null;
  };
  const isPlainGuardValue = (expression: EsTreeNode): boolean => {
    const value = stripParenExpression(expression);
    const operand =
      isNodeOfType(value, "UnaryExpression") && value.operator === "!"
        ? stripParenExpression(value.argument)
        : value;
    return (
      isNodeOfType(operand, "Literal") ||
      (isNodeOfType(operand, "Identifier") &&
        Boolean(scopes.symbolFor(operand)) &&
        !isSameInstance(operand) &&
        !isClosedCompatReleaseAlias(operand, symbolId, scopes))
    );
  };
  const readExpression = (
    expression: EsTreeNode,
  ): CompatGuardedAction["action"] | "none" | null => {
    const value = stripParenExpression(expression);
    if (
      allowConditionalCleanup &&
      isNodeOfType(value, "AssignmentExpression") &&
      value.operator === "=" &&
      isNodeOfType(value.left, "Identifier") &&
      isPlainGuardValue(value.left) &&
      isPlainGuardValue(value.right)
    ) {
      return "none";
    }
    return readCall(value);
  };
  const record = (
    action: CompatGuardedAction["action"] | "none" | null,
    guard?: CompatCleanupGuard,
  ): boolean => {
    if (action === null) return false;
    if (action !== "none") actions.push(guard ? { action, guard } : { action });
    return true;
  };
  const readCleanupBranch = (
    statement: EsTreeNode | null | undefined,
  ): CompatGuardedAction["action"] | "none" | null => {
    if (!statement) return "none";
    const statements = isNodeOfType(statement, "BlockStatement") ? statement.body : [statement];
    let latest: CompatGuardedAction["action"] | "none" = "none";
    for (const child of statements) {
      if (isNoOpStatement(child, NO_OP_STATEMENT_OPTIONS)) continue;
      if (!isNodeOfType(child, "ExpressionStatement")) return null;
      const action = readExpression(child.expression);
      if (action === null) return null;
      if (action !== "none") latest = action;
    }
    return latest;
  };
  const readConditional = (statement: EsTreeNodeOfType<"IfStatement">): boolean => {
    const condition = stripParenExpression(statement.test);
    const isNegated = isNodeOfType(condition, "UnaryExpression") && condition.operator === "!";
    const operand = isNegated ? stripParenExpression(condition.argument) : condition;
    let knownValue: boolean | undefined;
    let identity: CompatCleanupGuard["identity"] = statement;
    if (isNodeOfType(operand, "Literal") && typeof operand.value === "boolean") {
      knownValue = operand.value;
    } else if (isNodeOfType(operand, "Identifier")) {
      const symbol = getStableCompatValueBinding(operand, scopes);
      if (isSameInstance(operand) || isClosedCompatReleaseAlias(operand, symbolId, scopes))
        return false;
      if (!symbol) return false;
      identity = symbol;
      if (symbol.kind !== "parameter") {
        const initializer = getDirectConstInitializer(symbol);
        const value = initializer && stripParenExpression(initializer);
        if (!isNodeOfType(value, "Literal") || typeof value.value !== "boolean") return false;
        knownValue = value.value;
      }
    } else {
      return false;
    }
    if (knownValue !== undefined) {
      return record(
        readCleanupBranch(knownValue !== isNegated ? statement.consequent : statement.alternate),
      );
    }
    return (
      record(readCleanupBranch(statement.consequent), { identity, value: !isNegated }) &&
      record(readCleanupBranch(statement.alternate), { identity, value: isNegated })
    );
  };

  if (!isNodeOfType(effect.body, "BlockStatement")) {
    return record(readExpression(effect.body)) ? summarizeCompatGuardedActions(actions) : null;
  }
  for (const statement of effect.body.body) {
    if (isNoOpStatement(statement, NO_OP_STATEMENT_OPTIONS)) continue;
    if (
      isNodeOfType(statement, "ExpressionStatement") &&
      record(readExpression(statement.expression))
    )
      continue;
    if (
      allowConditionalCleanup &&
      isNodeOfType(statement, "IfStatement") &&
      readConditional(statement)
    )
      continue;
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      statement.declarations.every(
        (declaration) =>
          isNodeOfType(declaration.id, "Identifier") &&
          declaration.init &&
          ((statement.kind === "const" &&
            (isNodeOfType(stripParenExpression(declaration.init), "Identifier") ||
              isClosedCompatReleaseAlias(declaration.id, symbolId, scopes))) ||
            (allowConditionalCleanup &&
              (statement.kind === "const" || statement.kind === "let") &&
              isPlainGuardValue(declaration.init))),
      )
    )
      continue;
    if (isNodeOfType(statement, "ReturnStatement")) {
      const returned = statement.argument && stripParenExpression(statement.argument);
      if (allowConditionalCleanup && isNodeOfType(returned, "CallExpression")) {
        return record(readExpression(returned)) ? summarizeCompatGuardedActions(actions) : null;
      }
      return !returned || isFunctionLike(returned) || isNodeOfType(returned, "Identifier")
        ? summarizeCompatGuardedActions(actions)
        : null;
    }
    return null;
  }
  return summarizeCompatGuardedActions(actions);
};

const getCompatCleanupAction = (
  effect: FunctionEsTreeNode,
  symbolId: number,
  scopes: ScopeAnalysis,
): "schedule" | "release" | "none" | null => {
  if (effect.async || effect.generator) return null;
  let returned: EsTreeNode;
  if (isNodeOfType(effect.body, "BlockStatement")) {
    const statements = effect.body.body.filter(
      (statement) => !isNoOpStatement(statement, NO_OP_STATEMENT_OPTIONS),
    );
    const final = statements.at(-1);
    if (
      !isNodeOfType(final, "ReturnStatement") ||
      !final.argument ||
      !statements
        .slice(0, -1)
        .every(
          (statement) =>
            isNodeOfType(statement, "ExpressionStatement") ||
            isNodeOfType(statement, "VariableDeclaration"),
        )
    ) {
      return null;
    }
    returned = stripParenExpression(final.argument);
  } else {
    returned = stripParenExpression(effect.body);
  }
  if (
    isClosedCompatReleaseAlias(returned, symbolId, scopes) ||
    isStableCompatReleaseMember(returned, symbolId, scopes)
  ) {
    return "release";
  }
  const cleanup = isNodeOfType(returned, "Identifier")
    ? resolveExactLocalFunction(returned, scopes)
    : returned;
  return isFunctionLike(cleanup)
    ? getCompatSetupAction(cleanup, symbolId, scopes, undefined, true)
    : null;
};

const isClosedOptionalCompatEffect = (
  call: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = stripParenExpression(call.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  const binding = resolveConstIdentifierAlias(callee, scopes);
  const specifier = binding?.declarationNode;
  if (!isNodeOfType(specifier, "ImportSpecifier") || specifier.importKind === "type") return false;
  const declaration = specifier.parent;
  return (
    isNodeOfType(declaration, "ImportDeclaration") &&
    declaration.importKind !== "type" &&
    declaration.source.value === "react" &&
    (getImportedName(specifier) === "useEffect" || getImportedName(specifier) === "useLayoutEffect")
  );
};

const getCompatEffectRegistration = (
  effect: FunctionEsTreeNode,
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): CompatEffectRegistration | null => {
  const parentCall = findTransparentExpressionRoot(effect).parent;
  if (!isNodeOfType(parentCall, "CallExpression") || !isFunctionLike(enclosingFunction))
    return null;
  const statement = findTransparentExpressionRoot(parentCall).parent;
  if (
    !isNodeOfType(statement, "ExpressionStatement") ||
    statement.parent !== enclosingFunction.body ||
    stripParenExpression(statement.expression) !== parentCall ||
    (parentCall.optional && !isClosedOptionalCompatEffect(parentCall, scopes)) ||
    (parentCall.arguments.length !== 1 && parentCall.arguments.length !== 2) ||
    getEffectCallback(parentCall) !== effect
  ) {
    return null;
  }
  const phase = isProvenReactHookCall(parentCall, PASSIVE_EFFECT_HOOK_NAMES, scopes)
    ? "passive"
    : isProvenReactHookCall(parentCall, LAYOUT_EFFECT_HOOK_NAMES, scopes)
      ? "layout"
      : null;
  if (!phase) return null;
  const argument = parentCall.arguments[1];
  if (!argument) return { effect, phase, dependencies: undefined };
  const dependencies = stripParenExpression(argument);
  return isNodeOfType(dependencies, "ArrayExpression") ? { effect, phase, dependencies } : null;
};

const getCompatDependencyIdentity = (
  dependency: EsTreeNode | null | undefined,
  scopes: ScopeAnalysis,
): SymbolDescriptor | string | number | boolean | null | undefined => {
  if (!dependency) return undefined;
  const expression = stripParenExpression(dependency);
  if (isNodeOfType(expression, "Identifier")) {
    return getStableCompatValueBinding(expression, scopes) ?? undefined;
  }
  if (!isNodeOfType(expression, "Literal")) return undefined;
  const { value } = expression;
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
    ? value
    : undefined;
};

const activatesWithCompatSetup = (
  owner: CompatEffectRegistration,
  following: CompatEffectRegistration,
  scopes: ScopeAnalysis,
): boolean => {
  if (owner.phase !== following.phase) return false;
  if (!following.dependencies) return true;
  if (!owner.dependencies) return false;
  const ownerDependencies = owner.dependencies.elements.map((item) =>
    getCompatDependencyIdentity(item, scopes),
  );
  const followingDependencies = following.dependencies.elements.map((item) =>
    getCompatDependencyIdentity(item, scopes),
  );
  return (
    !ownerDependencies.includes(undefined) &&
    !followingDependencies.includes(undefined) &&
    ownerDependencies.every((dependency) =>
      followingDependencies.some((followingDependency) =>
        Object.is(followingDependency, dependency),
      ),
    )
  );
};

const leavesCompatInvocationPending = (
  scheduling: FunctionEsTreeNode,
  initialAction: "schedule" | "release" | "none",
  effects: ReadonlyArray<FunctionEsTreeNode>,
  enclosingFunction: EsTreeNode,
  symbolId: number,
  hasStableMemoInstance: boolean,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    effects.some(
      (effect) =>
        getCompatCleanupAction(effect, symbolId, scopes) === null &&
        (isNodeOfType(effect.body, "BlockStatement")
          ? collectFunctionReturnStatements(effect).some((statement) => Boolean(statement.argument))
          : getCompatSetupAction(effect, symbolId, scopes) === null),
    )
  ) {
    return false;
  }
  const registrations = effects.flatMap((effect) => {
    const registration = getCompatEffectRegistration(effect, enclosingFunction, scopes);
    return registration ? [registration] : [];
  });
  const ownerIndex = registrations.findIndex((registration) => registration.effect === scheduling);
  const owner = registrations[ownerIndex];
  if (!owner) {
    const cleanup = getCompatCleanupAction(scheduling, symbolId, scopes);
    return cleanup === "schedule" || (initialAction === "schedule" && cleanup !== "release");
  }
  const isMountOnly = (registration: CompatEffectRegistration): boolean =>
    registration.dependencies?.elements.length === 0;
  const tracksInstance = (registration: CompatEffectRegistration): boolean =>
    !registration.dependencies ||
    registration.dependencies.elements.some(
      (dependency) =>
        dependency &&
        (getStableCompatSymbolId(dependency, scopes) === symbolId ||
          isClosedCompatReleaseAlias(dependency, symbolId, scopes)),
    );
  const sameGeneration = (
    first: CompatEffectRegistration,
    second: CompatEffectRegistration,
  ): boolean =>
    first === second ||
    hasStableMemoInstance ||
    (isMountOnly(first) && isMountOnly(second)) ||
    (tracksInstance(first) && tracksInstance(second));
  const pending = new Map<CompatEffectRegistration, "setup" | "cleanup">();
  if (initialAction === "schedule") pending.set(owner, "setup");
  const apply = (
    registration: CompatEffectRegistration,
    action: "schedule" | "release" | "none" | null,
    phase: "setup" | "cleanup",
  ): void => {
    if (action === "schedule") {
      pending.set(registration, phase);
    } else if (action === "release") {
      for (const [source, sourcePhase] of pending) {
        if (
          sourcePhase === "cleanup" &&
          source.phase === "layout" &&
          registration.phase === "passive"
        )
          continue;
        if (
          (phase === "setup" && sourcePhase === "setup") ||
          sameGeneration(source, registration)
        ) {
          pending.delete(source);
        }
      }
    }
  };
  for (const registration of registrations.slice(ownerIndex + 1)) {
    if (activatesWithCompatSetup(owner, registration, scopes)) {
      apply(registration, getCompatSetupAction(registration.effect, symbolId, scopes), "setup");
    }
  }
  for (const phase of ["layout", "passive"]) {
    for (const registration of registrations) {
      if (registration.phase === phase) {
        apply(
          registration,
          getCompatCleanupAction(registration.effect, symbolId, scopes),
          "cleanup",
        );
      }
    }
  }
  return pending.size > 0;
};

const resolveWrappedCallbackFunction = (
  debounceCall: EsTreeNode,
  enclosingFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): FunctionEsTreeNode | null => {
  if (!isNodeOfType(debounceCall, "CallExpression")) return null;
  const wrappedArgument = debounceCall.arguments?.[0];
  if (!wrappedArgument) return null;
  const strippedArgument = stripParenExpression(wrappedArgument);
  if (isFunctionLike(strippedArgument)) return strippedArgument;
  if (!isNodeOfType(strippedArgument, "Identifier")) return null;
  const wrappedName = strippedArgument.name;
  let resolvedFunction: FunctionEsTreeNode | null = null;
  walkAst(enclosingFunction, (child: EsTreeNode) => {
    if (resolvedFunction) return false;
    if (isNodeOfType(child, "FunctionDeclaration") && child.id?.name === wrappedName) {
      resolvedFunction = child;
      return false;
    }
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      child.id.name === wrappedName &&
      child.init
    ) {
      const initializer = stripParenExpression(child.init);
      if (isFunctionLike(initializer)) {
        resolvedFunction = initializer;
        return false;
      }
      if (
        isNodeOfType(initializer, "CallExpression") &&
        isProvenReactHookCall(initializer, new Set(["useCallback"]), scopes)
      ) {
        const callbackArgument = initializer.arguments?.[0];
        const strippedCallback = callbackArgument ? stripParenExpression(callbackArgument) : null;
        if (strippedCallback && isFunctionLike(strippedCallback)) {
          resolvedFunction = strippedCallback;
          return false;
        }
      }
    }
  });
  return resolvedFunction;
};

const WEB_STORAGE_RECEIVER_NAMES = new Set(["localStorage", "sessionStorage"]);

const chainEndsInCatch = (callNode: EsTreeNode): boolean => {
  let outermost: EsTreeNode = callNode;
  while (true) {
    const parent = outermost.parent;
    if (
      parent &&
      isNodeOfType(parent, "MemberExpression") &&
      parent.object === outermost &&
      parent.parent &&
      isNodeOfType(parent.parent, "CallExpression") &&
      parent.parent.callee === parent
    ) {
      outermost = parent.parent;
      continue;
    }
    break;
  }
  return (
    isNodeOfType(outermost, "CallExpression") &&
    isNodeOfType(outermost.callee, "MemberExpression") &&
    getStaticPropertyName(outermost.callee) === "catch"
  );
};

const hasAsyncOrDomWork = (
  wrappedFunction: FunctionEsTreeNode,
  skipNestedFunctions = false,
): boolean => {
  if (wrappedFunction.async) return true;
  // A callback param shadowing a browser global (`(document) => ...` for a
  // domain noun) is a different binding entirely.
  const shadowedNames = new Set<string>();
  for (const param of wrappedFunction.params ?? []) {
    collectPatternNames(param as EsTreeNode, shadowedNames);
  }
  let didFindWork = false;
  walkAst(wrappedFunction, (child: EsTreeNode) => {
    if (didFindWork) return false;
    if (skipNestedFunctions && child !== wrappedFunction && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "AwaitExpression")) {
      didFindWork = true;
      return false;
    }
    const parent = child.parent;
    if (
      isNodeOfType(child, "Identifier") &&
      BROWSER_GLOBAL_NAMES.has(child.name) &&
      !shadowedNames.has(child.name) &&
      !findVariableInitializer(child, child.name) &&
      !(
        isNodeOfType(parent, "MemberExpression") &&
        !parent.computed &&
        parent.property === child
      ) &&
      !(isNodeOfType(parent, "Property") && !parent.computed && parent.key === child)
    ) {
      // Reading a metric off the global (`window.innerWidth`) into state is
      // benign after unmount; writing debounced persistence
      // (`localStorage.setItem(...)`) is the POINT of the trailing call.
      // Only calls THROUGH the global (`document.title = ...` assignments,
      // `window.scrollTo(...)`) remain DOM work.
      if (isNodeOfType(parent, "MemberExpression") && parent.object === child) {
        const isStorageReceiver =
          isNodeOfType(parent.property, "Identifier") &&
          WEB_STORAGE_RECEIVER_NAMES.has(parent.property.name);
        if (isStorageReceiver) return;
        // metric/member READ: the member is not itself called
        let cursor: EsTreeNode = parent;
        while (
          cursor.parent &&
          isNodeOfType(cursor.parent, "MemberExpression") &&
          cursor.parent.object === cursor
        ) {
          cursor = cursor.parent;
        }
        const isCalled =
          cursor.parent &&
          isNodeOfType(cursor.parent, "CallExpression") &&
          cursor.parent.callee === cursor;
        const isAssigned =
          cursor.parent &&
          isNodeOfType(cursor.parent, "AssignmentExpression") &&
          cursor.parent.left === cursor;
        if (!isCalled && !isAssigned) return;
      }
      didFindWork = true;
      return false;
    }
    if (isNodeOfType(child, "CallExpression")) {
      const callee = child.callee;
      if (
        isNodeOfType(callee, "Identifier") &&
        callee.name === "fetch" &&
        !findVariableInitializer(callee, callee.name)
      ) {
        didFindWork = true;
        return false;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        PROMISE_CHAIN_METHOD_NAMES.has(getStaticPropertyName(callee) ?? "") &&
        getStaticPropertyName(callee) !== "catch" &&
        !chainEndsInCatch(child)
      ) {
        didFindWork = true;
        return false;
      }
      if (
        isNodeOfType(callee, "MemberExpression") &&
        isNodeOfType(callee.object, "Identifier") &&
        WEB_STORAGE_RECEIVER_NAMES.has(callee.object.name)
      ) {
        return;
      }
    }
  });
  return didFindWork;
};

const isNullishRefInitializer = (expression: EsTreeNode | undefined): boolean => {
  if (!expression) return true;
  const initializer = stripParenExpression(expression);
  return (
    (isNodeOfType(initializer, "Literal") && initializer.value === null) ||
    (isNodeOfType(initializer, "Identifier") && initializer.name === "undefined") ||
    (isNodeOfType(initializer, "UnaryExpression") && initializer.operator === "void")
  );
};

const isUnmountClearedRefCurrentRead = (
  memberExpression: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !isNodeOfType(memberExpression, "MemberExpression") ||
    getStaticPropertyName(memberExpression) !== "current"
  ) {
    return false;
  }
  const receiver = stripParenExpression(memberExpression.object);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  if (!symbol) return true;
  if (!symbol.initializer) return false;
  const initializer = stripParenExpression(symbol.initializer);
  return (
    isNodeOfType(initializer, "CallExpression") &&
    isProvenReactHookCall(initializer, USE_REF_HOOK_NAMES, scopes) &&
    isNullishRefInitializer(initializer.arguments?.[0] as EsTreeNode | undefined)
  );
};

const startsWithNullRefGuard = (
  wrappedFunction: FunctionEsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(wrappedFunction.body, "BlockStatement")) return false;
  // TS narrowing hoists the read: `const el = ref.current; if (!el) return;`
  // (or an optional-chained measurement) — collect leading bindings seeded
  // from a `.current` read, then find the early-return guard among the
  // leading statements.
  const currentSeededNames = new Set<string>();
  const readsCurrentOrSeeded = (root: EsTreeNode): boolean => {
    let found = false;
    walkAst(root, (child: EsTreeNode) => {
      if (found) return false;
      if (isUnmountClearedRefCurrentRead(child, scopes)) {
        found = true;
        return false;
      }
      if (isNodeOfType(child, "Identifier") && currentSeededNames.has(child.name)) {
        found = true;
        return false;
      }
    });
    return found;
  };
  for (const statement of wrappedFunction.body.body ?? []) {
    if (
      isNodeOfType(statement, "VariableDeclaration") &&
      (statement.declarations ?? []).every(
        (declarator) => declarator.init && readsCurrentOrSeeded(declarator.init as EsTreeNode),
      )
    ) {
      for (const declarator of statement.declarations ?? []) {
        if (isNodeOfType(declarator.id, "Identifier")) currentSeededNames.add(declarator.id.name);
      }
      continue;
    }
    if (isNodeOfType(statement, "IfStatement")) {
      const consequent = statement.consequent;
      const isEarlyReturn =
        isNodeOfType(consequent, "ReturnStatement") ||
        (isNodeOfType(consequent, "BlockStatement") &&
          isNodeOfType(consequent.body?.[0], "ReturnStatement"));
      return isEarlyReturn && readsCurrentOrSeeded(statement.test as EsTreeNode);
    }
    return false;
  }
  return false;
};

export const debounceNoCleanup = defineRule({
  id: "debounce-no-cleanup",
  title: "Memoized debounce never cancelled on unmount",
  severity: "warn",
  category: "Bugs",
  recommendation:
    "A debounced/throttled callback holds a pending timer that still fires after unmount, so add `useEffect(() => () => debounced.cancel(), [debounced])` to cancel the trailing invocation when the component tears down.",
  create: (context: RuleContext) => {
    const functionUsageIndexes = new WeakMap<EsTreeNode, DebounceFunctionUsageIndex>();
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isProvenReactHookCall(node, DEBOUNCE_WRAPPER_HOOK_NAMES, context.scopes)) return;
        const debounceCall = findDebounceCallInHookInitializer(node, context.scopes);
        if (!debounceCall) return;
        const isCompat = isCompatDebounceCall(debounceCall, context.scopes);
        if (hasTrailingFalseOption(debounceCall, context.scopes, node)) return;

        const initializerRoot = findTransparentExpressionRoot(node);
        const declarator = initializerRoot.parent;
        if (
          !isNodeOfType(declarator, "VariableDeclarator") ||
          declarator.init !== initializerRoot ||
          !isNodeOfType(declarator.id, "Identifier")
        ) {
          return;
        }
        const bindingName = declarator.id.name;
        const enclosingFunction = findEnclosingFunction(node);
        if (!enclosingFunction) return;
        let functionUsageIndex = functionUsageIndexes.get(enclosingFunction);
        if (!functionUsageIndex) {
          functionUsageIndex = buildFunctionUsageIndex(enclosingFunction, context.scopes);
          functionUsageIndexes.set(enclosingFunction, functionUsageIndex);
        }

        const aliases = collectBindingAliases(declarator.id, context.scopes, {
          includeReactRefContainers: true,
        });
        const aliasSymbolIds = new Set(
          aliases.flatMap((alias) => {
            const symbolId = context.scopes.symbolFor(alias)?.id;
            return symbolId === undefined ? [] : [symbolId];
          }),
        );
        if (
          !isCompat &&
          [...aliasSymbolIds].some((symbolId) => functionUsageIndex.releasedSymbolIds.has(symbolId))
        ) {
          return;
        }
        if (
          [...aliasSymbolIds].some((symbolId) => functionUsageIndex.escapedSymbolIds.has(symbolId))
        ) {
          return;
        }
        if (isCompat) {
          const symbolId = getStableCompatSymbolId(declarator.id, context.scopes);
          const dependencies = node.arguments[1] && stripParenExpression(node.arguments[1]);
          const hasStableMemoInstance =
            isNodeOfType(dependencies, "ArrayExpression") && dependencies.elements.length === 0;
          if (
            symbolId === null ||
            [...DEBOUNCE_RELEASE_METHOD_NAMES].some((releaseMethod) =>
              hasCompatReleaseWrite(declarator.id, releaseMethod, context.scopes),
            ) ||
            hasCompatContainerEscape(
              declarator.id,
              context.scopes,
              functionUsageIndex.effectCallbacks,
            ) ||
            !functionUsageIndex.effectCallbacks.some((effect) => {
              const registration = findTransparentExpressionRoot(effect).parent;
              let didSchedule = false;
              const setup = getCompatSetupAction(effect, symbolId, context.scopes, () => {
                didSchedule = true;
              });
              return (
                isNodeOfType(registration, "CallExpression") &&
                (!registration.optional ||
                  isClosedOptionalCompatEffect(registration, context.scopes)) &&
                didSchedule &&
                setup !== null &&
                leavesCompatInvocationPending(
                  effect,
                  setup,
                  functionUsageIndex.effectCallbacks,
                  enclosingFunction,
                  symbolId,
                  hasStableMemoInstance,
                  context.scopes,
                )
              );
            })
          ) {
            return;
          }
        } else if (
          ![...aliasSymbolIds].some((symbolId) => functionUsageIndex.invokedSymbolIds.has(symbolId))
        ) {
          return;
        }

        const argument =
          isCompat && isNodeOfType(debounceCall, "CallExpression") && debounceCall.arguments[0];
        const compatCallback = argument ? stripParenExpression(argument) : null;
        const wrappedCallback = isCompat
          ? compatCallback &&
            (isNodeOfType(compatCallback, "Identifier") || isFunctionLike(compatCallback))
            ? resolveExactLocalFunction(compatCallback, context.scopes)
            : null
          : resolveWrappedCallbackFunction(debounceCall, enclosingFunction, context.scopes);
        if (!isFunctionLike(wrappedCallback) || (isCompat && wrappedCallback.generator)) return;
        if (!hasAsyncOrDomWork(wrappedCallback, isCompat)) return;
        if (startsWithNullRefGuard(wrappedCallback, context.scopes)) return;

        context.report({
          node: debounceCall,
          message: `\`${bindingName}\` keeps a pending debounced/throttled call that fires after unmount because nothing cancels it; return \`() => ${bindingName}.cancel()\` from a useEffect so the trailing call is dropped on teardown.`,
        });
      },
    };
  },
});
