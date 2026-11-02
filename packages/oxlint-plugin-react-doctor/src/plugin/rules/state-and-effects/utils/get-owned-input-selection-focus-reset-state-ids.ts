import { EFFECT_HOOK_NAMES } from "../../../constants/react.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import type { UseStateBinding } from "./collect-use-state-bindings.js";
import { getFunctionBindingSymbols } from "../../../utils/get-function-binding-symbols.js";
import { hasOnlyAllowedSymbolReads } from "../../../utils/has-only-allowed-symbol-reads.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getDirectUnreassignedInitializer } from "../../../utils/get-direct-unreassigned-initializer.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { hasSymbolBindingWrites } from "../../../utils/has-symbol-binding-writes.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isLiteralVoidExpression } from "../../../utils/is-literal-void-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isProvenUnmodifiedReactApiCall } from "../../../utils/is-proven-unmodified-react-api-call.js";
import { hasReactDefaultProviderMutation } from "../../../utils/has-react-default-provider-mutation.js";
import { hasPossibleStaticPropertyMutationOrEscape } from "../../../utils/has-static-property-write-before.js";
import { isMemberMutationTarget } from "../../../utils/is-member-mutation-target.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import { resolveExactLocalFunction } from "../../../utils/resolve-exact-local-function.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { resolveReactRefSymbol } from "../../../utils/react-ref-origin.js";
import { resolveReactUseStatePair } from "../../../utils/resolve-react-use-state-pair.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { resolveOwnedInputFocusTarget } from "./resolve-owned-input-focus-target.js";

interface OwnedSelectionState {
  readonly value: SymbolDescriptor;
  readonly setter: SymbolDescriptor;
  readonly initial: EsTreeNode;
}

interface OwnedFocusReset {
  readonly state: OwnedSelectionState;
  readonly targetInitializer: EsTreeNode;
}

interface OwnedSelectionPayload {
  readonly options: OwnedSelectionState;
  readonly index: OwnedSelectionState;
}

const isReadonlySymbol = (symbol: SymbolDescriptor, context: RuleContext): boolean => {
  const program = findProgramRoot(symbol.bindingIdentifier);
  return Boolean(
    program &&
    !hasSymbolBindingWrites(symbol) &&
    hasCompleteSymbolReferences(symbol, program, context.scopes),
  );
};

const symbolForExpression = (
  expression: EsTreeNode,
  context: RuleContext,
): SymbolDescriptor | null => {
  const identifier = stripParenExpression(expression);
  return isNodeOfType(identifier, "Identifier") ? context.scopes.symbolFor(identifier) : null;
};

const readReadonlyNumber = (
  expression: EsTreeNode,
  context: RuleContext,
  seen = new Set<number>(),
): number | null => {
  const value = stripParenExpression(expression);
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "number" && Number.isFinite(value.value) ? value.value : null;
  }
  if (
    isNodeOfType(value, "UnaryExpression") &&
    (value.operator === "-" || value.operator === "+") &&
    isNodeOfType(value.argument, "Literal") &&
    typeof value.argument.value === "number" &&
    Number.isFinite(value.argument.value)
  ) {
    return value.operator === "-" ? -value.argument.value : value.argument.value;
  }
  const symbol = symbolForExpression(value, context);
  if (
    !symbol ||
    symbol.kind !== "const" ||
    seen.has(symbol.id) ||
    !isReadonlySymbol(symbol, context)
  ) {
    return null;
  }
  const initial = getDirectUnreassignedInitializer(symbol);
  if (!initial) return null;
  return readReadonlyNumber(initial, context, new Set(seen).add(symbol.id));
};

const significantStatements = (block: EsTreeNode): readonly EsTreeNode[] =>
  isNodeOfType(block, "BlockStatement")
    ? block.body.filter(
        (statement) =>
          !isNodeOfType(statement, "EmptyStatement") &&
          !(
            isNodeOfType(statement, "ExpressionStatement") &&
            isLiteralVoidExpression(statement.expression)
          ),
      )
    : [];

const expressionCall = (
  statement: EsTreeNode | undefined,
): EsTreeNodeOfType<"CallExpression"> | null => {
  if (!isNodeOfType(statement, "ExpressionStatement")) return null;
  const expression = stripParenExpression(statement.expression);
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};

const onlyArgument = (call: EsTreeNodeOfType<"CallExpression">): EsTreeNode | null => {
  const [argument, ...remaining] = call.arguments;
  return argument && !isNodeOfType(argument, "SpreadElement") && !remaining.length
    ? argument
    : null;
};

