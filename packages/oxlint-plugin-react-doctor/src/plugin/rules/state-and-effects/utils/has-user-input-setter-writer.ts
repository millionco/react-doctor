import { getRuntimeSymbolReferences } from "../../../utils/get-runtime-symbol-references.js";
import type { Reference, Variable } from "eslint-scope";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { getDirectConstInitializer } from "../../../utils/get-direct-const-initializer.js";
import { readStaticBoolean } from "../../../utils/read-static-boolean.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { hasOwnLocalStateBranch } from "./has-own-local-state-branch.js";
import { findProgramRoot } from "../../../utils/find-program-root.js";
import { getAuthoritativeJsxAttribute } from "../../../utils/get-authoritative-jsx-attribute.js";
import { getImportedName } from "../../../utils/get-imported-name.js";
import { getValueImportSource } from "../../../utils/get-value-import-declaration.js";
import { hasCompleteSymbolReferences } from "../../../utils/has-complete-symbol-references.js";
import { HTML_TAGS } from "../../../constants/html-tags.js";
import { isProvenIntrinsicJsxElement } from "../../../utils/is-proven-intrinsic-jsx-element.js";
import { resolveJsxElementType } from "../../../utils/resolve-jsx-element-type.js";
import { hasOrdinaryNativeEventWriterRuntime } from "./has-ordinary-native-event-writer-runtime.js";
import {
  NATIVE_EVENT_WRITER_EVENT_NAMES,
  NATIVE_EVENT_WRITER_INACTIVE_ATTRIBUTE_NAMES,
  NATIVE_EVENT_WRITER_INACTIVE_ANCESTOR_TAG_NAMES,
  NATIVE_EVENT_WRITER_UNSUPPORTED_ANCESTOR_TAG_NAMES,
  NATIVE_EVENT_WRITER_UNSUPPORTED_CONTROL_FLOW_NODES,
  NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS,
  NATIVE_EVENT_WRITER_UNSUPPORTED_COMPONENT_CONTROL_FLOW_NODES,
} from "./constants.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { collectFunctionReturnStatements } from "../../../utils/collect-function-return-statements.js";
import { walkOwnFunctionScope } from "../../../utils/walk-own-function-scope.js";
import { walkAst } from "../../../utils/walk-ast.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { isWithinAssignmentTarget } from "../../../utils/is-within-assignment-target.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { isEventHandlerName } from "./event-handler-reference.js";
import { getCallExpr } from "./effect/ast.js";
import type { ProgramAnalysis } from "./effect/get-program-analysis.js";
import { isGenuineReactHookDeclarator } from "./effect/react.js";
import { isSetterWiredToJsxHandler } from "./is-controlled-prop-mirror.js";

const isEventHandlerPropertyKey = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  !property.computed &&
  isNodeOfType(property.key, "Identifier") &&
  isEventHandlerName(property.key.name);

const DEFERRED_CALLBACK_MEMBER_NAMES = new Set(["then", "catch", "finally", "subscribe"]);
const DEFERRED_CALLBACK_CALLEE_NAMES = new Set([
  "setTimeout",
  "setInterval",
  "requestAnimationFrame",
  "addEventListener",
  "addListener",
]);

const isDeferredCallbackArgumentOf = (callExpr: EsTreeNode, child: EsTreeNode): boolean => {
  if (!isNodeOfType(callExpr, "CallExpression")) return false;
  if (!(callExpr.arguments ?? []).includes(child as (typeof callExpr.arguments)[number])) {
    return false;
  }
  const callee = callExpr.callee;
  if (isNodeOfType(callee, "Identifier")) return DEFERRED_CALLBACK_CALLEE_NAMES.has(callee.name);
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return (
      DEFERRED_CALLBACK_MEMBER_NAMES.has(callee.property.name) ||
      DEFERRED_CALLBACK_CALLEE_NAMES.has(callee.property.name)
    );
  }
  return false;
};

// True when this setter reference sits in a user-input write path: inside
// a JSX `on*` attribute value, inside an `on*`-keyed object property
// (gesture/config callbacks), or inside a component-body function that is
// itself a handler — named `on*`/`handle*`, or wired into a JSX `on*`
// attribute anywhere in the component. `includeDeferredWriters` extends
// the classification to async writers: subscription / promise / timer
// callbacks and `async` functions.
const isIndependentWriterIdentifier = (
  componentFunction: EsTreeNode,
  identifier: EsTreeNode,
  includeDeferredWriters: boolean,
): boolean => {
  let outermostFunctionBelowComponent: EsTreeNode | null = null;
  let previous: EsTreeNode = identifier;
  let cursor: EsTreeNode | null | undefined = identifier.parent;
  while (cursor && cursor !== componentFunction) {
    if (isNodeOfType(cursor, "JSXAttribute")) {
      const attributeName = getJsxAttributeName(cursor.name);
      if (attributeName && isEventHandlerName(attributeName)) return true;
    }
    if (isEventHandlerPropertyKey(cursor)) return true;
    if (includeDeferredWriters && isDeferredCallbackArgumentOf(cursor, previous)) return true;
    if (isFunctionLike(cursor)) {
      outermostFunctionBelowComponent = cursor;
      if (includeDeferredWriters && (cursor as unknown as { async?: boolean }).async === true) {
        return true;
      }
    }
    previous = cursor;
    cursor = cursor.parent ?? null;
  }
  if (!outermostFunctionBelowComponent) return false;
  const bindingIdentifier = getFunctionBindingIdentifier(outermostFunctionBelowComponent);
  const bindingName = isNodeOfType(bindingIdentifier, "Identifier") ? bindingIdentifier.name : null;
  if (!bindingName) return false;
  return isSetterWiredToJsxHandler(componentFunction, bindingName);
};

