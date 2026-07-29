import ts from "typescript";
import {
  REACT_HOST_CONTROL_EVENT_PARAMETER_INDEX,
  REACT_HOST_CONTROL_SETTER_ARGUMENT_INDEX,
  REACT_HOST_CONTROL_STATE_INDEX,
} from "./constants.js";
import { collectHookBindings } from "./collect-hook-bindings.js";
import { collectReachableFunctions } from "./collect-reachable-functions.js";
import { getCanonicalReactApiName } from "./get-canonical-react-api-name.js";
import { getStaticBooleanValue } from "./get-static-boolean-value.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { isIdentifierReference } from "./is-identifier-reference.js";
import { resolveCallableExpression } from "./resolve-callable-expression.js";
import {
  ReactHostControlKind,
  ReactHostControlMutabilityStatus,
  ReactHostControlStatus,
  ReactHostControlUpdateStatus,
  ReactHostControlValueStatus,
} from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import { collectJsxSpreadProperties } from "./utils/collect-jsx-spread-properties.js";
import { getEnclosingFunction } from "./utils/get-enclosing-function.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { isEntryDominatingNode } from "./utils/is-entry-dominating-node.js";
import type { ReactAnalysisContext } from "./types.js";

export interface HostControlProtocolDescriptor {
  callbackSourceNode: ts.JsxAttributeLike | null;
  controlledPropName: string;
  controlledPropPresent: boolean | null;
  defaultPropName: string;
  defaultPropPresent: boolean | null;
  kind: ReactHostControlKind;
  mutabilityStatus: ReactHostControlMutabilityStatus;
  node: ts.JsxOpeningLikeElement;
  setterCallExpressions: ReadonlyArray<ts.CallExpression>;
  setterName: string | null;
  sourceComplete: boolean;
  stateName: string | null;
  status: ReactHostControlStatus;
  updateStatus: ReactHostControlUpdateStatus;
  valueStatus: ReactHostControlValueStatus;
}

interface HostControlPropertyResolution {
  expression: ts.Expression | null;
  isPresent: boolean | null;
  sourceNode: ts.JsxAttributeLike | null;
}

interface HostControlStateBinding {
  setterSymbol: ts.Symbol;
  stateSymbol: ts.Symbol;
}

interface HostControlUpdateAnalysis {
  setterCallExpressions: ReadonlyArray<ts.CallExpression>;
  status: ReactHostControlUpdateStatus;
}

const NON_EDITABLE_INPUT_TYPES = new Set(["button", "hidden", "image", "reset", "submit"]);

const getJsxAttributeExpression = (attribute: ts.JsxAttribute): ts.Expression | null => {
  if (!attribute.initializer) return null;
  if (ts.isStringLiteral(attribute.initializer)) return attribute.initializer;
  return ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression
    ? attribute.initializer.expression
    : null;
};

const resolveHostControlProperty = (
  openingElement: ts.JsxOpeningLikeElement,
  propertyName: string,
  typeChecker: ts.TypeChecker,
): HostControlPropertyResolution => {
  let resolution: HostControlPropertyResolution = {
    expression: null,
    isPresent: false,
    sourceNode: null,
  };
  for (const attribute of openingElement.attributes.properties) {
    if (ts.isJsxAttribute(attribute)) {
      if (attribute.name.getText() === propertyName) {
        resolution = {
          expression: getJsxAttributeExpression(attribute),
          isPresent: true,
          sourceNode: attribute,
        };
      }
      continue;
    }
    const spreadProperties = collectJsxSpreadProperties(attribute.expression, typeChecker);
    if (
      spreadProperties.hasUnknownProperties ||
      spreadProperties.propertyNames.includes(propertyName)
    ) {
      resolution = {
        expression: null,
        isPresent: null,
        sourceNode: attribute,
      };
    }
  }
  return resolution;
};

