import type { Reference, Variable } from "eslint-scope";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getExecutionReferenceOffset } from "../../../utils/get-execution-reference-offset.js";
import { isReactApiCall } from "../../../utils/is-react-api-call.js";
import { hasFiniteDocumentListenerProvider } from "./has-finite-document-listener-provider.js";
import { findEnclosingFunction } from "../../../utils/find-enclosing-function.js";
import { findTransparentExpressionRoot } from "../../../utils/find-transparent-expression-root.js";
import { getFunctionBindingIdentifier } from "../../../utils/get-function-binding-name.js";
import { getJsxAttributeName } from "../../../utils/get-jsx-attribute-name.js";
import { isAstDescendant } from "../../../utils/is-ast-descendant.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeReachableWithinFunction } from "../../../utils/is-node-reachable-within-function.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
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

const bindingVariablesByAnalysis = new WeakMap<ProgramAnalysis, WeakMap<EsTreeNode, Variable>>();

const findBindingVariable = (
  analysis: ProgramAnalysis,
  bindingIdentifier: EsTreeNode,
): Variable | null => {
  let bindingVariables = bindingVariablesByAnalysis.get(analysis);
  if (!bindingVariables) {
    bindingVariables = new WeakMap();
    for (const scope of analysis.scopeManager.scopes) {
      for (const variable of scope.variables) {
        for (const identifier of variable.identifiers) {
          bindingVariables.set(identifier as unknown as EsTreeNode, variable);
        }
      }
    }
    bindingVariablesByAnalysis.set(analysis, bindingVariables);
  }
  return bindingVariables.get(bindingIdentifier) ?? null;
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

const hasReachableJsxEventCallPath = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentFunction: EsTreeNode,
  functionVariable: Variable,
  visitedVariables: ReadonlySet<Variable>,
): boolean => {
  if (visitedVariables.has(functionVariable)) return false;
  const nextVisitedVariables = new Set(visitedVariables).add(functionVariable);
  const callExpressions: EsTreeNode[] = [];
  let hasDirectJsxEventReference = false;
  for (const reference of functionVariable.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (reference.isWrite()) return false;
    const jsxEventValueAttribute = getJsxEventValueAttribute(identifier);
    if (jsxEventValueAttribute) {
      if (isNodeReachableWithinFunction(jsxEventValueAttribute, context)) {
        hasDirectJsxEventReference = true;
      }
      continue;
    }
    if (isReactHookDependencyReference(identifier)) continue;
    const callExpression = getCallExpr(reference);
    if (!callExpression) return false;
    const jsxEventCallbackAttribute = getInlineJsxEventCallbackAttribute(callExpression);
    if (jsxEventCallbackAttribute) {
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
    if (
      callerVariable &&
      hasReachableJsxEventCallPath(
        analysis,
        context,
        componentFunction,
        callerVariable,
        nextVisitedVariables,
      )
    ) {
      return true;
    }
  }
  return false;
};

const getFiniteCall = (functionNode: EsTreeNode): EsTreeNodeOfType<"CallExpression"> | null => {
  if (
    !isNodeOfType(functionNode, "ArrowFunctionExpression") ||
    !isSynchronousFunction(functionNode) ||
    functionNode.params.length !== 0
  ) {
    return null;
  }
  let expression: EsTreeNode | null | undefined = functionNode.body;
  if (isNodeOfType(expression, "BlockStatement")) {
    if (expression.body.length !== 1) return null;
    const statement = expression.body[0];
    expression = isNodeOfType(statement, "ExpressionStatement")
      ? statement.expression
      : isNodeOfType(statement, "ReturnStatement")
        ? statement.argument
        : null;
  }
  return isNodeOfType(expression, "CallExpression") && !expression.optional ? expression : null;
};

const completeVariables = new WeakMap<Variable, boolean>();

const hasCompleteVariableReferences = (context: RuleContext, variable: Variable): boolean => {
  const cached = completeVariables.get(variable);
  if (cached !== undefined) return cached;
  const identifier = variable.identifiers[0] as unknown as EsTreeNode;
  const symbol = context.scopes.symbolFor(identifier);
  const eslintReferences = new Set(
    variable.references.map((reference) => reference.identifier as unknown as EsTreeNode),
  );
  const semanticReferences = new Set(symbol?.references.map((reference) => reference.identifier));
  const complete = Boolean(
    symbol &&
    symbol.bindingIdentifier === identifier &&
    symbol.references.every((reference) => eslintReferences.has(reference.identifier)) &&
    variable.references.every(
      (reference) =>
        reference.init ||
        (context.scopes.symbolFor(reference.identifier as unknown as EsTreeNode) === symbol &&
          semanticReferences.has(reference.identifier as unknown as EsTreeNode)),
    ),
  );
  completeVariables.set(variable, complete);
  return complete;
};

const isReadonlyConstVariable = (
  context: RuleContext,
  variable: Variable,
  initializer: EsTreeNode,
): boolean => {
  const definition = variable.defs[0];
  const declaration = definition?.node as unknown as EsTreeNode;
  return Boolean(
    variable.defs.length === 1 &&
    variable.identifiers.length === 1 &&
    hasCompleteVariableReferences(context, variable) &&
    definition.type === "Variable" &&
    isNodeOfType(declaration, "VariableDeclarator") &&
    declaration.init === initializer &&
    isNodeOfType(declaration.parent, "VariableDeclaration") &&
    declaration.parent.kind === "const" &&
    variable.references.every(
      (reference) =>
        !reference.isWrite() ||
        (reference.init &&
          reference.identifier === variable.identifiers[0] &&
          reference.writeExpr === initializer),
    ),
  );
};

const readonlyInputBindings = new WeakMap<Variable, boolean>();

const hasReadonlyInputReferences = (variable: Variable): boolean => {
  const cached = readonlyInputBindings.get(variable);
  if (cached !== undefined) return cached;
  const readonly = variable.references.every((reference) => !reference.isWrite());
  readonlyInputBindings.set(variable, readonly);
  return readonly;
};

const supportedDocumentWriterComponents = new WeakMap<EsTreeNode, boolean>();

const isFiniteHookCall = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  call: EsTreeNode,
  hookName: string,
): boolean => {
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    !isNodeOfType(call.callee, "Identifier") ||
    !isReactApiCall(call, hookName, context.scopes)
  ) {
    return false;
  }
  const hookVariable = analysis.referenceByIdentifier.get(call.callee)?.resolved;
  if (!hookVariable) return false;
  return (
    hookVariable.defs.length === 1 &&
    hookVariable.defs[0].type === "ImportBinding" &&
    hasReadonlyInputReferences(hookVariable)
  );
};