const isSynchronousFunction = (functionNode: EsTreeNode): boolean => {
  const functionMetadata = functionNode as unknown as { async?: boolean; generator?: boolean };
  return functionMetadata.async !== true && functionMetadata.generator !== true;
};

const findBindingVariable = (
  analysis: ProgramAnalysis,
  bindingIdentifier: EsTreeNode,
): Variable | null => {
  for (const scope of analysis.scopeManager.scopes) {
    for (const variable of scope.variables) {
      if (variable.identifiers.includes(bindingIdentifier as never)) return variable;
    }
  }
  return null;
};

const getImmutableFunctionVariable = (
  analysis: ProgramAnalysis,
  componentFunction: EsTreeNode,
  functionNode: EsTreeNode,
): Variable | null => {
  if (!isSynchronousFunction(functionNode) || !isAstDescendant(functionNode, componentFunction)) {
    return null;
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return null;
  const variable = findBindingVariable(analysis, bindingIdentifier);
  if (
    !variable ||
    variable.defs.length !== 1 ||
    variable.references.some((reference) => reference.isWrite() && !reference.init)
  ) {
    return null;
  }
  const definition = variable.defs[0];
  if (definition.type === "FunctionName") {
    return definition.node === functionNode ? variable : null;
  }
  if (definition.type !== "Variable") return null;
  const declarator = definition.node as unknown as EsTreeNode;
  if (
    !isNodeOfType(declarator, "VariableDeclarator") ||
    !isNodeOfType(declarator.parent, "VariableDeclaration") ||
    declarator.parent.kind !== "const"
  ) {
    return null;
  }
  if (declarator.init === functionNode) return variable;
  if (
    isNodeOfType(declarator.init, "CallExpression") &&
    declarator.init.arguments?.[0] === functionNode &&
    isGenuineReactHookDeclarator(analysis, declarator, "useCallback")
  ) {
    return variable;
  }
  return null;
};

const getJsxEventValueAttribute = (identifier: EsTreeNode): EsTreeNode | null => {
  const expression = findTransparentExpressionRoot(identifier);
  const expressionContainer = expression.parent;
  if (
    !isNodeOfType(expressionContainer, "JSXExpressionContainer") ||
    expressionContainer.expression !== expression
  ) {
    return null;
  }
  const attribute = expressionContainer.parent;
  if (!isNodeOfType(attribute, "JSXAttribute")) return null;
  const attributeName = getJsxAttributeName(attribute.name);
  return attributeName && isEventHandlerName(attributeName) ? attribute : null;
};

const getInlineJsxEventCallbackAttribute = (callExpression: EsTreeNode): EsTreeNode | null => {
  const callbackFunction = findEnclosingFunction(callExpression);
  if (!callbackFunction || !isSynchronousFunction(callbackFunction)) return null;
  return getJsxEventValueAttribute(callbackFunction);
};

const isReactHookDependencyReference = (identifier: EsTreeNode): boolean => {
  const expression = findTransparentExpressionRoot(identifier);
  const dependencyArray = expression.parent;
  if (
    !isNodeOfType(dependencyArray, "ArrayExpression") ||
    !(dependencyArray.elements ?? []).includes(expression as never)
  ) {
    return false;
  }
  const hookCall = dependencyArray.parent;
  if (!isNodeOfType(hookCall, "CallExpression") || hookCall.arguments?.[1] !== dependencyArray) {
    return false;
  }
  const callee = hookCall.callee;
  if (isNodeOfType(callee, "Identifier")) return /^use[A-Z0-9]/.test(callee.name);
  return Boolean(
    isNodeOfType(callee, "MemberExpression") &&
    !callee.computed &&
    isNodeOfType(callee.property, "Identifier") &&
    /^use[A-Z0-9]/.test(callee.property.name),
  );
};

interface UserInputSetterWriterOptions {
  nativeEventWitnessOnly?: boolean;
}

const hasCompleteReadonlyVariable = (
  variable: Variable,
  effectNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  if (variable.identifiers.length !== 1) return false;
  const identifier = variable.identifiers[0] as unknown as EsTreeNode;
  const symbol = context.scopes.symbolFor(identifier);
  const program = findProgramRoot(effectNode);
  return Boolean(
    symbol &&
    symbol.kind === "const" &&
    program &&
    hasCompleteSymbolReferences(symbol, program, context.scopes) &&
    getRuntimeSymbolReferences(symbol).every((reference) => {
      const identifier = reference.identifier;
      const property = identifier.parent;
      if (
        isNodeOfType(property, "Property") &&
        !property.computed &&
        property.shorthand &&
        property.key === identifier &&
        property.value !== identifier
      ) {
        return true;
      }
      return (
        reference.flag === "read" &&
        variable.references.some((variableReference) => variableReference.identifier === identifier)
      );
    }) &&
    variable.references.every((reference) => {
      if (reference.init) return true;
      const referenceIdentifier = reference.identifier as unknown as EsTreeNode;
      return !reference.isWrite() && context.scopes.symbolFor(referenceIdentifier) === symbol;
    }),
  );
};

const hasOrdinaryNativeWitnessFunction = (
  variable: Variable,
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const definition = variable.defs[0];
  if (definition?.type !== "Variable") return false;
  const declaration = definition.node as unknown as EsTreeNode;
  if (!isNodeOfType(declaration, "VariableDeclarator")) return false;
  const initializer = declaration.init;
  const functionNode = isNodeOfType(initializer, "CallExpression")
    ? initializer.arguments[0]
    : initializer;
  if (
    (!isNodeOfType(functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionExpression")) ||
    (isNodeOfType(functionNode, "FunctionExpression") && functionNode.id !== null) ||
    !isSynchronousFunction(functionNode) ||
    !functionNode.params.every((parameter) => isNodeOfType(parameter, "Identifier"))
  ) {
    return false;
  }
  return hasCompleteReadonlyVariable(variable, componentFunction, context);
};

const isGenuineNativeWriterContextBinding = (
  symbol: SymbolDescriptor,
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean => {
  const program = findProgramRoot(componentFunction);
  const initializer = getDirectConstInitializer(symbol);
  const hookSymbol =
    isNodeOfType(initializer, "CallExpression") && isNodeOfType(initializer.callee, "Identifier")
      ? context.scopes.symbolFor(initializer.callee)
      : null;
  return Boolean(
    program &&
    findEnclosingFunction(symbol.declarationNode) === componentFunction &&
    hasCompleteSymbolReferences(symbol, program, context.scopes) &&
    getRuntimeSymbolReferences(symbol).every((reference) => reference.flag === "read") &&
    isNodeOfType(initializer, "CallExpression") &&
    !initializer.optional &&
    initializer.arguments.length === 1 &&
    !isNodeOfType(initializer.arguments[0], "SpreadElement") &&
    hookSymbol &&
    hasCompleteSymbolReferences(hookSymbol, program, context.scopes) &&
    getRuntimeSymbolReferences(hookSymbol).every((reference) => reference.flag === "read") &&
    getValueImportSource(hookSymbol) === "react" &&
    getImportedName(hookSymbol.declarationNode) === "useContext",
  );
};

const getControlledNativeWriterInputs = (
  symbol: SymbolDescriptor,
  componentFunction: EsTreeNode,
  context: RuleContext,
): ReadonlySet<SymbolDescriptor> | null => {
  if (!isFunctionLike(componentFunction)) return null;
  const propsPattern = componentFunction.params[0];
  const program = findProgramRoot(componentFunction);
  const initializer = getDirectConstInitializer(symbol);
  if (
    !isNodeOfType(propsPattern, "ObjectPattern") ||
    !program ||
    !initializer ||
    findEnclosingFunction(symbol.declarationNode) !== componentFunction
  ) {
    return null;
  }
  const propNames = new Set<string>();
  for (const property of propsPattern.properties) {
    if (isNodeOfType(property, "RestElement")) continue;
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      propNames.has(property.key.name)
    ) {
      return null;
    }
    propNames.add(property.key.name);
  }
  const expression = stripParenExpression(initializer);
  if (!isNodeOfType(expression, "LogicalExpression") || expression.operator !== "&&") {
    return null;
  }
  const inputs = new Set<SymbolDescriptor>();
  const inputNames = new Set<string>();
  for (const operand of [expression.left, expression.right]) {
    const comparison = stripParenExpression(operand);
    if (!isNodeOfType(comparison, "BinaryExpression") || comparison.operator !== "!==") {
      return null;
    }
    const input = stripParenExpression(comparison.left);
    const undefinedValue = stripParenExpression(comparison.right);
    if (
      !isNodeOfType(input, "Identifier") ||
      !isNodeOfType(undefinedValue, "Identifier") ||
      undefinedValue.name !== "undefined" ||
      !context.scopes.isGlobalReference(undefinedValue)
    ) {
      return null;
    }
    const inputSymbol = context.scopes.symbolFor(input);
    if (
      !inputSymbol ||
      inputSymbol.kind !== "parameter" ||
      inputs.has(inputSymbol) ||
      !hasCompleteSymbolReferences(inputSymbol, program, context.scopes) ||
      getRuntimeSymbolReferences(inputSymbol).some((reference) => reference.flag !== "read")
    ) {
      return null;
    }
    const property = propsPattern.properties.find(
      (candidate) =>
        isNodeOfType(candidate, "Property") && candidate.value === inputSymbol.bindingIdentifier,
    );
    if (
      !isNodeOfType(property, "Property") ||
      property.computed ||
      !isNodeOfType(property.key, "Identifier") ||
      inputNames.has(property.key.name)
    ) {
      return null;
    }
    inputs.add(inputSymbol);
    inputNames.add(property.key.name);
  }
  return inputs;
};

const isOwnContextReadInTruthyArm = (
  member: EsTreeNode,
  componentFunction: EsTreeNode,
  contextSymbol: SymbolDescriptor,
  context: RuleContext,
): boolean => {
  let ancestor = member.parent;
  while (ancestor && ancestor !== componentFunction) {
    let condition: EsTreeNode | null = null;
    let requiredValue = true;
    if (isNodeOfType(ancestor, "IfStatement") || isNodeOfType(ancestor, "ConditionalExpression")) {
      if (isAstDescendant(member, ancestor.consequent)) {
        condition = ancestor.test;
      } else if (ancestor.alternate && isAstDescendant(member, ancestor.alternate)) {
        condition = ancestor.test;
        requiredValue = false;
      }
    } else if (
      isNodeOfType(ancestor, "LogicalExpression") &&
      ancestor.operator === "&&" &&
      isAstDescendant(member, ancestor.right)
    ) {
      condition = ancestor.left;
    }
    if (condition) {
      let predicate = stripParenExpression(condition);
      while (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!") {
        requiredValue = !requiredValue;
        predicate = stripParenExpression(predicate.argument);
      }
      if (
        requiredValue &&
        isNodeOfType(predicate, "Identifier") &&
        context.scopes.symbolFor(predicate) === contextSymbol
      ) {
        return true;
      }
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const hasGuardedOwnContextReads = (
  symbol: SymbolDescriptor,
  componentFunction: EsTreeNode,
  context: RuleContext,
): boolean =>
  getRuntimeSymbolReferences(symbol).every((reference) => {
    if (findEnclosingFunction(reference.identifier) !== componentFunction) return true;
    const receiver = findTransparentExpressionRoot(reference.identifier);
    const member = receiver.parent;
    if (!isNodeOfType(member, "MemberExpression") || member.object !== receiver) {
      return !(
        (isNodeOfType(member, "VariableDeclarator") && member.init === receiver) ||
        (isNodeOfType(member, "Property") && member.value === receiver) ||
        (isNodeOfType(member, "ArrayExpression") &&
          member.elements.some((element) => element === receiver))
      );
    }
    if (!member.optional) {
      return isOwnContextReadInTruthyArm(member, componentFunction, symbol, context);
    }
    const result = findTransparentExpressionRoot(member);
    const consumer = result.parent;
    return !(
      (isNodeOfType(consumer, "MemberExpression") && consumer.object === result) ||
      ((isNodeOfType(consumer, "CallExpression") || isNodeOfType(consumer, "NewExpression")) &&
        consumer.callee === result) ||
      (isNodeOfType(consumer, "TaggedTemplateExpression") && consumer.tag === result)
    );
  });

const getFiniteNativeWriterGuardInputs = (
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>,
  componentFunction: EsTreeNode,
  context: RuleContext,
): ReadonlySet<SymbolDescriptor> | null => {
  let contextGuard: SymbolDescriptor | null = null;
  let controlledInputs: ReadonlySet<SymbolDescriptor> | null = null;
  for (const [symbol, value] of guardValues) {
    if (value !== false) return null;
    if (isGenuineNativeWriterContextBinding(symbol, componentFunction, context)) {
      if (
        contextGuard ||
        hasVisibleContextMemberMutation(symbol) ||
        !hasGuardedOwnContextReads(symbol, componentFunction, context)
      ) {
        return null;
      }
      contextGuard = symbol;
      continue;
    }
    if (controlledInputs) return null;
    controlledInputs = getControlledNativeWriterInputs(symbol, componentFunction, context);
    if (!controlledInputs) return null;
  }
  if (contextGuard && controlledInputs?.has(contextGuard)) return null;
  return controlledInputs ?? new Set();
};

const hasCompatibleNativeHostGuards = (
  attribute: EsTreeNode,
  componentFunction: EsTreeNode,
  context: RuleContext,
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>,
  controlledInputSymbols: ReadonlySet<SymbolDescriptor>,
): boolean => {
  if (
    !isFunctionLike(componentFunction) ||
    collectFunctionReturnStatements(componentFunction).length !== 1
  ) {
    return false;
  }
  let hasUnsupportedComponentFlow = false;
  walkOwnFunctionScope(componentFunction, (node) => {
    if (NATIVE_EVENT_WRITER_UNSUPPORTED_COMPONENT_CONTROL_FLOW_NODES.has(node.type)) {
      hasUnsupportedComponentFlow = true;
      return false;
    }
  });
  if (hasUnsupportedComponentFlow) return false;
  const program = findProgramRoot(attribute);
  if (!program) return false;
  const hasCompatibleCondition = (condition: EsTreeNode, requiredValue: boolean): boolean => {
    let predicate = stripParenExpression(condition);
    while (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!") {
      requiredValue = !requiredValue;
      predicate = stripParenExpression(predicate.argument);
    }
    const literalValue = readStaticBoolean(predicate);
    if (literalValue !== null) return literalValue === requiredValue;
    if (!isNodeOfType(predicate, "Identifier")) return false;
    const symbol = context.scopes.symbolFor(predicate);
    if (!symbol || controlledInputSymbols.has(symbol)) return false;
    if (guardValues.has(symbol)) return guardValues.get(symbol) === requiredValue;
    const constantValue = readStaticBoolean(getDirectConstInitializer(symbol));
    if (constantValue !== null) return constantValue === requiredValue;
    return Boolean(
      symbol.kind === "parameter" &&
      componentFunction.params.some((parameter) =>
        isAstDescendant(symbol.bindingIdentifier, parameter),
      ) &&
      hasCompleteSymbolReferences(symbol, program, context.scopes) &&
      getRuntimeSymbolReferences(symbol).every((reference) => reference.flag === "read"),
    );
  };
  let current = attribute.parent;
  while (current && current !== componentFunction) {
    if (isNodeOfType(current, "IfStatement")) {
      const inConsequent = isAstDescendant(attribute, current.consequent);
      if (
        (!inConsequent && (!current.alternate || !isAstDescendant(attribute, current.alternate))) ||
        !hasCompatibleCondition(current.test, inConsequent)
      ) {
        return false;
      }
    } else if (isNodeOfType(current, "ConditionalExpression")) {
      const inConsequent = isAstDescendant(attribute, current.consequent);
      if (
        (!inConsequent && !isAstDescendant(attribute, current.alternate)) ||
        !hasCompatibleCondition(current.test, inConsequent)
      ) {
        return false;
      }
    } else if (
      isNodeOfType(current, "LogicalExpression") &&
      isAstDescendant(attribute, current.right)
    ) {
      if (
        (current.operator !== "&&" && current.operator !== "||") ||
        !hasCompatibleCondition(current.left, current.operator === "&&")
      ) {
        return false;
      }
    }
    current = current.parent;
  }
  return current === componentFunction;
};

const isNativeEventWitnessAttribute = (
  attribute: EsTreeNode,
  componentFunction: EsTreeNode,
  context: RuleContext,
  guardValues: ReadonlyMap<SymbolDescriptor, boolean> | undefined,
  controlledInputSymbols: ReadonlySet<SymbolDescriptor> | undefined,
): boolean => {
  if (
    !isNodeOfType(attribute, "JSXAttribute") ||
    !guardValues ||
    !controlledInputSymbols ||
    !hasCompatibleNativeHostGuards(
      attribute,
      componentFunction,
      context,
      guardValues,
      controlledInputSymbols,
    )
  ) {
    return false;
  }
  const openingElement = attribute.parent;
  const eventName = getJsxAttributeName(attribute.name);
  if (
    !eventName ||
    !NATIVE_EVENT_WRITER_EVENT_NAMES.has(eventName) ||
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isProvenIntrinsicJsxElement(openingElement, context.scopes) ||
    !HTML_TAGS.has(resolveJsxElementType(openingElement)) ||
    getAuthoritativeJsxAttribute(openingElement.attributes, eventName) !== attribute ||
    findEnclosingFunction(attribute) !== componentFunction ||
    openingElement.attributes.some(
      (candidate) =>
        isNodeOfType(candidate, "JSXSpreadAttribute") ||
        (candidate !== attribute &&
          isNodeOfType(candidate, "JSXAttribute") &&
          getJsxAttributeName(candidate.name) === eventName),
    )
  ) {
    return false;
  }
  let current: EsTreeNode | null | undefined = openingElement.parent;
  while (current && current !== componentFunction) {
    if (
      isNodeOfType(current, "JSXElement") &&
      (!isProvenIntrinsicJsxElement(current.openingElement, context.scopes) ||
        !HTML_TAGS.has(resolveJsxElementType(current.openingElement)) ||
        NATIVE_EVENT_WRITER_INACTIVE_ANCESTOR_TAG_NAMES.has(
          resolveJsxElementType(current.openingElement),
        ) ||
        (current.openingElement !== openingElement &&
          NATIVE_EVENT_WRITER_UNSUPPORTED_ANCESTOR_TAG_NAMES.has(
            resolveJsxElementType(current.openingElement),
          )) ||
        current.openingElement.attributes.some(
          (candidate) =>
            isNodeOfType(candidate, "JSXSpreadAttribute") ||
            (isNodeOfType(candidate, "JSXAttribute") &&
              NATIVE_EVENT_WRITER_INACTIVE_ATTRIBUTE_NAMES.has(
                getJsxAttributeName(candidate.name) ?? "",
              )),
        ))
    ) {
      return false;
    }
    const expression = findTransparentExpressionRoot(current);
    const parent = expression.parent;
    if (isNodeOfType(parent, "ReturnStatement")) {
      return parent.argument === expression && isNodeReachableWithinFunction(attribute, context);
    }
    if (
      (isNodeOfType(parent, "JSXElement") || isNodeOfType(parent, "JSXFragment")) &&
      parent.children.some((child) => child === expression)
    ) {
      current = parent;
      continue;
    }
    if (
      (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === expression) ||
      (isNodeOfType(parent, "LogicalExpression") && parent.right === expression) ||
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === expression || parent.alternate === expression))
    ) {
      current = parent;
      continue;
    }
    return false;
  }
  return false;
};

const hasGenuineNativeWriterState = (
  setterVariable: Variable,
  effectNode: EsTreeNode,
  context: RuleContext,
): boolean => {
  const definition = setterVariable.defs[0];
  if (setterVariable.defs.length !== 1 || definition?.type !== "Variable") return false;
  const declaration = definition.node as unknown as EsTreeNode;
  if (
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern") ||
    !isNodeOfType(declaration.init, "CallExpression") ||
    declaration.init.optional ||
    !isNodeOfType(declaration.init.callee, "Identifier")
  ) {
    return false;
  }
  const importedHook = context.scopes.symbolFor(declaration.init.callee);
  return Boolean(
    importedHook &&
    getValueImportSource(importedHook) === "react" &&
    getImportedName(importedHook.declarationNode) === "useState" &&
    hasCompleteReadonlyVariable(setterVariable, effectNode, context),
  );
};

interface NativeEventWriterPayload {
  argumentIndex: number;
  stateIdentifier: EsTreeNode;
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>;
  controlledInputSymbols: ReadonlySet<SymbolDescriptor>;
}

const hasVisibleContextMemberMutation = (symbol: SymbolDescriptor): boolean =>
  getRuntimeSymbolReferences(symbol).some((reference) => {
    let member = findTransparentExpressionRoot(reference.identifier);
    while (isNodeOfType(member.parent, "MemberExpression") && member.parent.object === member) {
      member = findTransparentExpressionRoot(member.parent);
    }
    const parent = member.parent;
    if (isWithinAssignmentTarget(member)) return true;
    if (
      !isNodeOfType(parent, "CallExpression") ||
      !parent.arguments.some((argument) => argument === member)
    ) {
      return false;
    }
    const callee = stripParenExpression(parent.callee);
    return Boolean(
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      NATIVE_EVENT_WRITER_UNSUPPORTED_MEMBERS.has(callee.property.name),
    );
  });

const isContextCallInOppositeArm = (
  callExpression: EsTreeNode,
  writerFunction: EsTreeNode,
  contextSymbol: SymbolDescriptor,
  context: RuleContext,
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>,
): boolean => {
  if (!guardValues.has(contextSymbol)) return false;
  let current = callExpression.parent;
  while (current && current !== writerFunction) {
    if (isNodeOfType(current, "IfStatement")) {
      let requiredValue = isAstDescendant(callExpression, current.consequent);
      if (
        !requiredValue &&
        (!current.alternate || !isAstDescendant(callExpression, current.alternate))
      ) {
        return false;
      }
      let predicate = stripParenExpression(current.test);
      while (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!") {
        requiredValue = !requiredValue;
        predicate = stripParenExpression(predicate.argument);
      }
      if (
        isNodeOfType(predicate, "Identifier") &&
        context.scopes.symbolFor(predicate) === contextSymbol &&
        guardValues.get(contextSymbol) !== requiredValue
      ) {
        return true;
      }
    }
    current = current.parent;
  }
  return false;
};

const hasClosedNativeWriterCalls = (
  writerFunction: EsTreeNode,
  componentFunction: EsTreeNode,
  setterCall: EsTreeNode,
  context: RuleContext,
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>,
): boolean => {
  if (
    !isFunctionLike(writerFunction) ||
    !writerFunction.body ||
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(setterCall, "CallExpression") ||
    !isNodeOfType(setterCall.callee, "Identifier")
  ) {
    return false;
  }
  const program = findProgramRoot(writerFunction);
  const setterSymbol = context.scopes.symbolFor(setterCall.callee);
  if (!program || !setterSymbol) return false;
  const hasReadonlyBinding = (symbol: SymbolDescriptor | null): boolean =>
    Boolean(
      symbol &&
      hasCompleteSymbolReferences(symbol, program, context.scopes) &&
      getRuntimeSymbolReferences(symbol).every((reference) => reference.flag === "read"),
    );
  const propsPattern = componentFunction.params[0];
  const pendingStatements: EsTreeNode[] = isNodeOfType(writerFunction.body, "BlockStatement")
    ? [...writerFunction.body.body]
    : [];
  while (pendingStatements.length > 0) {
    const statement = pendingStatements.pop();
    if (isNodeOfType(statement, "BlockStatement")) {
      pendingStatements.push(...statement.body);
    } else if (isNodeOfType(statement, "IfStatement")) {
      pendingStatements.push(statement.consequent);
      if (statement.alternate) pendingStatements.push(statement.alternate);
    } else if (
      !isNodeOfType(statement, "ExpressionStatement") ||
      !isNodeOfType(stripParenExpression(statement.expression), "CallExpression")
    ) {
      return false;
    }
  }
  let closedCalls = true;
  walkAst(writerFunction.body, (node) => {
    if (!closedCalls) return false;
    if (
      isFunctionLike(node) ||
      isNodeOfType(node, "AwaitExpression") ||
      isNodeOfType(node, "YieldExpression") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "TaggedTemplateExpression") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      (isNodeOfType(node, "UnaryExpression") && node.operator === "delete")
    ) {
      closedCalls = false;
      return false;
    }
    if (!isNodeOfType(node, "CallExpression")) return;
    if (node.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))) {
      closedCalls = false;
      return false;
    }
    const callee = stripParenExpression(node.callee);
    if (isNodeOfType(callee, "Identifier")) {
      const symbol = context.scopes.symbolFor(callee);
      if (symbol === setterSymbol && node === setterCall) return;
      closedCalls = Boolean(
        node.optional &&
        symbol &&
        symbol.kind === "parameter" &&
        hasReadonlyBinding(symbol) &&
        isNodeOfType(propsPattern, "ObjectPattern") &&
        propsPattern.properties.some(
          (property) =>
            isNodeOfType(property, "Property") &&
            !property.computed &&
            isNodeOfType(property.key, "Identifier") &&
            property.value === symbol.bindingIdentifier,
        ),
      );
      return;
    }
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      node.optional ||
      !isNodeOfType(callee.property, "Identifier") ||
      !isNodeOfType(callee.object, "Identifier")
    ) {
      closedCalls = false;
      return false;
    }
    const contextSymbol = context.scopes.symbolFor(callee.object);
    closedCalls = Boolean(
      contextSymbol &&
      isGenuineNativeWriterContextBinding(contextSymbol, componentFunction, context) &&
      !hasVisibleContextMemberMutation(contextSymbol) &&
      isContextCallInOppositeArm(node, writerFunction, contextSymbol, context, guardValues),
    );
  });
  return closedCalls;
};

