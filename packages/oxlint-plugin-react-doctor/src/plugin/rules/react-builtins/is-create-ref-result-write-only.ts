import { CREATE_REF_PROP_FLOW_MAX_DEPTH } from "../../constants/thresholds.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { collectFunctionChildrenReferences } from "../../utils/collect-function-children-references.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { functionContainsReactRenderOutput } from "../../utils/function-contains-react-render-output.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { hasSymbolWriteBefore } from "../../utils/has-symbol-write-before.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isProvenReactClassComponent as isProvenReactClassNode } from "../../utils/is-proven-react-class-component.js";
import { isProvenIntrinsicJsxElement } from "../../utils/is-proven-intrinsic-jsx-element.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isReactApiCall } from "../../utils/is-react-api-call.js";
import {
  resolveCrossFileValueExportWithFilePath,
  type ResolvedCrossFileValueExport,
} from "../../utils/resolve-cross-file-function-export.js";
import { isSafeCreateRefCallbackCurrentWrite } from "./is-safe-create-ref-callback-current-write.js";
import { isValueRenderedInSameRender } from "./is-value-rendered-in-same-render.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

interface AnalysisEnvironment {
  readonly filename: string;
  readonly program: EsTreeNode;
  readonly scopes: ScopeAnalysis;
}

interface SymbolValuePath {
  readonly environment: AnalysisEnvironment;
  readonly originWriteReference?: EsTreeNode;
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

interface ResolvedClassValue {
  readonly classNode: EsTreeNode;
  readonly environment: AnalysisEnvironment;
}

interface AnalysisState {
  readonly activePaths: Set<string>;
  readonly activeRenderedChildrenComponents: WeakSet<EsTreeNode>;
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
): boolean =>
  isReactApiCall(callExpression, expectedName, scopes, {
    resolveNamedAliases: true,
  });

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

const getValuePathPropertyName = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): string | null => {
  const propertyName = getStaticPropertyName(memberExpression);
  if (propertyName) return propertyName;
  return memberExpression.computed &&
    isNodeOfType(memberExpression.property, "Literal") &&
    typeof memberExpression.property.value === "number" &&
    Number.isSafeInteger(memberExpression.property.value) &&
    memberExpression.property.value >= 0
    ? String(memberExpression.property.value)
    : null;
};