const isFiniteDependencyReference = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  reference: Reference,
  componentFunction: EsTreeNode,
): boolean => {
  const identifier = reference.identifier as unknown as EsTreeNode;
  const dependencies = identifier.parent;
  const hookCall = dependencies?.parent;
  return Boolean(
    isNodeOfType(dependencies, "ArrayExpression") &&
    isNodeOfType(hookCall, "CallExpression") &&
    hookCall.arguments[1] === dependencies &&
    findEnclosingFunction(hookCall) === componentFunction &&
    isFiniteHookCall(analysis, context, hookCall, "useEffect"),
  );
};

const getDocumentListenerCall = (
  analysis: ProgramAnalysis,
  identifier: EsTreeNode,
  methodName: string,
): EsTreeNode | null => {
  const call = identifier.parent;
  if (
    !isNodeOfType(call, "CallExpression") ||
    call.optional ||
    call.arguments.length !== 2 ||
    call.arguments[1] !== identifier ||
    !isNodeOfType(call.arguments[0], "Literal") ||
    call.arguments[0].value !== "click" ||
    !isNodeOfType(call.callee, "MemberExpression") ||
    call.callee.optional ||
    call.callee.computed ||
    !isNodeOfType(call.callee.object, "Identifier") ||
    call.callee.object.name !== "document" ||
    analysis.referenceByIdentifier.get(call.callee.object)?.resolved !== null ||
    !isNodeOfType(call.callee.property, "Identifier") ||
    call.callee.property.name !== methodName
  ) {
    return null;
  }
  return call;
};