const getNativeEventWriterPayload = (
  setterCall: EsTreeNode,
  writerFunction: EsTreeNode,
  setterVariable: Variable,
  context: RuleContext,
  componentFunction: EsTreeNode,
): NativeEventWriterPayload | null => {
  const program = findProgramRoot(setterCall);
  const declaration = setterVariable.defs[0]?.node as unknown as EsTreeNode;
  if (
    !program ||
    !isNodeOfType(setterCall, "CallExpression") ||
    !isFunctionLike(writerFunction) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    !isNodeOfType(declaration.id, "ArrayPattern")
  ) {
    return null;
  }
  const stateIdentifier = declaration.id.elements[0];
  const writtenArgument = setterCall.arguments[0];
  if (
    !isNodeOfType(stateIdentifier, "Identifier") ||
    !isNodeOfType(writtenArgument, "Identifier")
  ) {
    return null;
  }
  const parameterSymbol = context.scopes.symbolFor(writtenArgument);
  const argumentIndex = writerFunction.params.findIndex(
    (parameter) =>
      isNodeOfType(parameter, "Identifier") &&
      context.scopes.symbolFor(parameter) === parameterSymbol,
  );
  if (
    !parameterSymbol ||
    parameterSymbol.kind !== "parameter" ||
    argumentIndex < 0 ||
    !hasCompleteSymbolReferences(parameterSymbol, program, context.scopes) ||
    getRuntimeSymbolReferences(parameterSymbol).some((reference) => reference.flag !== "read")
  ) {
    return null;
  }
  const guardValues = new Map<SymbolDescriptor, boolean>();
  let current = setterCall.parent;
  while (current && current !== writerFunction) {
    if (NATIVE_EVENT_WRITER_UNSUPPORTED_CONTROL_FLOW_NODES.has(current.type)) return null;
    if (isNodeOfType(current, "IfStatement")) {
      let guardValue = isAstDescendant(setterCall, current.consequent);
      if (!guardValue && (!current.alternate || !isAstDescendant(setterCall, current.alternate))) {
        return null;
      }
      let predicate = stripParenExpression(current.test);
      while (isNodeOfType(predicate, "UnaryExpression") && predicate.operator === "!") {
        guardValue = !guardValue;
        predicate = stripParenExpression(predicate.argument);
      }
      if (!isNodeOfType(predicate, "Identifier")) return null;
      const symbol = context.scopes.symbolFor(predicate);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        isAstDescendant(symbol.declarationNode, writerFunction) ||
        !hasCompleteSymbolReferences(symbol, program, context.scopes) ||
        getRuntimeSymbolReferences(symbol).some((reference) => reference.flag !== "read") ||
        (guardValues.has(symbol) && guardValues.get(symbol) !== guardValue)
      ) {
        return null;
      }
      const staticValue = readStaticBoolean(getDirectConstInitializer(symbol));
      if (staticValue !== null && staticValue !== guardValue) return null;
      guardValues.set(symbol, guardValue);
    }
    current = current.parent;
  }
  const controlledInputSymbols = getFiniteNativeWriterGuardInputs(
    guardValues,
    componentFunction,
    context,
  );
  if (
    current !== writerFunction ||
    !controlledInputSymbols ||
    !hasClosedNativeWriterCalls(writerFunction, componentFunction, setterCall, context, guardValues)
  ) {
    return null;
  }
  return { argumentIndex, stateIdentifier, guardValues, controlledInputSymbols };
};

