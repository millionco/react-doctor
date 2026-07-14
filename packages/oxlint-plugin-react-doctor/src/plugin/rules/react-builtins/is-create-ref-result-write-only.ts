import { CREATE_REF_PROP_FLOW_MAX_DEPTH } from "../../constants/thresholds.js";
import { analyzeScopes } from "../../semantic/scope-analysis.js";
import type { ScopeAnalysis, SymbolDescriptor } from "../../semantic/scope-analysis.js";
import { findEnclosingFunction } from "../../utils/find-enclosing-function.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getImportBindingForName } from "../../utils/find-import-source-for-name.js";
import { getJsxAttributeName } from "../../utils/get-jsx-attribute-name.js";
import { getImportedName } from "../../utils/get-imported-name.js";
import { getStaticPropertyKeyName } from "../../utils/get-static-property-key-name.js";
import { getStaticPropertyName } from "../../utils/get-static-property-name.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import {
  isImportedFromReact,
  isReactApiCall,
  isReactNamespaceImport,
} from "../../utils/is-react-api-call.js";
import {
  resolveCrossFileValueExportWithFilePath,
  type ResolvedCrossFileValueExport,
} from "../../utils/resolve-cross-file-function-export.js";
import { walkAst } from "../../utils/walk-ast.js";
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