const hasOnlyDirectCalls = (
  symbol: SymbolDescriptor,
  context: RuleContext,
  hasArgument: boolean,
): boolean =>
  isReadonlySymbol(symbol, context) &&
  symbol.references.every((reference) => {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const call = identifier.parent;
    return Boolean(
      isNodeOfType(call, "CallExpression") &&
      !call.optional &&
      call.callee === identifier &&
      (hasArgument ? onlyArgument(call) !== null : !call.arguments.length),
    );
  });

const collectOwnedStates = (
  bindings: ReadonlyArray<UseStateBinding>,
  component: EsTreeNode,
  context: RuleContext,
): readonly OwnedSelectionState[] => {
  const states: OwnedSelectionState[] = [];
  for (const binding of bindings) {
    const declarator = binding.declarator;
    if (
      findEnclosingFunction(declarator) !== component ||
      !isNodeOfType(declarator.parent, "VariableDeclaration") ||
      declarator.parent.kind !== "const" ||
      !isNodeOfType(declarator.id, "ArrayPattern") ||
      !isNodeOfType(declarator.init, "CallExpression") ||
      !isProvenUnmodifiedReactApiCall(declarator.init, "useState", context.scopes)
    )
      continue;
    const [valueNode, setterNode, ...remaining] = declarator.id.elements;
    if (
      remaining.length ||
      !isNodeOfType(valueNode, "Identifier") ||
      !isNodeOfType(setterNode, "Identifier")
    )
      continue;
    const pair = resolveReactUseStatePair(setterNode, context.scopes);
    const initial = onlyArgument(declarator.init);
    if (
      !pair?.stateSymbol ||
      pair.declarator !== declarator ||
      !initial ||
      pair.stateSymbol.kind !== "const" ||
      pair.setterSymbol.kind !== "const" ||
      !isReadonlySymbol(pair.stateSymbol, context) ||
      !hasOnlyDirectCalls(pair.setterSymbol, context, true)
    )
      continue;
    states.push({ value: pair.stateSymbol, setter: pair.setterSymbol, initial });
  }
  return states;
};

const resolveFocusReset = (
  call: EsTreeNodeOfType<"CallExpression">,
  component: EsTreeNode,
  states: readonly OwnedSelectionState[],
  context: RuleContext,
): OwnedFocusReset | null => {
  const helper = symbolForExpression(call.callee, context);
  if (
    !isFunctionLike(component) ||
    call.arguments.length ||
    !helper ||
    helper.kind !== "const" ||
    !hasOnlyDirectCalls(helper, context, false) ||
    !isNodeOfType(helper.declarationNode, "VariableDeclarator") ||
    helper.declarationNode.parent?.parent !== component.body
  )
    return null;
  const initial = getDirectUnreassignedInitializer(helper);
  if (!initial) return null;
  const callback = stripParenExpression(initial);
  if (
    !isFunctionLike(callback) ||
    callback.async ||
    callback.generator ||
    callback.params.length ||
    !isNodeOfType(callback.body, "BlockStatement")
  )
    return null;
  const [targetStatement, guard, ...extraStatements] = significantStatements(callback.body);
  if (
    extraStatements.length ||
    !isNodeOfType(targetStatement, "VariableDeclaration") ||
    targetStatement.kind !== "const" ||
    !isNodeOfType(guard, "IfStatement") ||
    guard.alternate
  )
    return null;
  const [targetDeclaration, ...extraDeclarations] = targetStatement.declarations;
  if (
    extraDeclarations.length ||
    !targetDeclaration ||
    !isNodeOfType(targetDeclaration.id, "Identifier") ||
    !targetDeclaration.init
  )
    return null;
  const target = context.scopes.symbolFor(targetDeclaration.id);
  if (
    !target ||
    !isReadonlySymbol(target, context) ||
    symbolForExpression(guard.test, context) !== target
  )
    return null;
  const [focusStatement, resetStatement, ...extraWork] = significantStatements(guard.consequent);
  const focus = expressionCall(focusStatement);
  const reset = expressionCall(resetStatement);
  if (!focus || !reset || extraWork.length || focus.arguments.length) return null;
  const method = stripParenExpression(focus.callee);
  if (
    !isNodeOfType(method, "MemberExpression") ||
    method.optional ||
    getStaticPropertyName(method) !== "focus" ||
    symbolForExpression(method.object, context) !== target
  )
    return null;
  const allowedTargetReads = new Set([
    stripParenExpression(guard.test),
    stripParenExpression(method.object),
  ]);
  if (!target.references.every((reference) => allowedTargetReads.has(reference.identifier)))
    return null;
  const resetSymbol = symbolForExpression(reset.callee, context);
  const state = states.find((candidate) => candidate.setter === resetSymbol);
  const resetValue = onlyArgument(reset);
  if (!state || !resetValue) return null;
  const sentinel = readReadonlyNumber(state.initial, context);
  const resetNumber = readReadonlyNumber(resetValue, context);
  if (sentinel === null || resetNumber === null || !Object.is(sentinel, resetNumber)) return null;
  return { state, targetInitializer: targetDeclaration.init };
};