const getStaticStringValue = (resolution: HostControlPropertyResolution): string | null => {
  if (resolution.isPresent === false) return "";
  const expression = resolution.expression
    ? unwrapTypescriptExpression(resolution.expression)
    : null;
  return expression && ts.isStringLiteralLike(expression) ? expression.text : null;
};

const getStaticBooleanPropertyValue = (
  resolution: HostControlPropertyResolution,
): boolean | null => {
  if (resolution.isPresent === false) return false;
  if (resolution.isPresent === null) return null;
  if (!resolution.expression) return true;
  return getStaticBooleanValue(resolution.expression);
};

const getInputKind = (
  typeResolution: HostControlPropertyResolution,
): ReactHostControlKind | null => {
  const inputType = getStaticStringValue(typeResolution);
  if (inputType === null) return ReactHostControlKind.Unknown;
  const normalizedInputType = inputType.toLowerCase() || "text";
  if (NON_EDITABLE_INPUT_TYPES.has(normalizedInputType)) return null;
  if (normalizedInputType === "checkbox" || normalizedInputType === "radio") {
    return ReactHostControlKind.CheckableInput;
  }
  if (normalizedInputType === "file") return ReactHostControlKind.FileInput;
  return ReactHostControlKind.TextInput;
};

const getHostControlKind = (
  openingElement: ts.JsxOpeningLikeElement,
  typeChecker: ts.TypeChecker,
): ReactHostControlKind | null => {
  if (!ts.isIdentifier(openingElement.tagName)) return null;
  if (openingElement.tagName.text === "input") {
    return getInputKind(resolveHostControlProperty(openingElement, "type", typeChecker));
  }
  if (openingElement.tagName.text === "textarea") return ReactHostControlKind.Textarea;
  if (openingElement.tagName.text !== "select") return null;
  const multipleResolution = resolveHostControlProperty(openingElement, "multiple", typeChecker);
  const multipleValue = getStaticBooleanPropertyValue(multipleResolution);
  if (multipleValue === null) return ReactHostControlKind.Unknown;
  return multipleValue ? ReactHostControlKind.SelectMultiple : ReactHostControlKind.Select;
};

const getControlPropertyNames = (
  kind: ReactHostControlKind,
): { controlledPropName: string; defaultPropName: string; eventValueName: string } => {
  if (kind === ReactHostControlKind.CheckableInput) {
    return {
      controlledPropName: "checked",
      defaultPropName: "defaultChecked",
      eventValueName: "checked",
    };
  }
  return {
    controlledPropName: "value",
    defaultPropName: "defaultValue",
    eventValueName: "value",
  };
};

const getTypeValueStatus = (
  valueType: ts.Type,
  typeChecker: ts.TypeChecker,
): ReactHostControlValueStatus => {
  if (
    valueType.flags &
    (ts.TypeFlags.Any | ts.TypeFlags.Unknown | ts.TypeFlags.Never | ts.TypeFlags.TypeParameter)
  ) {
    if (valueType.flags & ts.TypeFlags.TypeParameter) {
      const constraint = typeChecker.getBaseConstraintOfType(valueType);
      return constraint
        ? getTypeValueStatus(constraint, typeChecker)
        : ReactHostControlValueStatus.Unknown;
    }
    return ReactHostControlValueStatus.Unknown;
  }
  if (valueType.isUnion()) {
    const memberStatuses = new Set(
      valueType.types.map((memberType) => getTypeValueStatus(memberType, typeChecker)),
    );
    if (memberStatuses.size === 1 && memberStatuses.has(ReactHostControlValueStatus.Defined)) {
      return ReactHostControlValueStatus.Defined;
    }
    if (memberStatuses.size === 1 && memberStatuses.has(ReactHostControlValueStatus.Nullish)) {
      return ReactHostControlValueStatus.Nullish;
    }
    return ReactHostControlValueStatus.Unknown;
  }
  return valueType.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)
    ? ReactHostControlValueStatus.Nullish
    : ReactHostControlValueStatus.Defined;
};