const hasFiniteDocumentRegistration = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentFunction: EsTreeNode,
  callbackVariable: Variable,
  callbackFunction: EsTreeNode,
  writerVariable: Variable,
): boolean => {
  let registration: EsTreeNode | null = null;
  let removal: EsTreeNode | null = null;
  for (const reference of callbackVariable.references) {
    if (reference.init) continue;
    if (isFiniteDependencyReference(analysis, context, reference, componentFunction)) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    const addCall = getDocumentListenerCall(analysis, identifier, "addEventListener");
    const removeCall = getDocumentListenerCall(analysis, identifier, "removeEventListener");
    if (addCall && !registration) registration = addCall;
    else if (removeCall && !removal) removal = removeCall;
    else return false;
  }
  if (!registration || !removal) return false;
  const setupFunction = findEnclosingFunction(registration);
  if (
    !isNodeOfType(setupFunction, "ArrowFunctionExpression") ||
    !isSynchronousFunction(setupFunction) ||
    setupFunction.params.length !== 0 ||
    !isNodeOfType(setupFunction.body, "BlockStatement")
  ) {
    return false;
  }
  const hookCall = setupFunction.parent;
  if (
    !isNodeOfType(hookCall, "CallExpression") ||
    hookCall.arguments.length !== 2 ||
    hookCall.arguments[0] !== setupFunction ||
    !isNodeOfType(hookCall.arguments[1], "ArrayExpression") ||
    !isFiniteHookCall(analysis, context, hookCall, "useEffect") ||
    findEnclosingFunction(hookCall) !== componentFunction ||
    !isNodeReachableWithinFunction(hookCall, context)
  ) {
    return false;
  }
  const callbackOwner = findEnclosingFunction(callbackFunction);
  const callbackDeclaration = callbackFunction.parent;
  if (!isNodeOfType(callbackDeclaration, "VariableDeclarator")) return false;
  const callbackStatement = callbackDeclaration.parent;
  if (!isNodeOfType(callbackStatement, "VariableDeclaration")) return false;
  const setupStatements = setupFunction.body.body;
  const callbackIsEffectLocal = callbackOwner === setupFunction;
  const expectedStatements = callbackIsEffectLocal ? setupStatements.slice(1) : setupStatements;
  if (
    (callbackIsEffectLocal &&
      (setupStatements[0] !== callbackStatement || callbackStatement.declarations.length !== 1)) ||
    (!callbackIsEffectLocal && callbackOwner !== componentFunction) ||
    expectedStatements.length !== 2 ||
    !isNodeOfType(expectedStatements[0], "ExpressionStatement") ||
    expectedStatements[0].expression !== registration ||
    !isNodeOfType(expectedStatements[1], "ReturnStatement")
  ) {
    return false;
  }
  const cleanup = expectedStatements[1].argument;
  if (getFiniteCall(cleanup ?? setupFunction) !== removal) return false;
  if (findEnclosingFunction(removal) !== cleanup) return false;
  const componentBody = isFunctionLike(componentFunction) ? componentFunction.body : null;
  const hookStatement = hookCall.parent;
  if (
    !isNodeOfType(componentBody, "BlockStatement") ||
    !isNodeOfType(hookStatement, "ExpressionStatement") ||
    hookStatement.parent !== componentBody ||
    !isSynchronousFunction(componentFunction)
  ) {
    return false;
  }
  let supportedComponent = supportedDocumentWriterComponents.get(componentFunction);
  if (supportedComponent === undefined) {
    supportedComponent = componentBody.body.every(
      (statement) =>
        isNodeOfType(statement, "VariableDeclaration") ||
        isNodeOfType(statement, "ExpressionStatement") ||
        isNodeOfType(statement, "ReturnStatement"),
    );
    supportedDocumentWriterComponents.set(componentFunction, supportedComponent);
  }
  if (!supportedComponent) return false;
  for (const variable of new Set([callbackVariable, writerVariable])) {
    const declaration = variable.defs[0].node as unknown as EsTreeNode;
    const declarationOwner = findEnclosingFunction(declaration);
    if (declarationOwner === setupFunction && variable === callbackVariable) continue;
    if (
      declarationOwner !== componentFunction ||
      declaration.parent?.parent !== componentBody ||
      getExecutionReferenceOffset(declaration) >= getExecutionReferenceOffset(hookStatement) ||
      !isNodeReachableWithinFunction(declaration, context)
    ) {
      return false;
    }
  }
  return true;
};