const hasOnlyNumericIndexSources = (state: OwnedSelectionState, context: RuleContext): boolean => {
  const isNumericSource = (rawExpression: EsTreeNode, seen: Set<number>): boolean => {
    const expression = stripParenExpression(rawExpression);
    if (readReadonlyNumber(expression, context) !== null) return true;
    if (symbolForExpression(expression, context) === state.value) return true;
    if (isNodeOfType(expression, "ConditionalExpression")) {
      return (
        isNumericSource(expression.consequent, new Set(seen)) &&
        isNumericSource(expression.alternate, new Set(seen))
      );
    }
    if (
      isNodeOfType(expression, "BinaryExpression") &&
      (expression.operator === "+" || expression.operator === "-")
    ) {
      return (
        isNumericSource(expression.left, new Set(seen)) &&
        isNumericSource(expression.right, new Set(seen))
      );
    }
    const symbol = symbolForExpression(expression, context);
    if (
      !symbol ||
      symbol.kind !== "const" ||
      seen.has(symbol.id) ||
      !isReadonlySymbol(symbol, context)
    )
      return false;
    const initial = getDirectUnreassignedInitializer(symbol);
    return Boolean(initial && isNumericSource(initial, new Set(seen).add(symbol.id)));
  };
  return state.setter.references.every((reference) => {
    const call = findTransparentExpressionRoot(reference.identifier).parent;
    if (!isNodeOfType(call, "CallExpression")) return false;
    const argument = onlyArgument(call);
    return Boolean(argument && isNumericSource(argument, new Set()));
  });
};

const getControlledState = (
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  states: readonly OwnedSelectionState[],
  context: RuleContext,
): OwnedSelectionState | null => {
  if (opening.attributes.some((attribute) => isNodeOfType(attribute, "JSXSpreadAttribute")))
    return null;
  const [attribute, ...duplicates] = opening.attributes.filter(
    (candidate) =>
      isNodeOfType(candidate, "JSXAttribute") && getJsxAttributeName(candidate.name) === "value",
  );
  if (
    duplicates.length ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    !isNodeOfType(attribute.value, "JSXExpressionContainer")
  )
    return null;
  const valueSymbol = symbolForExpression(attribute.value.expression, context);
  return states.find((state) => state.value === valueSymbol) ?? null;
};

const isOwnedPropCallback = (
  call: EsTreeNodeOfType<"CallExpression">,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(component)) return false;
  const symbol = symbolForExpression(call.callee, context);
  const [parameter, ...otherParameters] = component.params;
  if (
    !symbol ||
    symbol.kind !== "parameter" ||
    !hasOnlyDirectCalls(symbol, context, true) ||
    otherParameters.length ||
    !isNodeOfType(parameter, "ObjectPattern")
  )
    return false;
  return parameter.properties.some((property) => {
    if (!isNodeOfType(property, "Property") || property.computed || property.method) return false;
    const value = property.value;
    if (value === symbol.bindingIdentifier) return true;
    if (!isNodeOfType(value, "AssignmentPattern") || value.left !== symbol.bindingIdentifier)
      return false;
    const fallback = stripParenExpression(value.right);
    return Boolean(
      isFunctionLike(fallback) &&
      !fallback.async &&
      !fallback.generator &&
      !fallback.params.length &&
      isNodeOfType(fallback.body, "BlockStatement") &&
      !significantStatements(fallback.body).length,
    );
  });
};

const resolvePayload = (
  rawExpression: EsTreeNode,
  index: OwnedSelectionState,
  states: readonly OwnedSelectionState[],
  context: RuleContext,
): OwnedSelectionPayload | null => {
  const expression = stripParenExpression(rawExpression);
  if (
    !isNodeOfType(expression, "MemberExpression") ||
    !expression.computed ||
    expression.optional ||
    symbolForExpression(expression.property, context) !== index.value
  )
    return null;
  const symbol = symbolForExpression(expression.object, context);
  const options = states.find((state) => state.value === symbol);
  return options && options !== index ? { options, index } : null;
};