const getExpressionValueStatus = (
  expression: ts.Expression,
  typeChecker: ts.TypeChecker,
): ReactHostControlValueStatus => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    unwrappedExpression.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(unwrappedExpression)
  ) {
    return ReactHostControlValueStatus.Nullish;
  }
  if (
    ts.isStringLiteralLike(unwrappedExpression) ||
    ts.isNumericLiteral(unwrappedExpression) ||
    ts.isBigIntLiteral(unwrappedExpression) ||
    ts.isRegularExpressionLiteral(unwrappedExpression) ||
    ts.isNoSubstitutionTemplateLiteral(unwrappedExpression) ||
    ts.isArrayLiteralExpression(unwrappedExpression) ||
    ts.isObjectLiteralExpression(unwrappedExpression) ||
    ts.isArrowFunction(unwrappedExpression) ||
    ts.isFunctionExpression(unwrappedExpression) ||
    ts.isClassExpression(unwrappedExpression) ||
    ts.isNewExpression(unwrappedExpression) ||
    unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword ||
    unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword
  ) {
    return ReactHostControlValueStatus.Defined;
  }
  if (
    ts.isBinaryExpression(unwrappedExpression) &&
    unwrappedExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
    getExpressionValueStatus(unwrappedExpression.right, typeChecker) ===
      ReactHostControlValueStatus.Defined
  ) {
    return ReactHostControlValueStatus.Defined;
  }
  return getTypeValueStatus(typeChecker.getTypeAtLocation(unwrappedExpression), typeChecker);
};

const getStateBinding = (
  expression: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): HostControlStateBinding | null => {
  const getExpressionStateSymbol = (candidateExpression: ts.Expression): ts.Symbol | null => {
    const unwrappedExpression = unwrapTypescriptExpression(candidateExpression);
    if (ts.isIdentifier(unwrappedExpression)) {
      return getResolvedSymbol(unwrappedExpression, context.typeChecker);
    }
    if (
      ts.isBinaryExpression(unwrappedExpression) &&
      unwrappedExpression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken &&
      getExpressionValueStatus(unwrappedExpression.right, context.typeChecker) ===
        ReactHostControlValueStatus.Defined
    ) {
      return getExpressionStateSymbol(unwrappedExpression.left);
    }
    return null;
  };
  const stateSymbol = getExpressionStateSymbol(expression);
  if (!stateSymbol) return null;
  const hookBindings = collectHookBindings(functionNode, context.typeChecker);
  for (const [setterSymbol, candidateStateSymbol] of hookBindings.stateValueBySetter) {
    if (candidateStateSymbol === stateSymbol) return { setterSymbol, stateSymbol };
  }
  return null;
};

const getStateInitializer = (
  stateSymbol: ts.Symbol,
  context: ReactAnalysisContext,
): ts.Expression | null | undefined => {
  for (const declaration of stateSymbol.declarations ?? []) {
    if (!ts.isBindingElement(declaration) || !ts.isArrayBindingPattern(declaration.parent)) {
      continue;
    }
    const variableDeclaration = declaration.parent.parent;
    if (
      !ts.isVariableDeclaration(variableDeclaration) ||
      !variableDeclaration.initializer ||
      !ts.isCallExpression(variableDeclaration.initializer) ||
      getCanonicalReactApiName(variableDeclaration.initializer.expression, context.typeChecker) !==
        "useState" ||
      declaration.parent.elements[REACT_HOST_CONTROL_STATE_INDEX] !== declaration
    ) {
      continue;
    }
    const initializer = variableDeclaration.initializer.arguments[REACT_HOST_CONTROL_STATE_INDEX];
    if (!initializer) return null;
    const unwrappedInitializer = unwrapTypescriptExpression(initializer);
    if (ts.isArrowFunction(unwrappedInitializer) || ts.isFunctionExpression(unwrappedInitializer)) {
      return ts.isBlock(unwrappedInitializer.body) ? undefined : unwrappedInitializer.body;
    }
    return initializer;
  }
  return undefined;
};