const hasFiniteDocumentClickWriter = (
  analysis: ProgramAnalysis,
  context: RuleContext,
  componentFunction: EsTreeNode,
  setterVariable: Variable,
  effectNode: EsTreeNode,
  writerFunction: EsTreeNode,
  writerVariable: Variable,
): boolean => {
  const setterDeclaration = setterVariable.defs[0]?.node as unknown as EsTreeNode;
  const setterCall = getFiniteCall(writerFunction);
  const syncFunction = isNodeOfType(effectNode, "CallExpression") ? effectNode.arguments[0] : null;
  const syncCall = syncFunction ? getFiniteCall(syncFunction) : null;
  if (
    !setterCall ||
    !syncCall ||
    !isNodeOfType(setterDeclaration, "VariableDeclarator") ||
    !isNodeOfType(setterDeclaration.init, "CallExpression") ||
    !isNodeOfType(setterDeclaration.id, "ArrayPattern") ||
    setterDeclaration.id.elements.length !== 2 ||
    !isNodeOfType(setterDeclaration.id.elements[0], "Identifier") ||
    setterDeclaration.init.arguments.length !== 1 ||
    !isNodeOfType(setterDeclaration.init.arguments[0], "Literal") ||
    setterDeclaration.init.arguments[0].value !== false ||
    setterDeclaration.parent?.parent !==
      (isFunctionLike(componentFunction) ? componentFunction.body : null) ||
    setterDeclaration.id.elements[1] !== setterVariable.identifiers[0] ||
    findEnclosingFunction(setterDeclaration) !== componentFunction ||
    !isFiniteHookCall(analysis, context, setterDeclaration.init, "useState") ||
    !isReadonlyConstVariable(context, setterVariable, setterDeclaration.init) ||
    !isFiniteHookCall(analysis, context, effectNode, "useEffect") ||
    !isReadonlyConstVariable(context, writerVariable, writerFunction) ||
    setterCall.arguments.length !== 1 ||
    !isNodeOfType(setterCall.arguments[0], "Literal") ||
    setterCall.arguments[0].value !== false ||
    analysis.referenceByIdentifier.get(setterCall.callee)?.resolved !== setterVariable ||
    analysis.referenceByIdentifier.get(syncCall.callee)?.resolved !== setterVariable ||
    syncCall.arguments.length !== 1 ||
    !isNodeOfType(syncCall.arguments[0], "Identifier")
  ) {
    return false;
  }
  if (
    !isFunctionLike(componentFunction) ||
    !isNodeOfType(componentFunction.params[0], "ObjectPattern") ||
    !isNodeOfType(effectNode, "CallExpression") ||
    !isNodeOfType(effectNode.parent, "ExpressionStatement") ||
    effectNode.parent.parent !== componentFunction.body ||
    effectNode.arguments.length !== 2 ||
    !isNodeOfType(effectNode.arguments[1], "ArrayExpression") ||
    effectNode.arguments[1].elements.length !== 1 ||
    !isNodeOfType(effectNode.arguments[1].elements[0], "Identifier") ||
    analysis.referenceByIdentifier.get(effectNode.arguments[1].elements[0])?.resolved !==
      analysis.referenceByIdentifier.get(syncCall.arguments[0])?.resolved
  )
    return false;
  const propVariable = analysis.referenceByIdentifier.get(syncCall.arguments[0])?.resolved;
  const propDefinition = propVariable?.defs[0];
  if (
    !propVariable ||
    propVariable.defs.length !== 1 ||
    propDefinition?.type !== "Parameter" ||
    !componentFunction.params[0].properties.some(
      (property) =>
        isNodeOfType(property, "Property") &&
        !property.computed &&
        !property.method &&
        property.kind === "init" &&
        property.value === propVariable.identifiers[0],
    ) ||
    propDefinition.node !== componentFunction ||
    !hasReadonlyInputReferences(propVariable) ||
    setterVariable.references.some(
      (reference) =>
        !reference.init &&
        getCallExpr(reference) !== setterCall &&
        getCallExpr(reference) !== syncCall,
    ) ||
    !hasFiniteDocumentListenerProvider(analysis, context)
  ) {
    return false;
  }
  if (
    hasFiniteDocumentRegistration(
      analysis,
      context,
      componentFunction,
      writerVariable,
      writerFunction,
      writerVariable,
    )
  )
    return true;
  let writerCall: EsTreeNodeOfType<"CallExpression"> | null = null;
  for (const reference of writerVariable.references) {
    if (
      reference.init ||
      isFiniteDependencyReference(analysis, context, reference, componentFunction)
    )
      continue;
    const call = getCallExpr(reference);
    if (
      writerCall ||
      !isNodeOfType(call, "CallExpression") ||
      call.optional ||
      call.arguments.length !== 0 ||
      call.callee !== reference.identifier
    )
      return false;
    writerCall = call;
  }
  if (!writerCall) return false;
  const callbackFunction = findEnclosingFunction(writerCall);
  if (!callbackFunction || getFiniteCall(callbackFunction) !== writerCall) return false;
  const callbackVariable = getImmutableFunctionVariable(
    analysis,
    componentFunction,
    callbackFunction,
  );
  return Boolean(
    callbackVariable &&
    isReadonlyConstVariable(context, callbackVariable, callbackFunction) &&
    hasFiniteDocumentRegistration(
      analysis,
      context,
      componentFunction,
      callbackVariable,
      callbackFunction,
      writerVariable,
    ),
  );
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
): boolean => {
  if (!setterRef.resolved) return false;
  const componentFunction = findEnclosingFunction(effectNode);
  if (!componentFunction) return false;
  for (const reference of setterRef.resolved.references) {
    if (reference.init) continue;
    const identifier = reference.identifier as unknown as EsTreeNode;
    if (isAstDescendant(identifier, effectNode)) continue;
    if (isIndependentWriterIdentifier(componentFunction, identifier, includeDeferredWriters)) {
      return true;
    }
    if (!isNodeReachableWithinFunction(identifier, context)) continue;
    const writerFunction = findEnclosingFunction(identifier);
    if (!writerFunction || writerFunction === componentFunction) continue;
    const writerVariable = getImmutableFunctionVariable(
      analysis,
      componentFunction,
      writerFunction,
    );
    if (
      includeDeferredWriters &&
      writerVariable &&
      hasFiniteDocumentClickWriter(
        analysis,
        context,
        componentFunction,
        setterRef.resolved,
        effectNode,
        writerFunction,
        writerVariable,
      )
    ) {
      return true;
    }
    if (
      writerVariable &&
      hasReachableJsxEventCallPath(analysis, context, componentFunction, writerVariable, new Set())
    ) {
      return true;
    }
  }
  return false;
};