const collectMemberAccess = (identifier: EsTreeNode): MemberAccess | null => {
  const propertyPath: string[] = [];
  let expression = findTransparentExpressionRoot(identifier);
  while (
    expression.parent &&
    isNodeOfType(expression.parent, "MemberExpression") &&
    expression.parent.object === expression
  ) {
    const propertyName = getValuePathPropertyName(expression.parent);
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
    if (
      !symbol ||
      visitedSymbolIds.has(symbol.id) ||
      !symbol.initializer ||
      hasSymbolWriteBefore(symbol, current, scopes)
    ) {
      return null;
    }
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

const isForwardRefValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const current = findTransparentExpressionRoot(node);
  if (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (
      !symbol ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, current, scopes)
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isForwardRefValue(symbol.initializer, scopes, visitedSymbolIds);
  }
  if (!isNodeOfType(current, "CallExpression")) return false;
  if (isProvenReactCall(current, "forwardRef", scopes)) return true;
  if (!isProvenReactCall(current, "memo", scopes)) return false;
  const firstArgument = current.arguments[0];
  if (!firstArgument || isNodeOfType(firstArgument, "SpreadElement")) return false;
  return isForwardRefValue(firstArgument, scopes, visitedSymbolIds);
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
    if (hasSymbolWriteBefore(symbol, identifier, environment.scopes)) return null;
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

const resolveJsxFunctionValue = (
  elementName: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
): ResolvedFunctionValue | null => {
  if (isNodeOfType(elementName, "JSXIdentifier")) {
    return resolveFunctionValue(elementName, environment, state);
  }
  if (
    !isNodeOfType(elementName, "JSXMemberExpression") ||
    !isNodeOfType(elementName.object, "JSXIdentifier")
  ) {
    return null;
  }
  const namespaceBinding = getImportBindingForName(elementName.object, elementName.object.name);
  if (!namespaceBinding?.isNamespace) return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    environment.filename,
    namespaceBinding.source,
    elementName.property.name,
  );
  return resolved ? functionFromExport(resolved, state) : null;
};

const isProvenReactClassValue = (
  node: EsTreeNode,
  environment: AnalysisEnvironment,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const current = findTransparentExpressionRoot(node);
  if (isNodeOfType(current, "Identifier")) {
    const symbol = environment.scopes.symbolFor(current);
    if (
      !symbol ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      hasSymbolWriteBefore(symbol, current, environment.scopes)
    ) {
      return false;
    }
    visitedSymbolIds.add(symbol.id);
    return isProvenReactClassValue(symbol.initializer, environment, visitedSymbolIds);
  }
  return isProvenReactClassNode(current, environment.scopes);
};

const isProvenClassComponentIdentifier = (
  identifier: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = environment.scopes.symbolFor(identifier);
  if (symbol && symbol.kind !== "import") {
    if (hasSymbolWriteBefore(symbol, identifier, environment.scopes)) return false;
    return Boolean(symbol.initializer && isProvenReactClassValue(symbol.initializer, environment));
  }
  const binding = getImportBindingForName(identifier, identifier.name);
  if (!binding || binding.isNamespace || binding.exportedName === null) return false;
  const resolved = resolveCrossFileValueExportWithFilePath(
    environment.filename,
    binding.source,
    binding.exportedName,
  );
  if (!resolved) return false;
  const resolvedEnvironment = getEnvironment(resolved.programNode, resolved.filePath, state);
  return isProvenReactClassValue(resolved.exportedNode, resolvedEnvironment);
};

const resolveClassValue = (
  node: EsTreeNode | null | undefined,
  environment: AnalysisEnvironment,
): ResolvedClassValue | null => {
  if (!node) return null;
  const classNode = findTransparentExpressionRoot(node);
  if (
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression")) ||
    !isProvenReactClassValue(classNode, environment)
  ) {
    return null;
  }
  return { classNode, environment };
};

const resolveJsxClassValue = (
  elementName: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
): ResolvedClassValue | null => {
  if (!isNodeOfType(elementName, "JSXIdentifier")) return null;
  const symbol = environment.scopes.symbolFor(elementName);
  if (symbol && symbol.kind !== "import") {
    if (hasSymbolWriteBefore(symbol, elementName, environment.scopes)) return null;
    return resolveClassValue(symbol.initializer, environment);
  }
  const binding = getImportBindingForName(elementName, elementName.name);
  if (!binding || binding.isNamespace || binding.exportedName === null) return null;
  const resolved = resolveCrossFileValueExportWithFilePath(
    environment.filename,
    binding.source,
    binding.exportedName,
  );
  if (!resolved) return null;
  const resolvedEnvironment = getEnvironment(resolved.programNode, resolved.filePath, state);
  return resolveClassValue(resolved.exportedNode, resolvedEnvironment);
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
    if (isNodeOfType(parent, "ArrayExpression")) {
      if (parent.elements.some((element) => element && isNodeOfType(element, "SpreadElement"))) {
        return null;
      }
      const elementIndex = parent.elements.findIndex((element) => element === expression);
      if (elementIndex < 0) return null;
      propertyPath.unshift(String(elementIndex));
      expression = findTransparentExpressionRoot(parent);
      continue;
    }
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
    if (
      isNodeOfType(parent, "AssignmentExpression") &&
      parent.operator === "=" &&
      parent.right === expression &&
      isNodeOfType(parent.left, "MemberExpression")
    ) {
      const assignedPropertyPath: string[] = [];
      let assignedExpression: EsTreeNode = parent.left;
      while (isNodeOfType(assignedExpression, "MemberExpression")) {
        const propertyName = getValuePathPropertyName(assignedExpression);
        if (!propertyName) return null;
        assignedPropertyPath.unshift(propertyName);
        assignedExpression = findTransparentExpressionRoot(assignedExpression.object);
      }
      if (!isNodeOfType(assignedExpression, "Identifier")) return null;
      const symbol = environment.scopes.symbolFor(assignedExpression);
      if (!symbol || symbol.kind !== "const") return null;
      return {
        environment,
        originWriteReference: assignedExpression,
        propertyPath: [...assignedPropertyPath, ...propertyPath],
        symbol,
      };
    }
    return null;
  }
  return null;
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
    if (!propertyName) return false;
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

const isIntrinsicReactElementFactoryCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  environment: AnalysisEnvironment,
): boolean => {
  const element = callExpression.arguments[0];
  if (!element || isNodeOfType(element, "SpreadElement")) return false;
  if (isProvenReactCall(callExpression, "createElement", environment.scopes)) {
    return isNodeOfType(element, "Literal") && typeof element.value === "string";
  }
  if (!isProvenReactCall(callExpression, "cloneElement", environment.scopes)) return false;
  if (!isNodeOfType(element, "JSXElement")) return false;
  return isProvenIntrinsicJsxElement(element.openingElement, environment.scopes);
};