const collectSetterValueStatuses = (
  functionNode: ts.FunctionLikeDeclaration,
  setterSymbol: ts.Symbol,
  context: ReactAnalysisContext,
): {
  hasEscape: boolean;
  statuses: ReadonlyArray<ReactHostControlValueStatus>;
} => {
  const statuses: ReactHostControlValueStatus[] = [];
  let hasEscape = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isIdentifierReference(node) &&
      getResolvedSymbol(node, context.typeChecker) === setterSymbol
    ) {
      const callExpression =
        ts.isCallExpression(node.parent) &&
        unwrapTypescriptExpression(node.parent.expression) === node
          ? node.parent
          : null;
      if (!callExpression) {
        hasEscape = true;
      } else {
        const argument = callExpression.arguments[REACT_HOST_CONTROL_SETTER_ARGUMENT_INDEX] ?? null;
        if (
          !argument ||
          ts.isArrowFunction(unwrapTypescriptExpression(argument)) ||
          ts.isFunctionExpression(unwrapTypescriptExpression(argument))
        ) {
          statuses.push(ReactHostControlValueStatus.Unknown);
        } else {
          statuses.push(getExpressionValueStatus(argument, context.typeChecker));
        }
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return { hasEscape, statuses };
};

const getStateValueStatus = (
  binding: HostControlStateBinding,
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactHostControlValueStatus => {
  const initializer = getStateInitializer(binding.stateSymbol, context);
  let initializerStatus = ReactHostControlValueStatus.Unknown;
  if (initializer === null) {
    initializerStatus = ReactHostControlValueStatus.Nullish;
  } else if (initializer) {
    initializerStatus = getExpressionValueStatus(initializer, context.typeChecker);
  }
  const setterValues = collectSetterValueStatuses(functionNode, binding.setterSymbol, context);
  const statuses = new Set([initializerStatus, ...setterValues.statuses]);
  if (
    statuses.has(ReactHostControlValueStatus.Defined) &&
    statuses.has(ReactHostControlValueStatus.Nullish)
  ) {
    return ReactHostControlValueStatus.MaySwitch;
  }
  if (setterValues.hasEscape || statuses.has(ReactHostControlValueStatus.Unknown)) {
    return ReactHostControlValueStatus.Unknown;
  }
  return statuses.has(ReactHostControlValueStatus.Defined)
    ? ReactHostControlValueStatus.Defined
    : ReactHostControlValueStatus.Nullish;
};

const isExactEventValueExpression = (
  expression: ts.Expression,
  callbackFunction: ts.FunctionLikeDeclaration,
  eventValueName: string,
  typeChecker: ts.TypeChecker,
): boolean => {
  const eventParameter = callbackFunction.parameters[REACT_HOST_CONTROL_EVENT_PARAMETER_INDEX];
  if (!eventParameter || !ts.isIdentifier(eventParameter.name)) return false;
  const eventSymbol = getResolvedSymbol(eventParameter.name, typeChecker);
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    !eventSymbol ||
    !ts.isPropertyAccessExpression(unwrappedExpression) ||
    unwrappedExpression.name.text !== eventValueName
  ) {
    return false;
  }
  const eventTarget = unwrapTypescriptExpression(unwrappedExpression.expression);
  if (
    !ts.isPropertyAccessExpression(eventTarget) ||
    (eventTarget.name.text !== "target" && eventTarget.name.text !== "currentTarget")
  ) {
    return false;
  }
  const eventIdentifier = unwrapTypescriptExpression(eventTarget.expression);
  return (
    ts.isIdentifier(eventIdentifier) &&
    getResolvedSymbol(eventIdentifier, typeChecker) === eventSymbol
  );
};

const analyzeCallbackUpdate = (
  callbackFunction: ts.FunctionLikeDeclaration,
  setterSymbol: ts.Symbol,
  eventValueName: string,
  context: ReactAnalysisContext,
): HostControlUpdateAnalysis => {
  const directSetterCalls: ts.CallExpression[] = [];
  const deferredSetterCalls: ts.CallExpression[] = [];
  let hasOpaqueSetterReference = false;
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      isIdentifierReference(node) &&
      getResolvedSymbol(node, context.typeChecker) === setterSymbol
    ) {
      const callExpression =
        ts.isCallExpression(node.parent) &&
        unwrapTypescriptExpression(node.parent.expression) === node
          ? node.parent
          : null;
      if (!callExpression) {
        hasOpaqueSetterReference = true;
      } else if (getEnclosingFunction(callExpression) === callbackFunction) {
        directSetterCalls.push(callExpression);
      } else {
        deferredSetterCalls.push(callExpression);
      }
    }
    node.forEachChild(visit);
  };
  callbackFunction.forEachChild(visit);
  if (directSetterCalls.length > 0) {
    const hasConditionalCall = directSetterCalls.some(
      (callExpression) => !isEntryDominatingNode(callExpression, callbackFunction),
    );
    if (hasConditionalCall) {
      return {
        setterCallExpressions: directSetterCalls,
        status: ReactHostControlUpdateStatus.Conditional,
      };
    }
    const hasWrongValue = directSetterCalls.some((callExpression) => {
      const argument = callExpression.arguments[REACT_HOST_CONTROL_SETTER_ARGUMENT_INDEX] ?? null;
      return (
        !argument ||
        !isExactEventValueExpression(
          argument,
          callbackFunction,
          eventValueName,
          context.typeChecker,
        )
      );
    });
    return {
      setterCallExpressions: directSetterCalls,
      status: hasWrongValue
        ? ReactHostControlUpdateStatus.WrongValue
        : ReactHostControlUpdateStatus.Exact,
    };
  }
  if (deferredSetterCalls.length > 0) {
    return {
      setterCallExpressions: deferredSetterCalls,
      status: ReactHostControlUpdateStatus.Deferred,
    };
  }
  return {
    setterCallExpressions: [],
    status: hasOpaqueSetterReference
      ? ReactHostControlUpdateStatus.Opaque
      : ReactHostControlUpdateStatus.Missing,
  };
};