const isReadonlyReactArrayUse = (
  rawReference: EsTreeNode,
  context: RuleContext,
  options: OwnedSelectionState,
): boolean => {
  const expression = findTransparentExpressionRoot(rawReference);
  if (isBooleanContainerRead(expression) || isReactEffectDependencyRead(expression, context))
    return true;
  const call = expression.parent;
  if (!isNodeOfType(call, "CallExpression") || onlyArgument(call) !== expression) return false;
  if (isProvenUnmodifiedReactApiCall(call, "useState", context.scopes))
    return call.parent === options.value.declarationNode;
  const pair = resolveReactUseStatePair(call.callee, context.scopes);
  return Boolean(
    pair &&
    pair.setterSymbol === options.setter &&
    isNodeOfType(pair.declarator.init, "CallExpression") &&
    isProvenUnmodifiedReactApiCall(pair.declarator.init, "useState", context.scopes) &&
    hasOnlyDirectCalls(pair.setterSymbol, context, true),
  );
};

const hasReadonlyFilterProvider = (
  receiver: SymbolDescriptor,
  context: RuleContext,
  options: OwnedSelectionState,
): boolean =>
  (receiver.kind !== "parameter" ||
    findEnclosingFunction(receiver.bindingIdentifier) ===
      findEnclosingFunction(options.value.bindingIdentifier)) &&
  isReadonlySymbol(receiver, context) &&
  !hasPossibleStaticPropertyMutationOrEscape(
    receiver.bindingIdentifier,
    "filter",
    context.scopes,
    (reference) => isReadonlyReactArrayUse(reference, context, options),
  ) &&
  receiver.references.every((reference) => {
    const expression = findTransparentExpressionRoot(reference.identifier);
    const member = expression.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== expression)
      return isReadonlyReactArrayUse(expression, context, options);
    if (isMemberMutationTarget(member)) return false;
    const name = getStaticPropertyName(member);
    if (name === "length") return true;
    const call = findTransparentExpressionRoot(member).parent;
    if (
      (name !== "filter" && name !== "map") ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== findTransparentExpressionRoot(member)
    )
      return false;
    const argument = onlyArgument(call);
    if (!argument) return false;
    const callback = stripParenExpression(argument);
    if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return false;
    const [item, position, ...extra] = callback.params;
    return (
      !extra.length &&
      (!item || isNodeOfType(item, "Identifier")) &&
      (!position || isNodeOfType(position, "Identifier"))
    );
  });

const isDirectOrdinaryArrayResult = (
  rawExpression: EsTreeNode,
  context: RuleContext,
  options: OwnedSelectionState,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "ArrayExpression")) return true;
  if (!isNodeOfType(expression, "CallExpression")) return false;
  const callee = stripParenExpression(expression.callee);
  if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "filter")
    return false;
  const receiver = symbolForExpression(callee.object, context);
  return Boolean(
    receiver &&
    receiver.kind === "parameter" &&
    hasReadonlyFilterProvider(receiver, context, options),
  );
};