const isForwardRefValue = (
  node: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const current = findTransparentExpressionRoot(node);
  if (isNodeOfType(current, "Identifier")) {
    const symbol = scopes.symbolFor(current);
    if (!symbol || !symbol.initializer || visitedSymbolIds.has(symbol.id)) return false;
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

const isProvenReactClassComponent = (
  node: EsTreeNode,
  environment: AnalysisEnvironment,
  visitedSymbolIds: Set<number> = new Set(),
): boolean => {
  const current = findTransparentExpressionRoot(node);
  if (isNodeOfType(current, "Identifier")) {
    const symbol = environment.scopes.symbolFor(current);
    if (!symbol || !symbol.initializer || visitedSymbolIds.has(symbol.id)) return false;
    visitedSymbolIds.add(symbol.id);
    return isProvenReactClassComponent(symbol.initializer, environment, visitedSymbolIds);
  }
  if (!isNodeOfType(current, "ClassDeclaration") && !isNodeOfType(current, "ClassExpression")) {
    return false;
  }
  const isProvenReactComponentBase = (baseNode: EsTreeNode): boolean => {
    const base = findTransparentExpressionRoot(baseNode);
    if (isNodeOfType(base, "Identifier")) {
      const symbol = environment.scopes.symbolFor(base);
      if (symbol?.kind === "const" && symbol.initializer && !visitedSymbolIds.has(symbol.id)) {
        visitedSymbolIds.add(symbol.id);
        return isProvenReactComponentBase(symbol.initializer);
      }
      const importedName = symbol ? getImportedName(symbol.declarationNode) : null;
      return Boolean(
        symbol &&
        isImportedFromReact(symbol) &&
        (importedName === "Component" || importedName === "PureComponent"),
      );
    }
    if (!isNodeOfType(base, "MemberExpression")) return false;
    const propertyName = getStaticPropertyName(base);
    return Boolean(
      (propertyName === "Component" || propertyName === "PureComponent") &&
      isReactNamespaceImport(base.object, environment.scopes),
    );
  };
  return Boolean(current.superClass && isProvenReactComponentBase(current.superClass));
};

const isProvenIntrinsicJsxElement = (
  openingElement: EsTreeNodeOfType<"JSXOpeningElement">,
  scopes: ScopeAnalysis,
): boolean => {
  if (!isNodeOfType(openingElement.name, "JSXIdentifier")) return false;
  if (openingElement.name.name[0] === openingElement.name.name[0]?.toLowerCase()) return true;
  const visitedSymbolIds = new Set<number>();
  const isIntrinsicValue = (node: EsTreeNode): boolean => {
    const current = findTransparentExpressionRoot(node);
    if (isNodeOfType(current, "Literal")) return typeof current.value === "string";
    if (isNodeOfType(current, "Identifier") || isNodeOfType(current, "JSXIdentifier")) {
      const symbol = scopes.symbolFor(current);
      if (
        !symbol ||
        symbol.kind !== "const" ||
        !symbol.initializer ||
        visitedSymbolIds.has(symbol.id)
      ) {
        return false;
      }
      visitedSymbolIds.add(symbol.id);
      const isIntrinsic = isIntrinsicValue(symbol.initializer);
      visitedSymbolIds.delete(symbol.id);
      return isIntrinsic;
    }
    if (isNodeOfType(current, "ConditionalExpression")) {
      return isIntrinsicValue(current.consequent) && isIntrinsicValue(current.alternate);
    }
    return false;
  };
  return isIntrinsicValue(openingElement.name);
};

const isProvenClassComponentIdentifier = (
  identifier: EsTreeNode,
  environment: AnalysisEnvironment,
  state: AnalysisState,
): boolean => {
  if (!isNodeOfType(identifier, "JSXIdentifier")) return false;
  const symbol = environment.scopes.symbolFor(identifier);
  if (symbol && symbol.kind !== "import") {
    return Boolean(
      symbol.initializer && isProvenReactClassComponent(symbol.initializer, environment),
    );
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
  return isProvenReactClassComponent(resolved.exportedNode, resolvedEnvironment);
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

const getIntrinsicEventAttribute = (
  expressionNode: EsTreeNode,
  scopes: ScopeAnalysis,
): EsTreeNode | null => {
  let expression = findTransparentExpressionRoot(expressionNode);
  while (
    expression.parent &&
    ((isNodeOfType(expression.parent, "ConditionalExpression") &&
      (expression.parent.consequent === expression ||
        expression.parent.alternate === expression)) ||
      (isNodeOfType(expression.parent, "LogicalExpression") &&
        (expression.parent.left === expression || expression.parent.right === expression)))
  ) {
    expression = findTransparentExpressionRoot(expression.parent);
  }
  const container = expression.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return null;
  const attribute = container.parent;
  if (!attribute || !isNodeOfType(attribute, "JSXAttribute")) return null;
  const attributeName = getJsxAttributeName(attribute.name);
  const openingElement = attribute.parent;
  if (
    !attributeName?.startsWith("on") ||
    !openingElement ||
    !isNodeOfType(openingElement, "JSXOpeningElement")
  ) {
    return null;
  }
  return isProvenIntrinsicJsxElement(openingElement, scopes) ? attribute : null;
};

const isFreshEventHandler = (
  functionNode: EsTreeNode,
  environment: AnalysisEnvironment,
): boolean => {
  const functionExpression = findTransparentExpressionRoot(functionNode);
  if (!isFunctionLike(functionExpression)) return false;
  if (getIntrinsicEventAttribute(functionExpression, environment.scopes)) return true;
  const bindingIdentifier =
    functionExpression.id ??
    (functionExpression.parent &&
    isNodeOfType(functionExpression.parent, "VariableDeclarator") &&
    functionExpression.parent.init === functionExpression &&
    isNodeOfType(functionExpression.parent.id, "Identifier")
      ? functionExpression.parent.id
      : null);
  if (!bindingIdentifier) return false;
  const symbol = environment.scopes.symbolFor(bindingIdentifier);
  return Boolean(
    symbol &&
    symbol.references.length > 0 &&
    symbol.references.every((reference) =>
      Boolean(getIntrinsicEventAttribute(reference.identifier, environment.scopes)),
    ),
  );
};

const isInlineIntrinsicRefCallback = (
  functionNode: EsTreeNode,
  environment: AnalysisEnvironment,
): boolean => {
  const functionExpression = findTransparentExpressionRoot(functionNode);
  if (
    !isFunctionLike(functionExpression) ||
    functionExpression.async ||
    functionExpression.generator
  ) {
    return false;
  }
  const container = functionExpression.parent;
  if (!container || !isNodeOfType(container, "JSXExpressionContainer")) return false;
  const attribute = container.parent;
  if (
    !attribute ||
    !isNodeOfType(attribute, "JSXAttribute") ||
    getJsxAttributeName(attribute.name) !== "ref"
  ) {
    return false;
  }
  const openingElement = attribute.parent;
  if (!openingElement || !isNodeOfType(openingElement, "JSXOpeningElement")) return false;
  return isProvenIntrinsicJsxElement(openingElement, environment.scopes);
};

const isInlineIntrinsicRefCurrentWrite = (
  referenceNode: EsTreeNode,
  accessedPropertyPath: ReadonlyArray<string>,
  targetPropertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
): boolean => {
  if (
    accessedPropertyPath.length !== targetPropertyPath.length + 1 ||
    !pathStartsWith(accessedPropertyPath, targetPropertyPath) ||
    accessedPropertyPath[targetPropertyPath.length] !== "current"
  ) {
    return false;
  }
  const memberAccess = collectMemberAccess(referenceNode);
  const assignment = memberAccess?.expression.parent;
  if (
    !memberAccess ||
    !assignment ||
    !isNodeOfType(assignment, "AssignmentExpression") ||
    assignment.operator !== "=" ||
    assignment.left !== memberAccess.expression
  ) {
    return false;
  }
  let enclosingFunction = findEnclosingFunction(referenceNode);
  while (enclosingFunction) {
    if (isInlineIntrinsicRefCallback(enclosingFunction, environment)) return true;
    enclosingFunction = findEnclosingFunction(enclosingFunction);
  }
  return false;
};

const findEnclosingLoop = (node: EsTreeNode, boundary: EsTreeNode): EsTreeNode | null => {
  let current = node.parent;
  while (current && current !== boundary) {
    if (
      isNodeOfType(current, "ForStatement") ||
      isNodeOfType(current, "ForInStatement") ||
      isNodeOfType(current, "ForOfStatement") ||
      isNodeOfType(current, "WhileStatement") ||
      isNodeOfType(current, "DoWhileStatement")
    ) {
      return current;
    }
    current = current.parent;
  }
  return null;
};

const isReactStateSetterCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  scopes: ScopeAnalysis,
): boolean => {
  const callee = findTransparentExpressionRoot(callExpression.callee);
  if (!isNodeOfType(callee, "Identifier")) return false;
  let symbol = scopes.symbolFor(callee);
  const visitedSymbolIds = new Set<number>();
  while (
    symbol?.kind === "const" &&
    symbol.initializer &&
    isNodeOfType(symbol.initializer, "Identifier") &&
    isNodeOfType(symbol.declarationNode, "VariableDeclarator") &&
    symbol.declarationNode.id === symbol.bindingIdentifier &&
    !visitedSymbolIds.has(symbol.id)
  ) {
    visitedSymbolIds.add(symbol.id);
    symbol = scopes.symbolFor(symbol.initializer);
  }
  if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return false;
  const arrayPattern = symbol.bindingIdentifier.parent;
  if (
    !arrayPattern ||
    !isNodeOfType(arrayPattern, "ArrayPattern") ||
    arrayPattern.elements[1] !== symbol.bindingIdentifier
  ) {
    return false;
  }
  const declarator = arrayPattern.parent;
  if (!declarator || !isNodeOfType(declarator, "VariableDeclarator") || !declarator.init) {
    return false;
  }
  return (
    isReactApiCall(declarator.init, "useState", scopes, { resolveNamedAliases: true }) ||
    isReactApiCall(declarator.init, "useReducer", scopes, { resolveNamedAliases: true })
  );
};

const isProvenNonCommittingCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  eventHandler: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isReactStateSetterCall(callExpression, scopes)) return true;
  if (isReactApiCall(callExpression, "startTransition", scopes, { resolveNamedAliases: true })) {
    const callback = callExpression.arguments[0];
    if (!callback || isNodeOfType(callback, "SpreadElement") || !isFunctionLike(callback)) {
      return false;
    }
    if (!isNodeOfType(callback.body, "BlockStatement")) {
      return (
        isNodeOfType(callback.body, "CallExpression") &&
        isReactStateSetterCall(callback.body, scopes)
      );
    }
    return callback.body.body.every(
      (statement) =>
        isNodeOfType(statement, "EmptyStatement") ||
        (isNodeOfType(statement, "ExpressionStatement") &&
          isNodeOfType(statement.expression, "CallExpression") &&
          isReactStateSetterCall(statement.expression, scopes)),
    );
  }
  const callee = findTransparentExpressionRoot(callExpression.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  const methodName = getStaticPropertyName(callee);
  const receiver = findTransparentExpressionRoot(callee.object);
  if (
    isNodeOfType(receiver, "Identifier") &&
    receiver.name === "console" &&
    scopes.isGlobalReference(receiver)
  ) {
    return true;
  }
  if (methodName !== "preventDefault" && methodName !== "stopPropagation") return false;
  if (!isFunctionLike(eventHandler)) return false;
  const eventParameter = eventHandler.params[0];
  return Boolean(
    eventParameter &&
    isNodeOfType(eventParameter, "Identifier") &&
    isNodeOfType(receiver, "Identifier") &&
    scopes.symbolFor(eventParameter) === scopes.symbolFor(receiver),
  );
};

const isSafeSameRenderCurrentRead = (
  referenceNode: EsTreeNode,
  accessedPropertyPath: ReadonlyArray<string>,
  targetPropertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
): boolean => {
  if (!pathStartsWith(accessedPropertyPath, targetPropertyPath)) return false;
  if (accessedPropertyPath[targetPropertyPath.length] !== "current") return false;
  const executedFunctions = new Set<EsTreeNode>();
  let enclosingFunction = findEnclosingFunction(referenceNode);
  let eventHandler: EsTreeNode | null = null;
  while (enclosingFunction) {
    executedFunctions.add(enclosingFunction);
    if (isFreshEventHandler(enclosingFunction, environment)) {
      eventHandler = enclosingFunction;
      break;
    }
    const functionExpression = findTransparentExpressionRoot(enclosingFunction);
    const callExpression = functionExpression.parent;
    if (
      !callExpression ||
      !isNodeOfType(callExpression, "CallExpression") ||
      findTransparentExpressionRoot(callExpression.callee) !== functionExpression
    ) {
      return false;
    }
    enclosingFunction = findEnclosingFunction(callExpression);
  }
  if (!eventHandler) return false;
  if (findEnclosingLoop(referenceNode, eventHandler)) return false;
  const provenNonCommittingCalleeRanges: Array<readonly [number, number]> = [];
  let hasPotentialCommit = false;
  walkAst(eventHandler, (node) => {
    if (hasPotentialCommit || !executedFunctions.has(findEnclosingFunction(node) ?? eventHandler)) {
      return;
    }
    if (
      provenNonCommittingCalleeRanges.some(
        ([start, end]) => start <= node.range[0] && end >= node.range[1],
      )
    ) {
      return;
    }
    if (isNodeOfType(node, "AwaitExpression") || isNodeOfType(node, "YieldExpression")) {
      if (node.range[0] < referenceNode.range[0]) hasPotentialCommit = true;
      return;
    }
    if (isNodeOfType(node, "CallExpression")) {
      const callee = findTransparentExpressionRoot(node.callee);
      if (isFunctionLike(callee) && executedFunctions.has(callee)) return;
      if (
        node.callee.range[0] <= referenceNode.range[0] &&
        node.callee.range[1] >= referenceNode.range[1]
      ) {
        return;
      }
      if (isProvenNonCommittingCall(node, eventHandler, environment.scopes)) {
        provenNonCommittingCalleeRanges.push(node.callee.range);
        return;
      }
      if (node.range[0] < referenceNode.range[0]) hasPotentialCommit = true;
      return;
    }
    if (node.range[0] >= referenceNode.range[0]) return;
    if (
      isNodeOfType(node, "MemberExpression") ||
      isNodeOfType(node, "BinaryExpression") ||
      isNodeOfType(node, "UnaryExpression") ||
      isNodeOfType(node, "UpdateExpression") ||
      isNodeOfType(node, "AssignmentExpression") ||
      isNodeOfType(node, "TemplateLiteral") ||
      isNodeOfType(node, "NewExpression") ||
      isNodeOfType(node, "SpreadElement") ||
      (isNodeOfType(node, "VariableDeclarator") &&
        (isNodeOfType(node.id, "ObjectPattern") || isNodeOfType(node.id, "ArrayPattern")))
    ) {
      hasPotentialCommit = true;
    }
  });
  return !hasPotentialCommit;
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

const isIntrinsicCreateElementRefProperty = (
  expression: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
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
    !isProvenReactCall(callExpression, "createElement", environment.scopes)
  ) {
    return false;
  }
  const elementType = callExpression.arguments[0];
  return Boolean(
    elementType &&
    !isNodeOfType(elementType, "SpreadElement") &&
    isNodeOfType(elementType, "Literal") &&
    typeof elementType.value === "string",
  );
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
  if (isProvenIntrinsicJsxElement(openingElement, environment.scopes)) {
    return attributeName === "ref" && propertyPath.length === 0;
  }
  if (
    attributeName === "ref" &&
    propertyPath.length === 0 &&
    isProvenClassComponentIdentifier(openingElement.name, environment, state)
  ) {
    return true;
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
  const inlineCallee = findTransparentExpressionRoot(callExpression.callee);
  if (isFunctionLike(inlineCallee)) {
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
    analyzeFunctionInput(resolvedFunction, argumentIndex, propertyPath, state, remainingDepth),
  );
};

const isIntrinsicJsxSpreadRefUse = (
  expression: EsTreeNode,
  propertyPath: ReadonlyArray<string>,
  environment: AnalysisEnvironment,
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
  return isProvenIntrinsicJsxElement(openingElement, environment.scopes);
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
    return true;
  }
  if (isIntrinsicJsxSpreadRefUse(expression, propertyPath, environment)) return true;
  if (isIntrinsicCreateElementRefProperty(expression, propertyPath, environment)) return true;
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
    if (referenceFunction !== bindingFunction) {
      if (
        isInlineIntrinsicRefCurrentWrite(
          reference.identifier,
          memberAccess.propertyPath,
          valuePath.propertyPath,
          valuePath.environment,
        )
      ) {
        return true;
      }
      if (reference.flag !== "read") return false;
      return isSafeSameRenderCurrentRead(
        reference.identifier,
        memberAccess.propertyPath,
        valuePath.propertyPath,
        valuePath.environment,
      );
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
    environmentsByProgram: new WeakMap([[program, environment]]),
  };
  const ownedValue = findOwnedSymbolValue(createRefCall, [], environment);
  return ownedValue
    ? analyzeSymbolValuePath(ownedValue, state, CREATE_REF_PROP_FLOW_MAX_DEPTH)
    : analyzeValueUse(createRefCall, [], environment, state, CREATE_REF_PROP_FLOW_MAX_DEPTH);
};