const combineUpdateAnalyses = (
  analyses: ReadonlyArray<HostControlUpdateAnalysis>,
): HostControlUpdateAnalysis => {
  const setterCallExpressions = analyses.flatMap((analysis) => analysis.setterCallExpressions);
  const priority = [
    ReactHostControlUpdateStatus.WrongValue,
    ReactHostControlUpdateStatus.Deferred,
    ReactHostControlUpdateStatus.Conditional,
    ReactHostControlUpdateStatus.Missing,
    ReactHostControlUpdateStatus.Opaque,
  ];
  const firstFailure = priority.find((status) =>
    analyses.some((analysis) => analysis.status === status),
  );
  return {
    setterCallExpressions,
    status: firstFailure ?? ReactHostControlUpdateStatus.Exact,
  };
};

const getUpdateAnalysis = (
  onChangeResolution: HostControlPropertyResolution,
  stateBinding: HostControlStateBinding | null,
  mutabilityStatus: ReactHostControlMutabilityStatus,
  eventValueName: string,
  context: ReactAnalysisContext,
): HostControlUpdateAnalysis => {
  if (mutabilityStatus === ReactHostControlMutabilityStatus.Immutable) {
    return {
      setterCallExpressions: [],
      status: ReactHostControlUpdateStatus.NotRequired,
    };
  }
  if (onChangeResolution.isPresent === false) {
    return {
      setterCallExpressions: [],
      status:
        mutabilityStatus === ReactHostControlMutabilityStatus.Unknown
          ? ReactHostControlUpdateStatus.Opaque
          : ReactHostControlUpdateStatus.Missing,
    };
  }
  if (!stateBinding || !onChangeResolution.expression) {
    return {
      setterCallExpressions: [],
      status: ReactHostControlUpdateStatus.Opaque,
    };
  }
  const callableValue = resolveCallableExpression(
    onChangeResolution.expression,
    context.typeChecker,
  );
  if (!callableValue.isComplete || callableValue.targets.length === 0) {
    return {
      setterCallExpressions: [],
      status: ReactHostControlUpdateStatus.Opaque,
    };
  }
  return combineUpdateAnalyses(
    callableValue.targets.map((target) =>
      analyzeCallbackUpdate(
        target.functionNode,
        stateBinding.setterSymbol,
        eventValueName,
        context,
      ),
    ),
  );
};