const hasExplicitNonArraySource = (
  rawExpression: EsTreeNode,
  context: RuleContext,
  options: OwnedSelectionState,
  seen = new Set<number>(),
  functions = new Set<EsTreeNode>(),
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) return true;
  if (
    isNodeOfType(expression, "ObjectExpression") ||
    isFunctionLike(expression) ||
    isNodeOfType(expression, "NewExpression") ||
    isNodeOfType(expression, "ClassExpression")
  )
    return true;
  if (isNodeOfType(expression, "ConditionalExpression")) {
    return (
      hasExplicitNonArraySource(
        expression.consequent,
        context,
        options,
        new Set(seen),
        new Set(functions),
      ) ||
      hasExplicitNonArraySource(
        expression.alternate,
        context,
        options,
        new Set(seen),
        new Set(functions),
      )
    );
  }
  if (isNodeOfType(expression, "ArrayExpression")) {
    return expression.elements.some((element) => {
      if (!element) return false;
      if (isNodeOfType(element, "SpreadElement")) return true;
      const value = stripParenExpression(element);
      if (isNodeOfType(value, "Literal"))
        return (
          value.value !== null && !["string", "number", "boolean"].includes(typeof value.value)
        );
      return hasExplicitNonArraySource(
        element,
        context,
        options,
        new Set(seen),
        new Set(functions),
      );
    });
  }
  if (isNodeOfType(expression, "CallExpression")) {
    const callee = stripParenExpression(expression.callee);
    const called = resolveExactLocalFunction(callee, context.scopes);
    if (called && isFunctionLike(called)) {
      if (
        functions.has(called) ||
        called.async ||
        called.generator ||
        called.params.some((parameter) => !isNodeOfType(parameter, "Identifier"))
      )
        return true;
      let hasVisibleCapability = false;
      walkAst(called.body, (node) => {
        if (isNodeOfType(node, "Property") && (node.kind === "get" || node.kind === "set"))
          hasVisibleCapability = true;
        if (isNodeOfType(node, "CallExpression")) {
          const method = stripParenExpression(node.callee);
          if (
            isNodeOfType(method, "MemberExpression") &&
            [
              "defineProperty",
              "defineProperties",
              "setPrototypeOf",
              "__defineGetter__",
              "__defineSetter__",
            ].includes(getStaticPropertyName(method) ?? "")
          )
            hasVisibleCapability = true;
        }
      });
      if (hasVisibleCapability) return true;
      const nextFunctions = new Set(functions).add(called);
      if (!isNodeOfType(called.body, "BlockStatement"))
        return (
          !isDirectOrdinaryArrayResult(called.body, context, options) ||
          hasExplicitNonArraySource(called.body, context, options, new Set(seen), nextFunctions)
        );
      const returns = collectFunctionReturnStatements(called);
      return (
        !returns.length ||
        returns.some(
          (statement) =>
            !statement.argument ||
            !isDirectOrdinaryArrayResult(statement.argument, context, options) ||
            hasExplicitNonArraySource(
              statement.argument,
              context,
              options,
              new Set(seen),
              new Set(nextFunctions),
            ),
        )
      );
    }
    if (!isNodeOfType(callee, "MemberExpression") || getStaticPropertyName(callee) !== "filter")
      return true;
    const receiver = symbolForExpression(callee.object, context);
    return (
      !receiver ||
      receiver.kind !== "parameter" ||
      !hasReadonlyFilterProvider(receiver, context, options)
    );
  }
  const symbol = symbolForExpression(expression, context);
  if (symbol?.kind === "parameter") {
    if (
      seen.has(symbol.id) ||
      findEnclosingFunction(symbol.bindingIdentifier) !==
        findEnclosingFunction(options.value.bindingIdentifier) ||
      !hasReadonlyFilterProvider(symbol, context, options)
    )
      return true;
    const parameterDefault = symbol.bindingIdentifier.parent;
    if (!isNodeOfType(parameterDefault, "AssignmentPattern")) return false;
    const defaultValue = stripParenExpression(parameterDefault.right);
    return (
      !isNodeOfType(defaultValue, "ArrayExpression") ||
      hasExplicitNonArraySource(
        defaultValue,
        context,
        options,
        new Set(seen).add(symbol.id),
        new Set(functions),
      )
    );
  }
  if (
    !symbol ||
    symbol.kind !== "const" ||
    seen.has(symbol.id) ||
    !hasReadonlyFilterProvider(symbol, context, options)
  )
    return true;
  const initial = getDirectUnreassignedInitializer(symbol);
  return (
    !initial ||
    hasExplicitNonArraySource(
      initial,
      context,
      options,
      new Set(seen).add(symbol.id),
      new Set(functions),
    )
  );
};

const isBooleanContainerRead = (rawExpression: EsTreeNode): boolean => {
  let expression = findTransparentExpressionRoot(rawExpression);
  while (expression.parent) {
    const parent = expression.parent;
    if (isNodeOfType(parent, "UnaryExpression") && parent.operator === "!") return true;
    if (
      (isNodeOfType(parent, "IfStatement") || isNodeOfType(parent, "ConditionalExpression")) &&
      parent.test === expression
    )
      return true;
    if (isNodeOfType(parent, "LogicalExpression")) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    return false;
  }
  return false;
};

const isReactEffectDependencyRead = (expression: EsTreeNode, context: RuleContext): boolean => {
  const dependencyArray = expression.parent;
  if (
    !isNodeOfType(dependencyArray, "ArrayExpression") ||
    !dependencyArray.elements.some((element) => element === expression)
  )
    return false;
  const arrayExpression = findTransparentExpressionRoot(dependencyArray);
  const call = arrayExpression.parent;
  if (!isNodeOfType(call, "CallExpression") || call.optional) return false;
  const [callback, dependencies, ...extraArguments] = call.arguments;
  return Boolean(
    callback &&
    !isNodeOfType(callback, "SpreadElement") &&
    dependencies === arrayExpression &&
    !extraArguments.length &&
    isProvenUnmodifiedReactApiCall(call, EFFECT_HOOK_NAMES, context.scopes),
  );
};