const hasDirectNativeWriterHandlerPath = (
  writerCall: EsTreeNode,
  handlerFunction: EsTreeNode,
  handlerVariable: Variable,
  componentFunction: EsTreeNode,
  context: RuleContext,
  guardValues: ReadonlyMap<SymbolDescriptor, boolean>,
  controlledInputSymbols: ReadonlySet<SymbolDescriptor>,
): boolean => {
  const definition = handlerVariable.defs[0];
  const declaration = definition?.node as unknown as EsTreeNode;
  if (
    !isNodeOfType(writerCall, "CallExpression") ||
    !isFunctionLike(handlerFunction) ||
    !isNodeOfType(declaration, "VariableDeclarator") ||
    declaration.init !== handlerFunction ||
    handlerFunction.params.length > 1 ||
    !hasOrdinaryNativeWitnessFunction(handlerVariable, componentFunction, context)
  ) {
    return false;
  }
  const pendingArguments: EsTreeNode[] = [...writerCall.arguments];
  while (pendingArguments.length > 0) {
    const argument = pendingArguments.pop();
    if (!argument) return false;
    const expression = stripParenExpression(argument);
    if (isNodeOfType(expression, "Identifier") || isNodeOfType(expression, "Literal")) {
      continue;
    }
    if (isNodeOfType(expression, "UnaryExpression") && expression.operator === "!") {
      pendingArguments.push(expression.argument);
      continue;
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      pendingArguments.push(expression.test, expression.consequent, expression.alternate);
      continue;
    }
    return false;
  }
  const body = handlerFunction.body;
  if (!body) return false;
  const expressions: EsTreeNode[] = [];
  if (isNodeOfType(body, "BlockStatement")) {
    for (const statement of body.body) {
      if (!isNodeOfType(statement, "ExpressionStatement")) return false;
      expressions.push(stripParenExpression(statement.expression));
    }
  } else {
    expressions.push(stripParenExpression(body));
  }
  let writerCalls = 0;
  let preventDefaultCalls = 0;
  for (const expression of expressions) {
    if (expression === writerCall) {
      writerCalls += 1;
      continue;
    }
    if (
      !isNodeOfType(expression, "CallExpression") ||
      expression.optional ||
      expression.arguments.length !== 0
    ) {
      return false;
    }
    const callee = stripParenExpression(expression.callee);
    const eventParameter = handlerFunction.params[0];
    const eventSymbol = isNodeOfType(eventParameter, "Identifier")
      ? context.scopes.symbolFor(eventParameter)
      : null;
    const program = findProgramRoot(handlerFunction);
    if (
      !isNodeOfType(callee, "MemberExpression") ||
      callee.computed ||
      callee.optional ||
      !isNodeOfType(callee.property, "Identifier") ||
      callee.property.name !== "preventDefault" ||
      !isNodeOfType(callee.object, "Identifier") ||
      !eventSymbol ||
      eventSymbol.kind !== "parameter" ||
      context.scopes.symbolFor(callee.object) !== eventSymbol ||
      !program ||
      !hasCompleteSymbolReferences(eventSymbol, program, context.scopes) ||
      getRuntimeSymbolReferences(eventSymbol).some((reference) => reference.flag !== "read")
    ) {
      return false;
    }
    preventDefaultCalls += 1;
  }
  if (writerCalls !== 1 || preventDefaultCalls > 1) return false;
  return handlerVariable.references.some((reference) => {
    if (reference.init || reference.isWrite()) return false;
    const attribute = getJsxEventValueAttribute(reference.identifier as unknown as EsTreeNode);
    return Boolean(
      attribute &&
      isNodeReachableWithinFunction(attribute, context) &&
      isNativeEventWitnessAttribute(
        attribute,
        componentFunction,
        context,
        guardValues,
        controlledInputSymbols,
      ),
    );
  });
};