const isIntrinsicReactElementRefProperty = (
  expression: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  if (propertyPath.length > 0) return false;
  const property = expression.parent;
  if (!property || !isNodeOfType(property, "Property") || property.value !== expression) {
    return false;
  }
  if (getStaticPropertyKeyName(property, { allowComputedString: true }) !== "ref") return false;
  const props = property.parent;
  if (!props || !isNodeOfType(props, "ObjectExpression")) return false;
  const callExpression = props.parent;
  if (
    !callExpression ||
    !isNodeOfType(callExpression, "CallExpression") ||
    callExpression.arguments[1] !== props ||
    !isIntrinsicReactElementFactoryCall(callExpression, environment) ||
    !isValueRenderedForEnvironment(callExpression, environment, state, remainingDepth)
  ) {
    return false;
  }
  return true;
};

const analyzeFunctionInput = (
  resolvedFunction: ResolvedFunctionValue,
  parameterIndex: number,
  propertyPath: ReadonlyArray<string>,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  if (
    remainingDepth <= 0 ||
    !isFunctionLike(resolvedFunction.functionNode) ||
    resolvedFunction.functionNode.async ||
    resolvedFunction.functionNode.generator
  ) {
    return false;
  }
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

const isThisPropsChildren = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "MemberExpression") || getStaticPropertyName(node) !== "children") {
    return false;
  }
  const propsMember = findTransparentExpressionRoot(node.object);
  return Boolean(
    isNodeOfType(propsMember, "MemberExpression") &&
    getStaticPropertyName(propsMember) === "props" &&
    isNodeOfType(findTransparentExpressionRoot(propsMember.object), "ThisExpression"),
  );
};

const isProvenReactContextProvider = (
  openingElement: EsTreeNode,
  environment: AnalysisEnvironment,
): boolean => {
  if (
    !isNodeOfType(openingElement, "JSXOpeningElement") ||
    !isNodeOfType(openingElement.name, "JSXMemberExpression") ||
    openingElement.name.property.name !== "Provider" ||
    !isNodeOfType(openingElement.name.object, "JSXIdentifier")
  ) {
    return false;
  }
  const contextSymbol = environment.scopes.symbolFor(openingElement.name.object);
  return Boolean(
    contextSymbol?.kind === "const" &&
    contextSymbol.initializer &&
    isNodeOfType(contextSymbol.initializer, "CallExpression") &&
    isProvenReactCall(contextSymbol.initializer, "createContext", environment.scopes),
  );
};

