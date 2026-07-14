import { CREATE_REF_PROP_FLOW_MAX_DEPTH } from "../../constants/thresholds.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import {
  getImportBindingForName,
  getImportedNameFromModule,
  isImportedFromModule,
} from "../../utils/find-import-source-for-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  resolveCrossFileValueExportWithFilePath,
  type ResolvedCrossFileValueExport,
} from "../../utils/resolve-cross-file-function-export.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface AnalysisEnvironment {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

interface SymbolValuePath {
  readonly environment: AnalysisEnvironment;
  readonly propertyPath: ReadonlyArray<string>;
  readonly symbol: SymbolDescriptor;
}

interface MemberAccess {
  readonly expression: EsTreeNode;
  readonly propertyPath: ReadonlyArray<string>;
}

interface ResolvedFunctionValue {
  readonly environment: AnalysisEnvironment;
  readonly functionNode: EsTreeNode;
  readonly isForwardRef: boolean;
}

interface AnalysisState {
  readonly activePaths: Set<string>;
  readonly environmentsByProgram: WeakMap<EsTreeNode, AnalysisEnvironment>;
}

const pathStartsWith = (
  propertyPath: ReadonlyArray<string>,
  prefix: ReadonlyArray<string>,
): boolean => prefix.every((propertyName, index) => propertyPath[index] === propertyName);

const pathsOverlap = (
  firstPath: ReadonlyArray<string>,
  secondPath: ReadonlyArray<string>,
): boolean => pathStartsWith(firstPath, secondPath) || pathStartsWith(secondPath, firstPath);

const isClosedNoopFunction = (node: EsTreeNode): boolean =>
  isFunctionLike(node) && isNodeOfType(node.body, "BlockStatement") && node.body.body.length === 0;

const isProvenReactCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  expectedName: string,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(callExpression.callee, "Identifier")) {
    const symbol = scopes.symbolFor(callExpression.callee);
    return Boolean(
      symbol?.kind === "import" &&
      getImportedNameFromModule(callExpression.callee, callExpression.callee.name, "react") ===
        expectedName,
    );
  }
  if (!isNodeOfType(callExpression.callee, "MemberExpression")) return false;
  const propertyName = getStaticPropertyName(callExpression.callee);
  if (propertyName !== expectedName) return false;
  const receiver = callExpression.callee.object;
  if (!isNodeOfType(receiver, "Identifier")) return false;
  const symbol = scopes.symbolFor(receiver);
  return Boolean(
    symbol?.kind === "import" && isImportedFromModule(receiver, receiver.name, "react"),
  );
};

const objectHasOnlyClosedNoopFunctions = (
  objectExpression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  if (!isNodeOfType(objectExpression, "ObjectExpression")) return false;
  return objectExpression.properties.every((property) => {
    if (isNodeOfType(property, "SpreadElement")) {
      const spreadArgument = findTransparentExpressionRoot(property.argument);
      if (isNodeOfType(spreadArgument, "ObjectExpression")) {
        return objectHasOnlyClosedNoopFunctions(spreadArgument, scopes, visitedSymbolIds);
      }
      if (!isNodeOfType(spreadArgument, "Identifier")) return false;
      const symbol = scopes.symbolFor(spreadArgument);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        visitedSymbolIds.has(symbol.id) ||
        !isNodeOfType(symbol.initializer, "ObjectExpression")
      ) {
        return false;
      }
      visitedSymbolIds.add(symbol.id);
      const isClosed = objectHasOnlyClosedNoopFunctions(
        symbol.initializer,
        scopes,
        visitedSymbolIds,
      );
      visitedSymbolIds.delete(symbol.id);
      return isClosed;
    }
    if (!isNodeOfType(property, "Property")) return false;
    return !isFunctionLike(property.value) || isClosedNoopFunction(property.value);
  });
};

const collectMemberAccess = (identifier: EsTreeNode): MemberAccess | null => {
  const propertyPath: string[] = [];
  let expression = findTransparentExpressionRoot(identifier);
  while (
    expression.parent &&
    isNodeOfType(expression.parent, "MemberExpression") &&
    expression.parent.object === expression
  ) {
    const propertyName = getStaticPropertyName(expression.parent);
    if (!propertyName) return null;
    propertyPath.push(propertyName);
    expression = findTransparentExpressionRoot(expression.parent);
  }
  return { expression, propertyPath };
};