const hasReachableJsxEventCallPath = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentFunction: EsTreeNode,
  functionVariable: Variable,
  visitedVariables: ReadonlySet<Variable>,
  nativeEventWitnessOnly = false,
  nativePayload?: NativeEventWriterPayload,
): boolean => {
  if (visitedVariables.has(functionVariable)) return false;
  if (
    nativeEventWitnessOnly &&
    (!nativePayload ||
      !hasOrdinaryNativeWitnessFunction(functionVariable, componentFunction, context))
  ) {
    return false;
  }
  const nextVisitedVariables = new Set(visitedVariables).add(functionVariable);
  const callExpressions: EsTreeNode[] = [];
  let hasDirectJsxEventReference = false;
  for (const reference of functionVariable.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (reference.isWrite()) return false;
    const jsxEventValueAttribute = getJsxEventValueAttribute(identifier);
    if (jsxEventValueAttribute) {
      if (nativePayload) continue;
      if (isNodeReachableWithinFunction(jsxEventValueAttribute, context)) {
        hasDirectJsxEventReference = true;
      }
      continue;
    }
    if (isReactHookDependencyReference(identifier)) continue;
    const callExpression = getCallExpr(reference);
    if (!callExpression) {
      if (nativeEventWitnessOnly) continue;
      return false;
    }
    if (
      nativeEventWitnessOnly &&
      (!isNodeOfType(callExpression, "CallExpression") ||
        callExpression.optional ||
        callExpression.callee !== findTransparentExpressionRoot(identifier) ||
        callExpression.arguments.some((argument) => isNodeOfType(argument, "SpreadElement")))
    ) {
      continue;
    }
    if (nativePayload && isNodeOfType(callExpression, "CallExpression")) {
      const argument = callExpression.arguments[nativePayload.argumentIndex];
      if (
        !argument ||
        isNodeOfType(argument, "SpreadElement") ||
        !hasOwnLocalStateBranch(
          argument,
          nativePayload.stateIdentifier,
          context,
          nativePayload.guardValues,
        )
      ) {
        continue;
      }
    }
    const jsxEventCallbackAttribute = getInlineJsxEventCallbackAttribute(callExpression);
    if (jsxEventCallbackAttribute) {
      if (nativeEventWitnessOnly) continue;
      if (
        isNodeReachableWithinFunction(callExpression, context) &&
        isNodeReachableWithinFunction(jsxEventCallbackAttribute, context)
      ) {
        hasDirectJsxEventReference = true;
      }
      continue;
    }
    callExpressions.push(callExpression);
  }
  if (hasDirectJsxEventReference) return true;
  for (const callExpression of callExpressions) {
    if (!isNodeReachableWithinFunction(callExpression, context)) continue;
    const callerFunction = findEnclosingFunction(callExpression);
    if (!callerFunction || callerFunction === componentFunction) continue;
    const callerVariable = getImmutableFunctionVariable(
      analysis,
      componentFunction,
      callerFunction,
    );
    if (nativeEventWitnessOnly) {
      if (
        callerVariable &&
        nativePayload &&
        hasDirectNativeWriterHandlerPath(
          callExpression,
          callerFunction,
          callerVariable,
          componentFunction,
          context,
          nativePayload.guardValues,
          nativePayload.controlledInputSymbols,
        )
      ) {
        return true;
      }
      continue;
    }
    if (
      callerVariable &&
      hasReachableJsxEventCallPath(
        analysis,
        context,
        componentFunction,
        callerVariable,
        nextVisitedVariables,
        nativeEventWitnessOnly,
      )
    ) {
      return true;
    }
  }
  return false;
};