const hasClosedOptionContainer = (
  options: OwnedSelectionState,
  index: OwnedSelectionState,
  component: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (!isFunctionLike(component) || hasExplicitNonArraySource(options.initial, context, options))
    return false;
  const initial = stripParenExpression(options.initial);
  if (!isNodeOfType(initial, "ArrayExpression")) {
    const parameter = symbolForExpression(initial, context);
    if (
      !parameter ||
      parameter.kind !== "parameter" ||
      !isReadonlySymbol(parameter, context) ||
      !component.params.some((pattern) => isAstDescendant(parameter.bindingIdentifier, pattern))
    )
      return false;
    const defaultValue = parameter.bindingIdentifier.parent;
    if (
      isNodeOfType(defaultValue, "AssignmentPattern") &&
      hasExplicitNonArraySource(defaultValue.right, context, options)
    )
      return false;
  }
  for (const reference of options.setter.references) {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const call = identifier.parent;
    if (!isNodeOfType(call, "CallExpression")) return false;
    const argument = onlyArgument(call);
    if (!argument || hasExplicitNonArraySource(argument, context, options)) return false;
  }
  return options.value.references.every((reference) => {
    const identifier = findTransparentExpressionRoot(reference.identifier);
    const member = identifier.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== identifier)
      return isBooleanContainerRead(identifier) || isReactEffectDependencyRead(identifier, context);
    let terminal = findTransparentExpressionRoot(member);
    while (isNodeOfType(terminal.parent, "MemberExpression") && terminal.parent.object === terminal)
      terminal = findTransparentExpressionRoot(terminal.parent);
    const parent = terminal.parent;
    if (isMemberMutationTarget(terminal)) return false;
    if (
      member.computed &&
      (symbolForExpression(member.property, context) === index.value ||
        readReadonlyNumber(member.property, context) !== null)
    ) {
      return (
        !(isNodeOfType(parent, "CallExpression") && parent.callee === terminal) &&
        !(isNodeOfType(parent, "NewExpression") && parent.callee === terminal)
      );
    }
    const name = getStaticPropertyName(member);
    if (name === "length") return true;
    const call = findTransparentExpressionRoot(member).parent;
    if (
      name !== "map" ||
      !isNodeOfType(call, "CallExpression") ||
      call.callee !== findTransparentExpressionRoot(member)
    )
      return false;
    const argument = onlyArgument(call);
    if (!argument) return false;
    const callback = stripParenExpression(argument);
    if (!isNodeOfType(callback, "ArrowFunctionExpression") || callback.async) return false;
    const [item, position, ...extra] = callback.params;
    return (
      !extra.length &&
      (!item || isNodeOfType(item, "Identifier")) &&
      (!position || isNodeOfType(position, "Identifier"))
    );
  });
};

const hasAncestorContainsReceiver = (
  receiver: EsTreeNode,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  context: RuleContext,
): boolean => {
  const symbol = resolveReactRefSymbol(receiver, context.scopes, { resolveNamedAliases: true });
  if (!symbol || !isReadonlySymbol(symbol, context)) return false;
  let ancestor: EsTreeNode | null | undefined = opening;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "JSXOpeningElement") &&
      ancestor.attributes.some(
        (attribute) =>
          isNodeOfType(attribute, "JSXAttribute") &&
          getJsxAttributeName(attribute.name) === "ref" &&
          isNodeOfType(attribute.value, "JSXExpressionContainer") &&
          symbolForExpression(attribute.value.expression, context) === symbol,
      )
    )
      return true;
    const parent: EsTreeNode | null | undefined = ancestor.parent;
    ancestor =
      isNodeOfType(parent, "JSXElement") && parent.openingElement !== ancestor
        ? parent.openingElement
        : parent;
  }
  return false;
};

