import { defineRule } from "../../utils/define-rule.js";
import { collectMutationReceiverKinds } from "../../utils/collect-mutation-receiver-kinds.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findEnclosingClass } from "../../utils/find-enclosing-class.js";
import { getNodeStartIndex } from "../../utils/get-node-start-index.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticThisOrAliasFieldName } from "../../utils/get-static-this-or-alias-field-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isImmediatelyInvokedFunction } from "../../utils/is-immediately-invoked-function.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isSetStateCallInLifecycle } from "../../utils/is-set-state-in-lifecycle.js";
import { isSynchronousIteratorCall } from "../../utils/is-synchronous-iterator-callback.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getCallbackRefFieldNames } from "./no-did-update-set-state.js";

const LIFECYCLE_NAMES = new Set(["componentDidMount"]);
const MESSAGE =
  "Your users see an extra render right after mount when you call `setState` in `componentDidMount`.";

const getEnclosingLifecycleFunction = (setStateCall: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      const parent = ancestor.parent;
      if (
        (isNodeOfType(parent, "MethodDefinition") ||
          isNodeOfType(parent, "PropertyDefinition") ||
          isNodeOfType(parent, "Property")) &&
        isNodeOfType(parent.key, "Identifier") &&
        LIFECYCLE_NAMES.has(parent.key.name)
      ) {
        return ancestor;
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return null;
};

const isInsideNestedLifecycleFunction = (
  setStateCall: EsTreeNode,
  lifecycleFunction: EsTreeNode,
): boolean => {
  let ancestor: EsTreeNode | null | undefined = setStateCall.parent;
  while (ancestor && ancestor !== lifecycleFunction) {
    if (isFunctionLike(ancestor)) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

// `this.setState({ hasMounted: true })` — flipping a boolean flag to `true`
// right after mount is the deliberate two-pass render pattern (hydration
// gates, enter animations): the second render IS the point, and no initial
// state or getDerivedStateFromProps can replace it.
const isMountFlagProperty = (property: EsTreeNode): boolean =>
  isNodeOfType(property, "Property") &&
  property.kind === "init" &&
  property.computed !== true &&
  isNodeOfType(property.value, "Literal") &&
  property.value.value === true;

const isMountFlagArgument = (argument: EsTreeNode | undefined): boolean => {
  if (!argument || !isNodeOfType(argument, "ObjectExpression")) return false;
  const properties = argument.properties ?? [];
  if (properties.length === 0) return false;
  return properties.every(isMountFlagProperty);
};

// Sources whose values genuinely cannot exist before mount — the doc's
// explicit carve-out ("reserve componentDidMount setState for values that
// can only exist post-mount, e.g. a measured DOM size").
const POST_MOUNT_MEMBER_NAMES = new Set([
  "current",
  "textContent",
  "innerText",
  "offsetWidth",
  "offsetHeight",
  "offsetTop",
  "offsetLeft",
  "clientWidth",
  "clientHeight",
  "scrollWidth",
  "scrollHeight",
  "scrollTop",
  "scrollLeft",
  "getBoundingClientRect",
]);
const OBSERVER_CONSTRUCTOR_PATTERN = /Observer$/;

const getStaticThisFieldName = (node: EsTreeNode): string | null => {
  const candidate = stripParenExpression(node);
  if (
    !isNodeOfType(candidate, "MemberExpression") ||
    !isNodeOfType(stripParenExpression(candidate.object as EsTreeNode), "ThisExpression")
  ) {
    return null;
  }
  return getStaticPropertyKeyName(candidate, { allowComputedString: true });
};

const containsPostMountSource = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let didFindSource = false;
  walkAst(node, (descendant) => {
    if (didFindSource) return false;
    if (descendant !== node && isFunctionLike(descendant)) {
      const parent = descendant.parent;
      if (
        !isImmediatelyInvokedFunction(descendant) &&
        (!isNodeOfType(parent, "CallExpression") ||
          !isSynchronousIteratorCall(parent, descendant, scopes))
      ) {
        return false;
      }
    }
    if (
      isNodeOfType(descendant, "NewExpression") &&
      isNodeOfType(descendant.callee, "Identifier") &&
      OBSERVER_CONSTRUCTOR_PATTERN.test(descendant.callee.name)
    ) {
      didFindSource = true;
      return false;
    }
    if (
      isNodeOfType(descendant, "MemberExpression") &&
      isNodeOfType(descendant.property, "Identifier") &&
      descendant.computed !== true &&
      POST_MOUNT_MEMBER_NAMES.has(descendant.property.name)
    ) {
      didFindSource = true;
      return false;
    }
  });
  return didFindSource;
};

const containsCallbackRefField = (
  node: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  let didFindCallbackRefField = false;
  walkAst(node, (descendant) => {
    if (descendant !== node && isFunctionLike(descendant)) {
      const parent = descendant.parent;
      if (
        !isImmediatelyInvokedFunction(descendant) &&
        (!isNodeOfType(parent, "CallExpression") ||
          !isSynchronousIteratorCall(parent, descendant, scopes))
      ) {
        return false;
      }
    }
    const fieldName = getStaticThisFieldName(descendant);
    if (fieldName && callbackRefFieldNames.has(fieldName)) {
      didFindCallbackRefField = true;
      return false;
    }
    return undefined;
  });
  return didFindCallbackRefField;
};

interface CallbackRefValueEvidence {
  hasCallbackRefValue: boolean;
  hasDynamicValue: boolean;
}

const combineCallbackRefValueEvidence = (
  nodes: readonly EsTreeNode[],
  callbackRefFieldNames: ReadonlySet<string>,
): CallbackRefValueEvidence =>
  nodes.reduce<CallbackRefValueEvidence>(
    (evidence, node) => {
      const nodeEvidence = collectCallbackRefValueEvidence(node, callbackRefFieldNames);
      return {
        hasCallbackRefValue: evidence.hasCallbackRefValue || nodeEvidence.hasCallbackRefValue,
        hasDynamicValue: evidence.hasDynamicValue || nodeEvidence.hasDynamicValue,
      };
    },
    { hasCallbackRefValue: false, hasDynamicValue: false },
  );

const collectCallbackRefValueEvidence = (
  node: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
): CallbackRefValueEvidence => {
  const candidate = stripParenExpression(node);
  const callbackRefFieldName = getStaticThisFieldName(candidate);
  if (callbackRefFieldName && callbackRefFieldNames.has(callbackRefFieldName)) {
    return { hasCallbackRefValue: true, hasDynamicValue: false };
  }
  if (isNodeOfType(candidate, "Literal")) {
    return { hasCallbackRefValue: false, hasDynamicValue: false };
  }
  if (isNodeOfType(candidate, "Identifier")) {
    return {
      hasCallbackRefValue: false,
      hasDynamicValue: candidate.name !== "undefined",
    };
  }
  if (isNodeOfType(candidate, "UnaryExpression") || isNodeOfType(candidate, "AwaitExpression")) {
    return collectCallbackRefValueEvidence(candidate.argument, callbackRefFieldNames);
  }
  if (isNodeOfType(candidate, "BinaryExpression") || isNodeOfType(candidate, "LogicalExpression")) {
    return combineCallbackRefValueEvidence(
      [candidate.left, candidate.right],
      callbackRefFieldNames,
    );
  }
  if (isNodeOfType(candidate, "ConditionalExpression")) {
    return combineCallbackRefValueEvidence(
      [candidate.test, candidate.consequent, candidate.alternate],
      callbackRefFieldNames,
    );
  }
  if (isNodeOfType(candidate, "SequenceExpression")) {
    const finalExpression = candidate.expressions.at(-1);
    return finalExpression
      ? collectCallbackRefValueEvidence(finalExpression, callbackRefFieldNames)
      : { hasCallbackRefValue: false, hasDynamicValue: true };
  }
  if (isNodeOfType(candidate, "TemplateLiteral")) {
    return combineCallbackRefValueEvidence(candidate.expressions, callbackRefFieldNames);
  }
  if (isNodeOfType(candidate, "ArrayExpression")) {
    const elementNodes: EsTreeNode[] = [];
    for (const element of candidate.elements) {
      if (!element || isNodeOfType(element, "SpreadElement")) {
        return { hasCallbackRefValue: false, hasDynamicValue: true };
      }
      elementNodes.push(element);
    }
    return combineCallbackRefValueEvidence(elementNodes, callbackRefFieldNames);
  }
  if (isNodeOfType(candidate, "ObjectExpression")) {
    const valueNodes: EsTreeNode[] = [];
    for (const property of candidate.properties) {
      if (!isNodeOfType(property, "Property") || property.kind !== "init") {
        return { hasCallbackRefValue: false, hasDynamicValue: true };
      }
      if (property.computed === true) valueNodes.push(property.key as EsTreeNode);
      valueNodes.push(property.value as EsTreeNode);
    }
    return combineCallbackRefValueEvidence(valueNodes, callbackRefFieldNames);
  }
  if (isNodeOfType(candidate, "MemberExpression")) {
    const objectEvidence = collectCallbackRefValueEvidence(
      candidate.object as EsTreeNode,
      callbackRefFieldNames,
    );
    if (!objectEvidence.hasCallbackRefValue || objectEvidence.hasDynamicValue) {
      return { hasCallbackRefValue: false, hasDynamicValue: true };
    }
    if (candidate.computed !== true) return objectEvidence;
    const propertyEvidence = collectCallbackRefValueEvidence(
      candidate.property as EsTreeNode,
      callbackRefFieldNames,
    );
    return {
      hasCallbackRefValue: true,
      hasDynamicValue: propertyEvidence.hasDynamicValue,
    };
  }
  if (isNodeOfType(candidate, "CallExpression") || isNodeOfType(candidate, "NewExpression")) {
    const argumentNodes: EsTreeNode[] = [];
    for (const argument of candidate.arguments) {
      if (isNodeOfType(argument, "SpreadElement")) {
        return { hasCallbackRefValue: false, hasDynamicValue: true };
      }
      argumentNodes.push(argument as EsTreeNode);
    }
    const argumentEvidence = combineCallbackRefValueEvidence(argumentNodes, callbackRefFieldNames);
    const callee = stripParenExpression(candidate.callee);
    if (!isNodeOfType(callee, "MemberExpression")) return argumentEvidence;
    const receiverEvidence = collectCallbackRefValueEvidence(
      callee.object as EsTreeNode,
      callbackRefFieldNames,
    );
    if (!receiverEvidence.hasCallbackRefValue || receiverEvidence.hasDynamicValue) {
      return argumentEvidence;
    }
    return {
      hasCallbackRefValue: true,
      hasDynamicValue: argumentEvidence.hasDynamicValue,
    };
  }
  return { hasCallbackRefValue: false, hasDynamicValue: true };
};

const isCallbackRefDerivedValue = (
  node: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
): boolean => {
  const evidence = collectCallbackRefValueEvidence(node, callbackRefFieldNames);
  return evidence.hasCallbackRefValue && !evidence.hasDynamicValue;
};

const functionReturnsCallbackRefDerivedValue = (
  functionBody: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
): boolean => {
  if (!isNodeOfType(functionBody, "BlockStatement")) {
    return isCallbackRefDerivedValue(functionBody, callbackRefFieldNames);
  }
  const returnValueNodes: EsTreeNode[] = [];
  walkAst(functionBody, (node) => {
    if (node !== functionBody && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      returnValueNodes.push(node.argument);
    }
  });
  const evidence = combineCallbackRefValueEvidence(returnValueNodes, callbackRefFieldNames);
  return evidence.hasCallbackRefValue && !evidence.hasDynamicValue;
};

const synchronousIteratorResultDerivesFromCallbackRef = (
  node: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const candidate = stripParenExpression(node);
  if (!isNodeOfType(candidate, "CallExpression")) return false;
  const callee = stripParenExpression(candidate.callee);
  if (
    isNodeOfType(callee, "MemberExpression") &&
    getStaticPropertyKeyName(callee, { allowComputedString: true }) === "forEach"
  ) {
    return false;
  }
  return candidate.arguments.some((argument) => {
    if (isNodeOfType(argument, "SpreadElement")) return false;
    const callback = stripParenExpression(argument);
    return (
      isFunctionLike(callback) &&
      isSynchronousIteratorCall(candidate, callback, scopes) &&
      functionReturnsCallbackRefDerivedValue(callback.body, callbackRefFieldNames)
    );
  });
};

const collectReferencedNames = (node: EsTreeNode, into: Set<string>): void => {
  walkAst(node, (descendant) => {
    if (!isNodeOfType(descendant, "Identifier")) return;
    const parent = descendant.parent;
    if (
      isNodeOfType(parent, "MemberExpression") &&
      parent.property === descendant &&
      parent.computed !== true
    ) {
      return;
    }
    if (
      isNodeOfType(parent, "Property") &&
      parent.key === descendant &&
      parent.value !== descendant
    ) {
      return;
    }
    into.add(descendant.name);
  });
};

const expressionCallsPostMountHelper = (
  node: EsTreeNode,
  localFunctions: ReadonlyMap<string, EsTreeNode>,
  callbackRefFieldNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
  visitedFunctionNames: ReadonlySet<string> = new Set(),
): boolean => {
  let didFindPostMountHelper = false;
  walkAst(node, (descendant) => {
    if (didFindPostMountHelper) return false;
    if (
      descendant !== node &&
      isFunctionLike(descendant) &&
      !isImmediatelyInvokedFunction(descendant)
    ) {
      return false;
    }
    if (!isNodeOfType(descendant, "CallExpression")) return;
    const callee = stripParenExpression(descendant.callee);
    if (!isNodeOfType(callee, "Identifier") || visitedFunctionNames.has(callee.name)) return;
    const localFunction = localFunctions.get(callee.name);
    if (!localFunction) return;
    const functionBody = (localFunction as { body?: EsTreeNode }).body;
    if (!functionBody) return;
    const nextVisitedFunctionNames = new Set([...visitedFunctionNames, callee.name]);
    const doesFunctionReadCallbackRefField = containsCallbackRefField(
      functionBody,
      callbackRefFieldNames,
      scopes,
    );
    if (
      (doesFunctionReadCallbackRefField
        ? functionReturnsCallbackRefDerivedValue(functionBody, callbackRefFieldNames)
        : containsPostMountSource(functionBody, scopes)) ||
      expressionCallsPostMountHelper(
        functionBody,
        localFunctions,
        callbackRefFieldNames,
        scopes,
        nextVisitedFunctionNames,
      )
    ) {
      didFindPostMountHelper = true;
      return false;
    }
  });
  return didFindPostMountHelper;
};

// True when the setState argument reads a post-mount-only source directly,
// or references a local declared in the lifecycle body whose initializer
// (transitively) does — `const el = this.ref.current; const z = calc(el);
// this.setState({ z })`.
const argumentDerivesFromPostMountSource = (
  setStateCall: EsTreeNodeOfType<"CallExpression">,
  lifecycleFunction: EsTreeNode,
  callbackRefFieldNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): boolean => {
  const argumentNode = setStateCall.arguments[0];
  if (!argumentNode || isNodeOfType(argumentNode, "SpreadElement")) return false;

  const localInitializers = new Map<string, EsTreeNode>();
  const localFunctions = new Map<string, EsTreeNode>();
  const ambiguousLocalNames = new Set<string>();
  const registerLocalBinding = (name: string, initializer: EsTreeNode): void => {
    if (ambiguousLocalNames.has(name)) return;
    if (localInitializers.has(name)) {
      ambiguousLocalNames.add(name);
      localInitializers.delete(name);
      localFunctions.delete(name);
      return;
    }
    localInitializers.set(name, initializer);
    if (isFunctionLike(stripParenExpression(initializer))) {
      localFunctions.set(name, initializer);
    }
  };
  walkAst(lifecycleFunction, (descendant) => {
    if (
      isNodeOfType(descendant, "VariableDeclarator") &&
      isNodeOfType(descendant.id, "Identifier") &&
      descendant.init
    ) {
      registerLocalBinding(descendant.id.name, descendant.init);
    } else if (
      descendant !== lifecycleFunction &&
      isNodeOfType(descendant, "FunctionDeclaration") &&
      descendant.id
    ) {
      registerLocalBinding(descendant.id.name, descendant);
    }
    if (
      descendant !== lifecycleFunction &&
      isFunctionLike(descendant) &&
      !isImmediatelyInvokedFunction(descendant)
    ) {
      return false;
    }
  });
  const doesExpressionDeriveFromPostMountSource = (expression: EsTreeNode): boolean => {
    const doesExpressionReadCallbackRefField = containsCallbackRefField(
      expression,
      callbackRefFieldNames,
      scopes,
    );
    if (
      (doesExpressionReadCallbackRefField
        ? isCallbackRefDerivedValue(expression, callbackRefFieldNames) ||
          synchronousIteratorResultDerivesFromCallbackRef(expression, callbackRefFieldNames, scopes)
        : containsPostMountSource(expression, scopes)) ||
      expressionCallsPostMountHelper(expression, localFunctions, callbackRefFieldNames, scopes)
    ) {
      return true;
    }
    if (localInitializers.size === 0) return false;
    const reachedNames = new Set<string>();
    collectReferencedNames(expression, reachedNames);
    const pendingNames = [...reachedNames];
    while (pendingNames.length > 0) {
      const name = pendingNames.pop();
      if (name === undefined) break;
      const initializer = localInitializers.get(name);
      if (!initializer) continue;
      if (isFunctionLike(stripParenExpression(initializer))) continue;
      const doesInitializerReadCallbackRefField = containsCallbackRefField(
        initializer,
        callbackRefFieldNames,
        scopes,
      );
      if (
        (doesInitializerReadCallbackRefField
          ? isCallbackRefDerivedValue(initializer, callbackRefFieldNames) ||
            synchronousIteratorResultDerivesFromCallbackRef(
              initializer,
              callbackRefFieldNames,
              scopes,
            )
          : containsPostMountSource(initializer, scopes)) ||
        expressionCallsPostMountHelper(initializer, localFunctions, callbackRefFieldNames, scopes)
      ) {
        return true;
      }
      const referencedNames = new Set<string>();
      collectReferencedNames(initializer, referencedNames);
      for (const referencedName of referencedNames) {
        if (reachedNames.has(referencedName)) continue;
        reachedNames.add(referencedName);
        pendingNames.push(referencedName);
      }
    }
    return false;
  };

  const statePayload = stripParenExpression(argumentNode as EsTreeNode);
  if (!isNodeOfType(statePayload, "ObjectExpression")) {
    return doesExpressionDeriveFromPostMountSource(statePayload);
  }
  if (statePayload.properties.length === 0) return false;
  let hasPostMountValue = false;
  for (const property of statePayload.properties) {
    if (isMountFlagProperty(property)) continue;
    if (
      !isNodeOfType(property, "Property") ||
      property.kind !== "init" ||
      !doesExpressionDeriveFromPostMountSource(property.value as EsTreeNode)
    ) {
      return false;
    }
    hasPostMountValue = true;
  }
  return hasPostMountValue;
};

const isUndefinedOrNull = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return true;
  const value = stripParenExpression(node);
  const voidOperand = isNodeOfType(value, "UnaryExpression")
    ? stripParenExpression(value.argument)
    : null;
  return (
    (isNodeOfType(value, "Identifier") && value.name === "undefined") ||
    (isNodeOfType(value, "Literal") && value.value === null) ||
    (isNodeOfType(value, "UnaryExpression") &&
      value.operator === "void" &&
      isNodeOfType(voidOperand, "Literal") &&
      voidOperand.value === 0)
  );
};

const objectExpressionMayDefineField = (node: EsTreeNode, fieldName: string): boolean => {
  const candidate = stripParenExpression(node);
  if (!isNodeOfType(candidate, "ObjectExpression")) return true;
  return candidate.properties.some((property) => {
    if (!isNodeOfType(property, "Property")) return true;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    return propertyName === null || propertyName === fieldName;
  });
};

const isThisOrAlias = (
  node: EsTreeNode,
  thisAliasNames: ReadonlySet<string>,
  classNode?: EsTreeNode,
): boolean => {
  const candidate = stripParenExpression(node);
  return (
    (isNodeOfType(candidate, "ThisExpression") &&
      (!classNode || findEnclosingClass(candidate) === classNode)) ||
    (isNodeOfType(candidate, "Identifier") && thisAliasNames.has(candidate.name))
  );
};

const callMayWriteThisField = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  fieldName: string,
  receiverKinds: ReadonlyMap<string, "object" | "reflect">,
  thisAliasNames: ReadonlySet<string>,
  classNode: EsTreeNode,
): boolean => {
  const callee = stripParenExpression(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const receiver = stripParenExpression(callee.object as EsTreeNode);
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const receiverKind = receiverKinds.get(receiver.name);
  if (!receiverKind) return false;
  const methodName = getStaticPropertyKeyName(callee, { allowComputedString: true });
  const [target, propertyOrSource, ...remainingArguments] = callExpression.arguments;
  const unwrappedTarget =
    target && !isNodeOfType(target, "SpreadElement")
      ? stripParenExpression(target as EsTreeNode)
      : null;
  if (!unwrappedTarget || !isThisOrAlias(unwrappedTarget, thisAliasNames, classNode)) {
    return false;
  }
  if (receiverKind === "object" && methodName === "assign") {
    const sources = [propertyOrSource, ...remainingArguments];
    return sources.some(
      (source) =>
        !source ||
        isNodeOfType(source, "SpreadElement") ||
        objectExpressionMayDefineField(source as EsTreeNode, fieldName),
    );
  }
  if (receiverKind === "object" && methodName === "defineProperties") {
    return (
      !propertyOrSource ||
      isNodeOfType(propertyOrSource, "SpreadElement") ||
      objectExpressionMayDefineField(propertyOrSource as EsTreeNode, fieldName)
    );
  }
  if (
    (receiverKind === "object" && methodName === "defineProperty") ||
    (receiverKind === "reflect" &&
      (methodName === "defineProperty" || methodName === "deleteProperty" || methodName === "set"))
  ) {
    if (!propertyOrSource || isNodeOfType(propertyOrSource, "SpreadElement")) return true;
    const propertyName = stripParenExpression(propertyOrSource as EsTreeNode);
    return (
      !isNodeOfType(propertyName, "Literal") ||
      typeof propertyName.value !== "string" ||
      propertyName.value === fieldName
    );
  }
  return false;
};

const collectThisAliasNames = (classNode: EsTreeNode): ReadonlySet<string> => {
  const thisAliasNames = new Set<string>();
  let didAddAlias = true;
  while (didAddAlias) {
    didAddAlias = false;
    walkAst(classNode, (node) => {
      if (
        node !== classNode &&
        (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
      ) {
        return false;
      }
      if (
        !isNodeOfType(node, "VariableDeclarator") ||
        !isNodeOfType(node.id, "Identifier") ||
        !node.init
      ) {
        return;
      }
      const initializer = stripParenExpression(node.init);
      if (
        !isNodeOfType(initializer, "ThisExpression") &&
        (!isNodeOfType(initializer, "Identifier") || !thisAliasNames.has(initializer.name))
      ) {
        return;
      }
      if (thisAliasNames.has(node.id.name)) return;
      thisAliasNames.add(node.id.name);
      didAddAlias = true;
    });
  }
  return thisAliasNames;
};

const getEnclosingWriterFunction = (node: EsTreeNode, classNode: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== classNode && !isFunctionLike(ancestor)) {
    ancestor = ancestor.parent;
  }
  return ancestor && ancestor !== classNode ? ancestor : null;
};

const isDirectRefWrapperHandlerUse = (
  node: EsTreeNode,
  wrapperFunction: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const parameters = (wrapperFunction as { params?: EsTreeNode[] }).params ?? [];
  const firstParameter = parameters[0];
  if (!firstParameter) return false;
  const parameterIdentifier = isNodeOfType(firstParameter, "AssignmentPattern")
    ? firstParameter.left
    : firstParameter;
  if (!isNodeOfType(parameterIdentifier, "Identifier")) return false;
  const parameterSymbolId = scopes.symbolFor(parameterIdentifier)?.id;
  if (parameterSymbolId === undefined) return false;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor && ancestor !== wrapperFunction) {
    if (isFunctionLike(ancestor)) return false;
    if (
      isNodeOfType(ancestor, "CallExpression") &&
      isInsideNode(node, ancestor.callee as EsTreeNode)
    ) {
      const [forwardedValue] = ancestor.arguments;
      if (!forwardedValue || isNodeOfType(forwardedValue, "SpreadElement")) return false;
      const unwrappedValue = stripParenExpression(forwardedValue as EsTreeNode);
      return (
        isNodeOfType(unwrappedValue, "Identifier") &&
        scopes.symbolFor(unwrappedValue)?.id === parameterSymbolId
      );
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const isInsideRefAttribute = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let wrapperFunction: EsTreeNode | null = null;
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      if (wrapperFunction) return false;
      wrapperFunction = ancestor;
    }
    if (
      isNodeOfType(ancestor, "JSXAttribute") &&
      isNodeOfType(ancestor.name, "JSXIdentifier") &&
      ancestor.name.name === "ref"
    ) {
      return !wrapperFunction || isDirectRefWrapperHandlerUse(node, wrapperFunction, scopes);
    }
    ancestor = ancestor.parent;
  }
  return false;
};