const getEnvironment = (
  program: EsTreeNode,
  filename: string,
  state: AnalysisState,
): AnalysisEnvironment => {
  const cached = state.environmentsByProgram.get(program);
  if (cached) return cached;
  const environment = { filename, program, scopes: analyzeScopes(program) };
  state.environmentsByProgram.set(program, environment);
  return environment;
};

const unwrapProvenReactHocFunction = (
  node: EsTreeNode | null,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): EsTreeNode | null => {
  if (!node) return null;
  const current = findTransparentExpressionRoot(node);
  if (isFunctionLike(current)) return current;
  if (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (!symbol || visitedSymbolIds.has(symbol.id) || !symbol.initializer) return null;
    visitedSymbolIds.add(symbol.id);
    return unwrapProvenReactHocFunction(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(current, "CallExpression")) return null;
  if (
    !isProvenReactCall(current, "memo", scopes) &&
    !isProvenReactCall(current, "forwardRef", scopes)
  ) {
    return null;
  }
  const firstArgument = current.arguments[0];
  if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return null;
  return unwrapProvenReactHocFunction(firstArgument, scopes, visitedSymbolIds);
};

const isForwardRefValue = (node: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  let current = findTransparentExpressionRoot(node);
  while (isNodeOfType(current, "CallExpression")) {
    if (isProvenReactCall(current, "forwardRef", scopes)) return true;
    if (!isProvenReactCall(current, "memo", scopes)) return false;
    const firstArgument = current.arguments[0];
    if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return false;
    current = findTransparentExpressionRoot(firstArgument);
  }
  return false;
};

const functionFromExport = (
  resolved: ResolvedCrossFileValueExport,
  state: AnalysisState,
): ResolvedFunctionValue | null => {
  const environment = getEnvironment(resolved.programNode, resolved.filePath, state);
  const functionNode = unwrapProvenReactHocFunction(resolved.exportedNode, environment.scopes);
  if (!functionNode) return null;
  return {
    environment,
    functionNode,
    isForwardRef: isForwardRefValue(resolved.exportedNode, environment.scopes),
  };
};

const resolveFunctionValue = (
  identifier: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
): ResolvedFunctionValue | null => {
  if (!isNodeOfType(identifier, "Identifier") && !isNodeOfType(identifier, "JSXIdentifier")) {
    return null;
  }
  const symbol = environment.scopes.symbolFor(identifier);
  if (symbol && symbol.kind !== "import") {
    const functionNode = unwrapProvenReactHocFunction(symbol.initializer, environment.scopes);
    if (!functionNode) return null;
    return {
      environment,
      functionNode,
      isForwardRef: Boolean(
        symbol.initializer && isForwardRefValue(symbol.initializer, environment.scopes),
      ),
    };
  }
  const binding = getImportBindingForName(identifier, identifier.name);
  if (!binding || binding.isNamespace || binding.exportedName === null) return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    environment.filename,
    binding.source,
    binding.exportedName,
  );
  return resolved ? functionFromExport(resolved, state) : null;
};