const isPassiveSelectionGuard = (
  rawExpression: EsTreeNode,
  opening: EsTreeNodeOfType<"JSXOpeningElement">,
  options: OwnedSelectionState,
  index: OwnedSelectionState,
  context: RuleContext,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (isNodeOfType(expression, "Literal")) return typeof expression.value !== "object";
  if (isNodeOfType(expression, "Identifier")) {
    const symbol = context.scopes.symbolFor(expression);
    if (!symbol || !isReadonlySymbol(symbol, context)) return false;
    if (
      findEnclosingFunction(symbol.declarationNode) === findEnclosingFunction(expression) &&
      isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
      symbol.initializer
    ) {
      if (symbol.initializer.range[1] >= expression.range[0]) return false;
      return isPassiveSelectionGuard(symbol.initializer, opening, options, index, context);
    }
    return true;
  }
  if (isNodeOfType(expression, "UnaryExpression")) {
    return (
      expression.operator === "!" &&
      isPassiveSelectionGuard(expression.argument, opening, options, index, context)
    );
  }
  if (isNodeOfType(expression, "LogicalExpression")) {
    return (
      expression.operator === "&&" &&
      isPassiveSelectionGuard(expression.left, opening, options, index, context) &&
      isPassiveSelectionGuard(expression.right, opening, options, index, context)
    );
  }
  if (isNodeOfType(expression, "BinaryExpression")) {
    if (expression.operator === "===" || expression.operator === "!==") {
      return (
        isPassiveSelectionGuard(expression.left, opening, options, index, context) &&
        isPassiveSelectionGuard(expression.right, opening, options, index, context)
      );
    }
    if (!["<", "<=", ">", ">="].includes(expression.operator)) return false;
    return [expression.left, expression.right].every((operand) => {
      const value = stripParenExpression(operand);
      return (
        readReadonlyNumber(value, context) !== null ||
        symbolForExpression(value, context) === index.value ||
        (isNodeOfType(value, "MemberExpression") &&
          getStaticPropertyName(value) === "length" &&
          symbolForExpression(value.object, context) === options.value)
      );
    });
  }
  if (isNodeOfType(expression, "MemberExpression")) {
    return (
      getStaticPropertyName(expression) === "length" &&
      symbolForExpression(expression.object, context) === options.value
    );
  }
  if (!isNodeOfType(expression, "CallExpression") || expression.optional) return false;
  const callee = stripParenExpression(expression.callee);
  const argument = onlyArgument(expression);
  if (
    !isNodeOfType(callee, "MemberExpression") ||
    getStaticPropertyName(callee) !== "contains" ||
    !hasAncestorContainsReceiver(callee.object, opening, context) ||
    !argument
  )
    return false;
  const activeElement = stripParenExpression(argument);
  if (
    !isNodeOfType(activeElement, "MemberExpression") ||
    getStaticPropertyName(activeElement) !== "activeElement"
  )
    return false;
  const documentIdentifier = stripParenExpression(activeElement.object);
  return (
    isNodeOfType(documentIdentifier, "Identifier") &&
    documentIdentifier.name === "document" &&
    context.scopes.isGlobalReference(documentIdentifier)
  );
};

const hasPositiveVisibilityGuard = (
  rawExpression: EsTreeNode,
  visibility: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  const expression = stripParenExpression(rawExpression);
  if (symbolForExpression(expression, context) === visibility) return true;
  return (
    isNodeOfType(expression, "LogicalExpression") &&
    expression.operator === "&&" &&
    (hasPositiveVisibilityGuard(expression.left, visibility, context) ||
      hasPositiveVisibilityGuard(expression.right, visibility, context))
  );
};