const getWriterMemberName = (writerFunction: EsTreeNode): string | null => {
  const parent = writerFunction.parent;
  if (
    !parent ||
    (!isNodeOfType(parent, "MethodDefinition") && !isNodeOfType(parent, "PropertyDefinition"))
  ) {
    return null;
  }
  return getStaticPropertyKeyName(parent, { allowComputedString: true });
};

const isInsideNode = (node: EsTreeNode, ancestorNode: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = node;
  while (ancestor) {
    if (ancestor === ancestorNode) return true;
    ancestor = ancestor.parent;
  }
  return false;
};

const getDestructuredThisMemberSymbols = (
  classNode: EsTreeNode,
  memberName: string,
  thisAliasNames: ReadonlySet<string>,
  scopes: ScopeAnalysis,
): readonly SymbolDescriptor[] => {
  const symbols: SymbolDescriptor[] = [];
  walkAst(classNode, (node) => {
    if (
      node !== classNode &&
      (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (
      !isNodeOfType(node, "VariableDeclarator") ||
      !isNodeOfType(node.id, "ObjectPattern") ||
      !node.init ||
      !isThisOrAlias(node.init, thisAliasNames)
    ) {
      return;
    }
    for (const property of node.id.properties) {
      if (
        !isNodeOfType(property, "Property") ||
        getStaticPropertyKeyName(property, { allowComputedString: true }) !== memberName
      ) {
        continue;
      }
      const bindingIdentifier = isNodeOfType(property.value, "AssignmentPattern")
        ? property.value.left
        : property.value;
      if (!isNodeOfType(bindingIdentifier, "Identifier")) continue;
      const symbol = scopes.symbolFor(bindingIdentifier);
      if (symbol) symbols.push(symbol);
    }
  });
  return symbols;
};

const hasExclusiveCallbackRefFieldWrite = (
  classNode: EsTreeNode,
  fieldName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (fieldName.startsWith("#")) return false;
  const receiverKinds = collectMutationReceiverKinds(classNode);
  const thisAliasNames = collectThisAliasNames(classNode);
  const writerFunctions = new Set<EsTreeNode>();
  let didFindUnsafeWrite = false;
  walkAst(classNode, (node) => {
    if (
      isNodeOfType(node, "PropertyDefinition") &&
      findEnclosingClass(node) === classNode &&
      node.static !== true &&
      getStaticPropertyKeyName(node, { allowComputedString: true }) === fieldName &&
      !isUndefinedOrNull(node.value as EsTreeNode | null | undefined)
    ) {
      didFindUnsafeWrite = true;
      return false;
    }
    if (
      isNodeOfType(node, "CallExpression") &&
      callMayWriteThisField(node, fieldName, receiverKinds, thisAliasNames, classNode)
    ) {
      const writerFunction = getEnclosingWriterFunction(node, classNode);
      if (!writerFunction) {
        didFindUnsafeWrite = true;
        return false;
      }
      writerFunctions.add(writerFunction);
      return;
    }
    const assignmentTarget =
      (isNodeOfType(node, "AssignmentExpression") && (node.left as EsTreeNode)) ||
      (isNodeOfType(node, "UpdateExpression") && (node.argument as EsTreeNode)) ||
      (isNodeOfType(node, "UnaryExpression") &&
        node.operator === "delete" &&
        (node.argument as EsTreeNode)) ||
      null;
    if (!assignmentTarget) return;
    const unwrappedAssignmentTarget = stripParenExpression(assignmentTarget);
    if (
      !isNodeOfType(unwrappedAssignmentTarget, "MemberExpression") ||
      !isThisOrAlias(unwrappedAssignmentTarget.object as EsTreeNode, thisAliasNames, classNode)
    ) {
      return;
    }
    const assignmentFieldName = getStaticPropertyKeyName(unwrappedAssignmentTarget, {
      allowComputedString: true,
    });
    if (!assignmentFieldName) {
      didFindUnsafeWrite = true;
      return false;
    }
    if (assignmentFieldName !== fieldName) return;
    const writerFunction = getEnclosingWriterFunction(node, classNode);
    if (!writerFunction) {
      didFindUnsafeWrite = true;
      return false;
    }
    writerFunctions.add(writerFunction);
  });
  if (didFindUnsafeWrite || writerFunctions.size !== 1) return false;
  const [writerFunction] = writerFunctions;
  if (!writerFunction) return false;
  const writerMemberName = getWriterMemberName(writerFunction);
  if (!writerMemberName) return true;
  let didFindNonRefUsage = false;
  walkAst(classNode, (node) => {
    if (
      node !== classNode &&
      (isNodeOfType(node, "ClassDeclaration") || isNodeOfType(node, "ClassExpression"))
    ) {
      return false;
    }
    if (
      getStaticThisOrAliasFieldName(node, thisAliasNames, classNode) === writerMemberName &&
      !isInsideRefAttribute(node, scopes)
    ) {
      didFindNonRefUsage = true;
      return false;
    }
  });
  if (didFindNonRefUsage) return false;
  const destructuredHandlerSymbols = getDestructuredThisMemberSymbols(
    classNode,
    writerMemberName,
    thisAliasNames,
    scopes,
  );
  if (
    destructuredHandlerSymbols.some((symbol) =>
      symbol.references.some(
        (reference) =>
          !isInsideNode(reference.identifier, symbol.declarationNode) &&
          !isInsideRefAttribute(reference.identifier, scopes),
      ),
    )
  ) {
    return false;
  }
  return true;
};

// A setState after an `await` in an async componentDidMount is the
// promise-buried case: the continuation runs as a microtask callback, the
// same shape as `.then(() => this.setState(...))`, which the default
// "allowed" mode documents as NOT firing.
const isAfterAwaitInAsyncLifecycle = (
  setStateCall: EsTreeNode,
  lifecycleFunction: EsTreeNode,
): boolean => {
  if (!isFunctionLike(lifecycleFunction) || lifecycleFunction.async !== true) return false;
  const callStart = getNodeStartIndex(setStateCall);
  if (callStart < 0) return false;
  let didFindPrecedingAwait = false;
  walkAst(lifecycleFunction, (descendant) => {
    if (didFindPrecedingAwait) return false;
    if (!isNodeOfType(descendant, "AwaitExpression")) return;
    const awaitStart = getNodeStartIndex(descendant);
    if (awaitStart >= 0 && awaitStart < callStart) {
      didFindPrecedingAwait = true;
      return false;
    }
  });
  return didFindPrecedingAwait;
};

interface NoDidMountSetStateSettings {
  mode?: "allowed" | "disallow-in-func";
}

const resolveSettings = (
  settings: Readonly<Record<string, unknown>> | undefined,
): Required<NoDidMountSetStateSettings> => {
  const reactDoctor = settings?.["react-doctor"];
  const ruleSettings =
    typeof reactDoctor === "object" && reactDoctor !== null
      ? ((reactDoctor as { noDidMountSetState?: NoDidMountSetStateSettings }).noDidMountSetState ??
        {})
      : {};
  return { mode: ruleSettings.mode ?? "allowed" };
};

// Port of `oxc_linter::rules::react::no_did_mount_set_state`. Flags
// `this.setState(...)` directly inside a `componentDidMount` lifecycle
// (default), or inside any nested function within `componentDidMount`
// when `mode: "disallow-in-func"`.
export const noDidMountSetState = defineRule({
  id: "no-did-mount-set-state",
  title: "setState in componentDidMount",
  severity: "warn",
  recommendation:
    "Setting state in `componentDidMount` triggers an extra render. Use `getDerivedStateFromProps` or initial state instead.",
  create: (context) => {
    const { mode } = resolveSettings(context.settings);
    return {
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(stripParenExpression(node.callee.object), "ThisExpression")) return;
        if (
          !isNodeOfType(node.callee.property, "Identifier") ||
          node.callee.property.name !== "setState"
        ) {
          return;
        }
        const shouldFlag = isSetStateCallInLifecycle(node, LIFECYCLE_NAMES, {
          disallowInNestedFunctions: mode === "disallow-in-func",
        });
        if (!shouldFlag) return;
        const lifecycleFunction = getEnclosingLifecycleFunction(node);
        if (
          lifecycleFunction &&
          mode === "disallow-in-func" &&
          isInsideNestedLifecycleFunction(node, lifecycleFunction)
        ) {
          context.report({ node: node.callee, message: MESSAGE });
          return;
        }
        if (isMountFlagArgument(node.arguments?.[0])) return;
        if (lifecycleFunction) {
          if (isAfterAwaitInAsyncLifecycle(node, lifecycleFunction)) return;
          const enclosingClass = findEnclosingClass(lifecycleFunction);
          const callbackRefFieldNames = getCallbackRefFieldNames(enclosingClass, context.scopes);
          const exclusivelyRefOwnedFieldNames = enclosingClass
            ? new Set(
                [...callbackRefFieldNames].filter((fieldName) =>
                  hasExclusiveCallbackRefFieldWrite(enclosingClass, fieldName, context.scopes),
                ),
              )
            : new Set<string>();
          if (
            argumentDerivesFromPostMountSource(
              node,
              lifecycleFunction,
              exclusivelyRefOwnedFieldNames,
              context.scopes,
            )
          ) {
            return;
          }
        }
        context.report({ node: node.callee, message: MESSAGE });
      },
    };
  },
});