// The state behind `setterRef` has an independent writer: some OTHER
// reference to the same setter binding (outside the flagged effect)
// writes it from an event-handler path — or, with
// `includeDeferredWriters`, from a subscription / promise / timer / async
// callback. Such state carries information (user input, async results)
// that no render-time derivation can reproduce.
export const hasUserInputSetterWriter = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  setterRef: Reference,
  effectNode: EsTreeNode,
  includeDeferredWriters = false,
  options?: UserInputSetterWriterOptions,
): boolean => {
  if (!setterRef.resolved) return false;
  const nativeEventWitnessOnly = options?.nativeEventWitnessOnly === true;
  if (
    nativeEventWitnessOnly &&
    (!hasOrdinaryNativeEventWriterRuntime(effectNode, context) ||
      !hasGenuineNativeWriterState(setterRef.resolved, effectNode, context))
  ) {
    return false;
  }
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction) return false;
  if (
    nativeEventWitnessOnly &&
    setterRef.resolved.references.filter(
      (reference) =>
        !reference.init &&
        !isAstDescendant(reference.identifier as unknown as EsTreeNode, effectNode),
    ).length !== 1
  ) {
    return false;
  }
  for (const reference of setterRef.resolved.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (isAstDescendant(identifier, effectNode)) continue;
    if (
      !nativeEventWitnessOnly &&
      isIndependentWriterIdentifier(componentFunction, identifier, includeDeferredWriters)
    ) {
      return true;
    }
    if (!isNodeReachableWithinFunction(identifier, context)) continue;
    if (nativeEventWitnessOnly) {
      const setterCall = getCallExpr(reference);
      if (
        !isNodeOfType(setterCall, "CallExpression") ||
        setterCall.optional ||
        setterCall.callee !== findTransparentExpressionRoot(identifier) ||
        setterCall.arguments.length === 0 ||
        setterCall.arguments.some((argument) => isNodeOfType(argument, "SpreadElement"))
      ) {
        continue;
      }
    }
    const writerFunction = findEnclosingFunction(identifier);
    if (!writerFunction || writerFunction === componentFunction) continue;
    const writerVariable = getImmutableFunctionVariable(
      analysis,
      componentFunction,
      writerFunction,
    );
    if (
      nativeEventWitnessOnly &&
      writerVariable?.references.some((reference) => {
        if (reference.init) return false;
        const recursiveCall = getCallExpr(reference);
        return Boolean(
          isNodeOfType(recursiveCall, "CallExpression") &&
          recursiveCall.callee ===
            findTransparentExpressionRoot(reference.identifier as unknown as EsTreeNode) &&
          isAstDescendant(recursiveCall, writerFunction),
        );
      })
    ) {
      continue;
    }
    let nativePayload: NativeEventWriterPayload | null | undefined;
    if (nativeEventWitnessOnly) {
      nativePayload = getNativeEventWriterPayload(
        getCallExpr(reference) ?? identifier,
        writerFunction,
        setterRef.resolved,
        context,
        componentFunction,
      );
    }
    if (nativeEventWitnessOnly && !nativePayload) continue;
    if (
      writerVariable &&
      hasReachableJsxEventCallPath(
        analysis,
        context,
        componentFunction,
        writerVariable,
        new Set(),
        nativeEventWitnessOnly,
        nativePayload ?? undefined,
      )
    ) {
      return true;
    }
  }
  return false;
};