export const getOwnedInputSelectionFocusResetStateIds = (
  effectCallback: EsTreeNode,
  effectCall: EsTreeNode,
  context: RuleContext,
  stateBindings: ReadonlyArray<UseStateBinding>,
): ReadonlySet<number> => {
  const empty = new Set<number>();
  const component = findEnclosingFunction(effectCallback);
  if (
    !component ||
    !isFunctionLike(component) ||
    !isFunctionLike(effectCallback) ||
    effectCallback.async ||
    effectCallback.generator ||
    effectCallback.params.length ||
    !isNodeOfType(effectCallback.body, "BlockStatement")
  )
    return empty;
  const callbackExpression = findTransparentExpressionRoot(effectCallback);
  if (
    !isNodeOfType(effectCall, "CallExpression") ||
    findEnclosingFunction(effectCall) !== component ||
    !isProvenUnmodifiedReactApiCall(effectCall, EFFECT_HOOK_NAMES, context.scopes) ||
    hasReactDefaultProviderMutation("useState", context.scopes) ||
    [...EFFECT_HOOK_NAMES].some((name) => hasReactDefaultProviderMutation(name, context.scopes))
  )
    return empty;
  const [ownCallback, dependencies, ...otherArguments] = effectCall.arguments;
  if (!ownCallback || !isNodeOfType(dependencies, "ArrayExpression") || otherArguments.length)
    return empty;
  if (ownCallback !== callbackExpression) {
    const callbackIdentifier = stripParenExpression(ownCallback);
    if (!isNodeOfType(callbackIdentifier, "Identifier")) return empty;
    const callbackBinding = context.scopes.symbolFor(callbackIdentifier);
    const program = findProgramRoot(effectCall);
    if (
      !callbackBinding ||
      !program ||
      (callbackBinding.kind !== "const" && callbackBinding.kind !== "function") ||
      !getFunctionBindingSymbols(effectCallback, context.scopes).includes(callbackBinding) ||
      !isReadonlySymbol(callbackBinding, context) ||
      !hasOnlyAllowedSymbolReads({
        symbol: callbackBinding,
        allowedIdentifiers: new Set([callbackIdentifier]),
        program,
        scopes: context.scopes,
      })
    )
      return empty;
  }
  const states = collectOwnedStates(stateBindings, component, context);
  const statements = significantStatements(effectCallback.body);
  let outerGuard: EsTreeNodeOfType<"IfStatement"> | null = null;
  const prelude: EsTreeNode[] = [];
  for (const statement of statements) {
    if (outerGuard) return empty;
    if (isNodeOfType(statement, "VariableDeclaration") && statement.kind === "const") {
      prelude.push(statement);
      continue;
    }
    if (!isNodeOfType(statement, "IfStatement") || statement.alternate) return empty;
    outerGuard = statement;
  }
  if (!outerGuard) return empty;
  const work = [...significantStatements(outerGuard.consequent)];
  const helperStatement = work.pop();
  const closeStatement = work.pop();
  const helperCall = expressionCall(helperStatement);
  const closeCall = expressionCall(closeStatement);
  if (!helperCall || !closeCall) return empty;
  const focus = resolveFocusReset(helperCall, component, states, context);
  const closingSetter = symbolForExpression(closeCall.callee, context);
  const visibility = states.find((state) => state.setter === closingSetter);
  const closedValue = onlyArgument(closeCall);
  if (
    !focus ||
    !hasOnlyNumericIndexSources(focus.state, context) ||
    !visibility ||
    visibility === focus.state ||
    !closedValue ||
    readStaticBoolean(visibility.initial) !== false ||
    readStaticBoolean(closedValue) !== false ||
    !hasPositiveVisibilityGuard(outerGuard.test, visibility.value, context)
  )
    return empty;
  let selection = work;
  const [possibleInner, ...otherWork] = work;
  let innerGuard: EsTreeNode | null = null;
  if (!otherWork.length && isNodeOfType(possibleInner, "IfStatement")) {
    if (possibleInner.alternate) return empty;
    innerGuard = possibleInner.test;
    selection = [...significantStatements(possibleInner.consequent)];
  }
  const [setValueStatement, callbackStatement, ...extraSelection] = selection;
  const setValue = expressionCall(setValueStatement);
  const callback = expressionCall(callbackStatement);
  if (
    extraSelection.length ||
    !setValue ||
    !callback ||
    !isOwnedPropCallback(callback, component, context)
  )
    return empty;
  const selectedSetter = symbolForExpression(setValue.callee, context);
  const controlled = states.find((state) => state.setter === selectedSetter);
  if (!controlled || controlled === focus.state || controlled === visibility) return empty;
  const selectedValue = onlyArgument(setValue);
  const callbackValue = onlyArgument(callback);
  if (!selectedValue || !callbackValue) return empty;
  const payload = resolvePayload(selectedValue, focus.state, states, context);
  const callbackPayload = resolvePayload(callbackValue, focus.state, states, context);
  if (
    !payload ||
    !callbackPayload ||
    payload.options !== callbackPayload.options ||
    payload.options === controlled ||
    payload.options === visibility ||
    !hasClosedOptionContainer(payload.options, focus.state, component, context)
  )
    return empty;
  const opening = resolveOwnedInputFocusTarget(focus.targetInitializer, context);
  if (
    !opening ||
    getControlledState(opening, states, context) !== controlled ||
    !isPassiveSelectionGuard(outerGuard.test, opening, payload.options, focus.state, context) ||
    (innerGuard &&
      !isPassiveSelectionGuard(innerGuard, opening, payload.options, focus.state, context))
  )
    return empty;
  for (const statement of prelude) {
    if (!isNodeOfType(statement, "VariableDeclaration")) return empty;
    for (const declarator of statement.declarations) {
      if (!isNodeOfType(declarator.id, "Identifier") || !declarator.init) return empty;
      const symbol = context.scopes.symbolFor(declarator.id);
      if (
        !symbol ||
        !isReadonlySymbol(symbol, context) ||
        !isPassiveSelectionGuard(declarator.init, opening, payload.options, focus.state, context)
      )
        return empty;
    }
  }
  return new Set([focus.state.value.id]);
};