const getMutabilityStatus = (
  kind: ReactHostControlKind,
  readOnlyResolution: HostControlPropertyResolution,
  disabledResolution: HostControlPropertyResolution,
): ReactHostControlMutabilityStatus => {
  const readOnly =
    kind === ReactHostControlKind.Select || kind === ReactHostControlKind.SelectMultiple
      ? false
      : getStaticBooleanPropertyValue(readOnlyResolution);
  const disabled = getStaticBooleanPropertyValue(disabledResolution);
  if (readOnly || disabled) return ReactHostControlMutabilityStatus.Immutable;
  if (readOnly === null || disabled === null) return ReactHostControlMutabilityStatus.Unknown;
  return ReactHostControlMutabilityStatus.Editable;
};

const getProtocolStatus = (
  kind: ReactHostControlKind,
  controlledPropPresent: boolean | null,
  defaultPropPresent: boolean | null,
  valueStatus: ReactHostControlValueStatus,
  mutabilityStatus: ReactHostControlMutabilityStatus,
  updateStatus: ReactHostControlUpdateStatus,
): ReactHostControlStatus => {
  if (
    kind === ReactHostControlKind.Unknown ||
    controlledPropPresent === null ||
    defaultPropPresent === null ||
    (controlledPropPresent &&
      (kind === ReactHostControlKind.FileInput || kind === ReactHostControlKind.SelectMultiple))
  ) {
    return ReactHostControlStatus.Unknown;
  }
  if (
    (controlledPropPresent && defaultPropPresent) ||
    valueStatus === ReactHostControlValueStatus.MaySwitch ||
    valueStatus === ReactHostControlValueStatus.Nullish
  ) {
    return ReactHostControlStatus.Invalid;
  }
  if (
    valueStatus === ReactHostControlValueStatus.Unknown ||
    updateStatus === ReactHostControlUpdateStatus.Opaque ||
    (controlledPropPresent &&
      mutabilityStatus === ReactHostControlMutabilityStatus.Unknown &&
      updateStatus !== ReactHostControlUpdateStatus.Exact)
  ) {
    return ReactHostControlStatus.Unknown;
  }
  if (
    updateStatus === ReactHostControlUpdateStatus.Conditional ||
    updateStatus === ReactHostControlUpdateStatus.Deferred ||
    updateStatus === ReactHostControlUpdateStatus.Missing ||
    updateStatus === ReactHostControlUpdateStatus.WrongValue
  ) {
    return ReactHostControlStatus.Invalid;
  }
  return ReactHostControlStatus.Resolved;
};