const findOwnedSymbolValue = (
  expressionNode: EsTreeNode,
  initialPropertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
): SymbolValuePath | null => {
  const propertyPath = [...initialPropertyPath];
  let expression = findTransparentExpressionRoot(expressionNode);
  while (expression.parent) {
    const parent = expression.parent;
    if (isNodeOfType(parent, "Property") && parent.value === expression) {
      const propertyName = getStaticPropertyKeyName(parent, { allowComputedString: true });
      const objectExpression = parent.parent;
      if (
        !propertyName ||
        !objectExpression ||
        !objectHasOnlyClosedNoopFunctions(objectExpression, environment.scopes)
      ) {
        return null;
      }
      propertyPath.unshift(propertyName);
      expression = findTransparentExpressionRoot(objectExpression);
      continue;
    }
    if (
      (isNodeOfType(parent, "ConditionalExpression") &&
        (parent.consequent === expression || parent.alternate === expression)) ||
      (isNodeOfType(parent, "LogicalExpression") &&
        (parent.left === expression || parent.right === expression))
    ) {
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
    if (
      isNodeOfType(parent, "VariableDeclarator") &&
      parent.init === expression &&
      isNodeOfType(parent.id, "Identifier")
    ) {
      const symbol = environment.scopes.symbolFor(parent.id);
      if (!symbol || symbol.kind !== "const") return null;
      return { environment, propertyPath, symbol };
    }
    return null;
  }
  return null;
};

const isFreshInlineEventHandler = (functionNode: EsTreeNode): boolean => {
  const functionExpression = findTransparentExpressionRoot(functionNode);
  const container = functionExpression.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return false;
  const attributeName = getJsxAttributeName(attribute.name);
  const openingElement = attribute.parent;
  return Boolean(
    attributeName?.startsWith("on") &&
    openingElement &&
    isNodeOfType(openingElement, "JSXOpeningElement") &&
    isNodeOfType(openingElement.name, "JSXIdentifier") &&
    openingElement.name.name[0] === openingElement.name.name[0]?.toLowerCase(),
  );
};

const isSafeSameRenderCurrentRead = (
  referenceNode: EsTreeNode,
  accessedPropertyPath: ReadonlyArray<string>,
  targetPropertyPath: ReadonlyArray<string>,
): boolean => {
  if (!pathStartsWith(accessedPropertyPath, targetPropertyPath)) return false;
  if (accessedPropertyPath[targetPropertyPath.length] !== "current") return false;
  const enclosingFunction = findEnclosingFunction(referenceNode);
  return Boolean(enclosingFunction && isFreshInlineEventHandler(enclosingFunction));
};

const analyzePatternPath = (
  pattern: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  if (isNodeOfType(pattern, "AssignmentPattern")) {
    return analyzePatternPath(pattern.left, propertyPath, environment, state, remainingDepth);
  }
  if (isNodeOfType(pattern, "Identifier")) {
    const symbol = environment.scopes.symbolFor(pattern);
    return Boolean(
      symbol &&
      analyzeSymbolValuePath({ environment, propertyPath, symbol }, state, remainingDepth - 1),
    );
  }
  if (!isNodeOfType(pattern, "ObjectPattern") || propertyPath.length === 0) return false;
  const [firstPropertyName, ...remainingPropertyPath] = propertyPath;
  for (const property of pattern.properties) {
    if (!isNodeOfType(property, "Property")) continue;
    const propertyName = getStaticPropertyKeyName(property, { allowComputedString: true });
    if (propertyName !== firstPropertyName) continue;
    return analyzePatternPath(
      property.value,
      remainingPropertyPath,
      environment,
      state,
      remainingDepth,
    );
  }
  const restProperty = pattern.properties.find((property) => isNodeOfType(property, "RestElement"));
  return restProperty
    ? analyzePatternPath(restProperty.argument, propertyPath, environment, state, remainingDepth)
    : true;
};

const analyzeFunctionInput = (
  resolvedFunction: ResolvedFunctionValue,
  parameterIndex: number,
  propertyPath: ReadonlyArray<string>,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  if (remainingDepth <= 0 || !isFunctionLike(resolvedFunction.functionNode)) return false;
  const parameter = resolvedFunction.functionNode.params[parameterIndex];
  return Boolean(
    parameter &&
    analyzePatternPath(
      parameter,
      propertyPath,
      resolvedFunction.environment,
      state,
      remainingDepth,
    ),
  );
};

const analyzeJsxAttributeUse = (
  attribute: EsTreeNodeOfType<"JSXAttribute">,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  const attributeName = getJsxAttributeName(attribute.name);
  const openingElement = attribute.parent;
  if (!attributeName || !openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) {
    return false;
  }
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  const elementName = openingElement.name.name;
  if (elementName[0] === elementName[0]?.toLowerCase()) {
    return attributeName === "ref" && propertyPath.length === 0;
  }
  const resolvedFunction = resolveFunctionValue(openingElement.name, environment, state);
  if (!resolvedFunction) return false;
  if (attributeName === "ref" && resolvedFunction.isForwardRef) {
    return analyzeFunctionInput(resolvedFunction, 1, propertyPath, state, remainingDepth);
  }
  return analyzeFunctionInput(
    resolvedFunction,
    0,
    [attributeName, ...propertyPath],
    state,
    remainingDepth,
  );
};

const analyzeCallArgumentUse = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  argumentExpression: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  const argumentIndex = callExpression.arguments.findIndex(
    (argument) => argument === argumentExpression,
  );
  if (argumentIndex < 0) return false;
  if (
    argumentIndex === 0 &&
    isProvenReactCall(callExpression, "useImperativeHandle", environment.scopes)
  ) {
    return propertyPath.length === 0;
  }
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  const resolvedFunction = resolveFunctionValue(callExpression.callee, environment, state);
  return Boolean(
    resolvedFunction &&
    analyzeFunctionInput(resolvedFunction, argumentIndex, propertyPath, state, remainingDepth),
  );
};