const isValueRenderedForEnvironment = (
  expression: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean =>
  isValueRenderedInSameRender(expression, environment.scopes, {
    doesCustomElementRenderChildren: (openingElement) =>
      doesCustomElementRenderChildren(openingElement, environment, state, remainingDepth - 1),
  });

const doesFunctionComponentRenderChildren = (
  resolvedFunction: ResolvedFunctionValue,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  const { functionNode } = resolvedFunction;
  if (
    remainingDepth <= 0 ||
    state.activeRenderedChildrenComponents.has(functionNode) ||
    (!isNodeOfType(functionNode, "ArrowFunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionExpression") &&
      !isNodeOfType(functionNode, "FunctionDeclaration")) ||
    functionNode.async ||
    functionNode.generator
  ) {
    return false;
  }
  const childrenReferences = collectFunctionChildrenReferences(
    functionNode,
    resolvedFunction.environment.scopes,
  );
  if (!childrenReferences) return false;
  state.activeRenderedChildrenComponents.add(functionNode);
  const isRendered = childrenReferences.every((childrenReference) =>
    isValueRenderedForEnvironment(
      childrenReference,
      resolvedFunction.environment,
      state,
      remainingDepth,
    ),
  );
  state.activeRenderedChildrenComponents.delete(functionNode);
  return isRendered;
};

const doesClassComponentRenderChildren = (
  resolvedClass: ResolvedClassValue,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  const { classNode, environment } = resolvedClass;
  if (
    remainingDepth <= 0 ||
    state.activeRenderedChildrenComponents.has(classNode) ||
    (!isNodeOfType(classNode, "ClassDeclaration") && !isNodeOfType(classNode, "ClassExpression"))
  ) {
    return false;
  }
  const renderMethod = classNode.body.body.find(
    (element) =>
      isNodeOfType(element, "MethodDefinition") &&
      !element.computed &&
      isNodeOfType(element.key, "Identifier") &&
      element.key.name === "render",
  );
  if (!renderMethod || !isNodeOfType(renderMethod, "MethodDefinition")) return false;
  const childrenReads: EsTreeNode[] = [];
  walkAst(classNode, (node) => {
    if (isThisPropsChildren(node)) childrenReads.push(node);
  });
  if (childrenReads.length === 0) return false;
  state.activeRenderedChildrenComponents.add(classNode);
  const isRendered = childrenReads.every(
    (childrenRead) =>
      findEnclosingFunction(childrenRead) === renderMethod.value &&
      isValueRenderedForEnvironment(childrenRead, environment, state, remainingDepth),
  );
  state.activeRenderedChildrenComponents.delete(classNode);
  return isRendered;
};

const doesCustomElementRenderChildren = (
  openingElement: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  if (remainingDepth <= 0 || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  if (isProvenReactContextProvider(openingElement, environment)) return true;
  const resolvedFunction = resolveJsxFunctionValue(openingElement.name, environment, state);
  if (resolvedFunction) {
    return doesFunctionComponentRenderChildren(resolvedFunction, state, remainingDepth);
  }
  const resolvedClass = resolveJsxClassValue(openingElement.name, environment, state);
  return Boolean(
    resolvedClass && doesClassComponentRenderChildren(resolvedClass, state, remainingDepth),
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
  const jsxElement = openingElement.parent;
  if (
    !jsxElement ||
    !isNodeOfType(jsxElement, "JSXElement") ||
    !isValueRenderedForEnvironment(jsxElement, environment, state, remainingDepth)
  ) {
    return false;
  }
  if (isProvenIntrinsicJsxElement(openingElement, environment.scopes)) {
    return attributeName === "ref" && propertyPath.length === 0;
  }
  if (
    isNodeOfType(openingElement.name, "JSXIdentifier") &&
    attributeName === "ref" &&
    propertyPath.length === 0 &&
    isProvenClassComponentIdentifier(openingElement.name, environment, state)
  ) {
    return true;
  }
  const resolvedFunction = resolveJsxFunctionValue(openingElement.name, environment, state);
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
    isNodeOfType(callExpression.callee, "Identifier") &&
    callExpression.callee.name === "Boolean" &&
    environment.scopes.isGlobalReference(callExpression.callee)
  ) {
    return true;
  }
  if (
    argumentIndex === 0 &&
    isProvenReactCall(callExpression, "useImperativeHandle", environment.scopes)
  ) {
    return propertyPath.length === 0;
  }
  if (
    argumentIndex === 1 &&
    propertyPath.length === 1 &&
    propertyPath[0] === "ref" &&
    isIntrinsicReactElementFactoryCall(callExpression, environment) &&
    isValueRenderedForEnvironment(callExpression, environment, state, remainingDepth)
  ) {
    return true;
  }
  const inlineCallee = findTransparentExpressionRoot(callExpression.callee);
  if (isFunctionLike(inlineCallee)) {
    if (
      functionContainsReactRenderOutput(inlineCallee, environment.scopes) &&
      !isValueRenderedForEnvironment(callExpression, environment, state, remainingDepth)
    ) {
      return false;
    }
    return analyzeFunctionInput(
      { environment, functionNode: inlineCallee, isForwardRef: false },
      argumentIndex,
      propertyPath,
      state,
      remainingDepth,
    );
  }
  if (!isNodeOfType(callExpression.callee, "Identifier")) return false;
  const resolvedFunction = resolveFunctionValue(callExpression.callee, environment, state);
  return Boolean(
    resolvedFunction &&
    (!functionContainsReactRenderOutput(
      resolvedFunction.functionNode,
      resolvedFunction.environment.scopes,
    ) ||
      isValueRenderedForEnvironment(callExpression, environment, state, remainingDepth)) &&
    analyzeFunctionInput(resolvedFunction, argumentIndex, propertyPath, state, remainingDepth),
  );
};

const isIntrinsicJsxSpreadRefUse = (
  expression: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
  state: AnalysisState,
  remainingDepth: number,
): boolean => {
  let spreadAttribute: EsTreeNode | null | undefined;
  if (propertyPath.length === 1 && propertyPath[0] === "ref") {
    spreadAttribute = expression.parent;
  } else if (propertyPath.length === 0) {
    const property = expression.parent;
    if (
      !property ||
      !isNodeOfType(property, "Property") ||
      property.value !== expression ||
      getStaticPropertyKeyName(property, { allowComputedString: true }) !== "ref"
    ) {
      return false;
    }
    spreadAttribute = property.parent?.parent;
  }
  if (!spreadAttribute || !isNodeOfType(spreadAttribute, "JSXSpreadAttribute")) return false;
  const openingElement = spreadAttribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  const jsxElement = openingElement.parent;
  return Boolean(
    isProvenIntrinsicJsxElement(openingElement, environment.scopes) &&
    jsxElement &&
    isNodeOfType(jsxElement, "JSXElement") &&
    isValueRenderedForEnvironment(jsxElement, environment, state, remainingDepth),
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
  if (isNodeOfType(parent, "ExpressionStatement")) return true;
  if (
    isNodeOfType(parent, "UnaryExpression") &&
    parent.operator === "void" &&
    parent.argument === expression
  ) {
    return true;
  }
  if (
    propertyPath.length === 0 &&
    isNodeOfType(parent, "BinaryExpression") &&
    (parent.operator === "===" ||
      parent.operator === "!==" ||
      parent.operator === "==" ||
      parent.operator === "!=")
  ) {
    const comparedExpression = parent.left === expression ? parent.right : parent.left;
    return Boolean(
      isNodeOfType(expression, "Identifier") &&
      isNodeOfType(comparedExpression, "Identifier") &&
      environment.scopes.symbolFor(expression)?.id ===
        environment.scopes.symbolFor(comparedExpression)?.id,
    );
  }
  if (isIntrinsicJsxSpreadRefUse(expression, propertyPath, environment, state, remainingDepth)) {
    return true;
  }
  if (
    isIntrinsicReactElementRefProperty(expression, propertyPath, environment, state, remainingDepth)
  ) {
    return true;
  }
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

const getFunctionBindingIdentifier = (
  functionNode: EsTreeNode,
): EsTreeNodeOfType<"Identifier"> | null => {
  const parent = functionNode.parent;
  if (
    parent &&
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id;
  }
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return functionNode.id;
  }
  return null;
};

const isSynchronouslyInvokedLocalFunction = (
  functionNode: EsTreeNode | null,
  callerFunction: EsTreeNode | null,
  scopes: ScopeAnalysis,
): boolean => {
  if (
    !functionNode ||
    !callerFunction ||
    !isFunctionLike(functionNode) ||
    functionNode.async ||
    functionNode.generator
  ) {
    return false;
  }
  const bindingIdentifier = getFunctionBindingIdentifier(functionNode);
  if (!bindingIdentifier) return false;
  const bindingOwner =
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id === bindingIdentifier
      ? findEnclosingFunction(functionNode)
      : findEnclosingFunction(bindingIdentifier);
  if (bindingOwner !== callerFunction) return false;
  const symbol = isNodeOfType(functionNode, "FunctionDeclaration")
    ? scopes.ownScopeFor(callerFunction)?.symbolsByName.get(bindingIdentifier.name)
    : scopes.symbolFor(bindingIdentifier);
  return Boolean(
    symbol &&
    symbol.references.length > 0 &&
    symbol.references.every((reference) => {
      const referenceExpression = findTransparentExpressionRoot(reference.identifier);
      const callExpression = referenceExpression.parent;
      return Boolean(
        callExpression &&
        isNodeOfType(callExpression, "CallExpression") &&
        callExpression.callee === referenceExpression &&
        findEnclosingFunction(callExpression) === callerFunction &&
        isValueRenderedInSameRender(callExpression, scopes),
      );
    }),
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
    if (reference.identifier === valuePath.originWriteReference) return true;
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
    const referenceFunction = findEnclosingFunction(reference.identifier);
    if (
      referenceFunction !== bindingFunction &&
      !isSynchronouslyInvokedLocalFunction(
        referenceFunction,
        bindingFunction,
        valuePath.environment.scopes,
      )
    ) {
      if (
        isSafeCreateRefCallbackCurrentWrite(
          reference.identifier,
          memberAccess.propertyPath,
          valuePath.propertyPath,
          valuePath.environment.scopes,
        )
      ) {
        return true;
      }
      return false;
    }
    if (reference.flag !== "read") return false;
    if (pathStartsWith(memberAccess.propertyPath, valuePath.propertyPath)) {
      if (memberAccess.propertyPath.length > valuePath.propertyPath.length) {
        const parent = memberAccess.expression.parent;
        return Boolean(
          memberAccess.propertyPath.length === valuePath.propertyPath.length + 1 &&
          memberAccess.propertyPath[valuePath.propertyPath.length] === "current" &&
          parent &&
          isNodeOfType(parent, "UnaryExpression") &&
          parent.operator === "void" &&
          parent.argument === memberAccess.expression,
        );
      }
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
    activeRenderedChildrenComponents: new WeakSet(),
    environmentsByProgram: new WeakMap([[program, environment]]),
  };
  const ownedValue = findOwnedSymbolValue(createRefCall, [], environment);
  return ownedValue
    ? analyzeSymbolValuePath(ownedValue, state, CREATE_REF_PROP_FLOW_MAX_DEPTH)
    : analyzeValueUse(createRefCall, [], environment, state, CREATE_REF_PROP_FLOW_MAX_DEPTH);
};