export const collectHostControlProtocols = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReadonlyArray<HostControlProtocolDescriptor> => {
  const protocols = new Map<string, HostControlProtocolDescriptor>();
  for (const reachableFunction of collectReachableFunctions(functionNode, context.typeChecker)) {
    const visit = (node: ts.Node): void => {
      if (node !== reachableFunction.functionNode && isFunctionBoundary(node)) return;
      if (!ts.isJsxOpeningElement(node) && !ts.isJsxSelfClosingElement(node)) {
        node.forEachChild(visit);
        return;
      }
      const kind = getHostControlKind(node, context.typeChecker);
      if (!kind) {
        node.forEachChild(visit);
        return;
      }
      const propertyNames = getControlPropertyNames(kind);
      const controlledResolution = resolveHostControlProperty(
        node,
        propertyNames.controlledPropName,
        context.typeChecker,
      );
      const defaultResolution = resolveHostControlProperty(
        node,
        propertyNames.defaultPropName,
        context.typeChecker,
      );
      const onChangeResolution = resolveHostControlProperty(node, "onChange", context.typeChecker);
      const readOnlyResolution = resolveHostControlProperty(node, "readOnly", context.typeChecker);
      const disabledResolution = resolveHostControlProperty(node, "disabled", context.typeChecker);
      const stateBinding =
        controlledResolution.expression && controlledResolution.isPresent
          ? getStateBinding(controlledResolution.expression, functionNode, context)
          : null;
      let valueStatus = ReactHostControlValueStatus.Absent;
      if (controlledResolution.isPresent === null) {
        valueStatus = ReactHostControlValueStatus.Unknown;
      } else if (controlledResolution.isPresent) {
        valueStatus = controlledResolution.expression
          ? getExpressionValueStatus(controlledResolution.expression, context.typeChecker)
          : ReactHostControlValueStatus.Defined;
        if (valueStatus === ReactHostControlValueStatus.Unknown && stateBinding) {
          valueStatus = getStateValueStatus(stateBinding, functionNode, context);
        }
      }
      const mutabilityStatus = getMutabilityStatus(kind, readOnlyResolution, disabledResolution);
      let updateAnalysis: HostControlUpdateAnalysis = {
        setterCallExpressions: [],
        status: ReactHostControlUpdateStatus.NotRequired,
      };
      if (
        controlledResolution.isPresent &&
        (kind === ReactHostControlKind.FileInput || kind === ReactHostControlKind.SelectMultiple) &&
        mutabilityStatus !== ReactHostControlMutabilityStatus.Immutable
      ) {
        updateAnalysis = {
          setterCallExpressions: [],
          status: ReactHostControlUpdateStatus.Opaque,
        };
      } else if (controlledResolution.isPresent) {
        updateAnalysis = getUpdateAnalysis(
          onChangeResolution,
          stateBinding,
          mutabilityStatus,
          propertyNames.eventValueName,
          context,
        );
      }
      const status = getProtocolStatus(
        kind,
        controlledResolution.isPresent,
        defaultResolution.isPresent,
        valueStatus,
        mutabilityStatus,
        updateAnalysis.status,
      );
      const sourceComplete =
        status !== ReactHostControlStatus.Unknown &&
        valueStatus !== ReactHostControlValueStatus.Unknown &&
        updateAnalysis.status !== ReactHostControlUpdateStatus.Opaque;
      protocols.set(`${node.getSourceFile().fileName}:${node.getStart()}`, {
        callbackSourceNode: onChangeResolution.sourceNode,
        controlledPropName: propertyNames.controlledPropName,
        controlledPropPresent: controlledResolution.isPresent,
        defaultPropName: propertyNames.defaultPropName,
        defaultPropPresent: defaultResolution.isPresent,
        kind,
        mutabilityStatus,
        node,
        setterCallExpressions: updateAnalysis.setterCallExpressions,
        setterName: stateBinding?.setterSymbol.getName() ?? null,
        sourceComplete,
        stateName: stateBinding?.stateSymbol.getName() ?? null,
        status,
        updateStatus: updateAnalysis.status,
        valueStatus,
      });
      node.forEachChild(visit);
    };
    reachableFunction.functionNode.forEachChild(visit);
  }
  return [...protocols.values()];
};