const analyzeValueUse = (
  expressionNode: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  const expression = findTransparentExpressionRoot(expressionNode);
  const parent = expression.parent;
  if (!parent) return false;
  if (
    propertyPath.length > 0 &&
    ((isNodeOfType(parent, "LogicalExpression") && parent.left === expression) ||
      (isNodeOfType(parent, "ConditionalExpression") && parent.test === expression) ||
      (isNodeOfType(parent, "IfStatement") && parent.test === expression) ||
      (isNodeOfType(parent, "UnaryExpression") &&
        parent.operator === "!" &&
        parent.argument === expression))
  ) {
    return true;
  }
  if (isNodeOfType(parent, "JSXExpressionContainer") && parent.expression === expression) {
    const attribute = parent.parent;
    return Boolean(
      attribute &&
      isNodeOfType(attribute, "JSXAttribute") &&
      analyzeJsxAttributeUse(attribute, propertyPath, environment, state, remainingDepth),
    );
  }
  if (isNodeOfType(parent, "CallExpression")) {
    return analyzeCallArgumentUse(
      parent,
      expression,
      propertyPath,
      environment,
      state,
      remainingDepth,
    );
  }
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === expression &&
    !isNodeOfType(parent.id, "Identifier")
  ) {
    return analyzePatternPath(parent.id, propertyPath, environment, state, remainingDepth);
  }
  const propagatedValue = findOwnedSymbolValue(expression, propertyPath, environment);
  return Boolean(
    propagatedValue && analyzeSymbolValuePath(propagatedValue, state, remainingDepth - 1),
  );
};

const analyzeSymbolValuePath = (
  valuePath: SymbolValuePath,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  if (remainingDepth <= 0) return false;
  const activePathKey = `${valuePath.environment.filename}:${valuePath.symbol.id}:${valuePath.propertyPath.join(".")}`;
  if (state.activePaths.has(activePathKey)) return false;
  state.activePaths.add(activePathKey);
  const bindingFunction = findEnclosingFunction(valuePath.symbol.bindingIdentifier);
  const result = valuePath.symbol.references.every((reference) => {
    const referenceParent = reference.identifier.parent;
    if (
      referenceParent &&
      isNodeOfType(referenceParent, "Property") &&
      !referenceParent.computed &&
      referenceParent.key === reference.identifier &&
      referenceParent.value !== reference.identifier
    ) {
      return true;
    }
    const memberAccess = collectMemberAccess(reference.identifier);
    if (!memberAccess) return false;
    if (!pathsOverlap(memberAccess.propertyPath, valuePath.propertyPath)) return true;
    if (reference.flag !== "read") return false;
    const referenceFunction = findEnclosingFunction(reference.identifier);
    if (referenceFunction !== bindingFunction) {
      return isSafeSameRenderCurrentRead(
        reference.identifier,
        memberAccess.propertyPath,
        valuePath.propertyPath,
      );
    }
    if (pathStartsWith(memberAccess.propertyPath, valuePath.propertyPath)) {
      if (memberAccess.propertyPath.length > valuePath.propertyPath.length) return false;
      return analyzeValueUse(
        memberAccess.expression,
        [],
        valuePath.environment,
        state,
        remainingDepth,
      );
    }
    return analyzeValueUse(
      memberAccess.expression,
      valuePath.propertyPath.slice(memberAccess.propertyPath.length),
      valuePath.environment,
      state,
      remainingDepth,
    );
  });
  state.activePaths.delete(activePathKey);
  return result;
};

export const isCreateRefResultWriteOnly = (
  createRefCall: EsTreeNodeOfType<"CallExpression">,
  filename: string | undefined,
  scopes: ScopeAnalysis,
): boolean => {
  if (!filename) return false;
  const program = findProgramRoot(createRefCall);
  if (!program) return false;
  const environment = { filename, program, scopes };
  const state: AnalysisState = {
    activePaths: new Set(),
    environmentsByProgram: new WeakMap([[program, environment]]),
  };
  const ownedValue = findOwnedSymbolValue(createRefCall, [], environment);
  return Boolean(
    ownedValue && analyzeSymbolValuePath(ownedValue, state, CREATE_REF_PROP_FLOW_MAX_DEPTH),
  );
};
