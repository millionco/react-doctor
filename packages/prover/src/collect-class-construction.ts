import ts from "typescript";
import { KNOWN_IMPURE_RENDER_CALLS } from "./constants.js";
import { getCallName } from "./get-call-name.js";
import { getRootIdentifier } from "./get-root-identifier.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";
import {
  ReactClassConstructionIssueKind,
  ReactClassConstructionIssueStatus,
  ReactClassStateInitializationKind,
  ReactClassStateInitializationRequirement,
} from "./types.js";
import { unwrapTypescriptExpression } from "./unwrap-typescript-expression.js";
import type { ReactAnalysisContext } from "./types.js";
import { getClassMethodDeclaration } from "./utils/get-class-method-declaration.js";
import { getResolvedSymbol } from "./utils/get-resolved-symbol.js";
import { getStaticAccessMemberName } from "./utils/get-static-access-member-name.js";
import { getStaticPropertyName } from "./utils/get-static-property-name.js";
import { isAssignmentOperator } from "./utils/is-assignment-operator.js";
import { isPlatformDeclarationSymbol } from "./utils/is-platform-declaration-symbol.js";
import { isReactSetStateCall } from "./utils/is-react-set-state-call.js";

export interface ClassConstructionIssueDescriptor {
  kind: ReactClassConstructionIssueKind;
  node: ts.Node;
  status: ReactClassConstructionIssueStatus;
}

export interface ClassConstructionDescriptor {
  constructorDeclaration: ts.ConstructorDeclaration | null;
  initializationKind: ReactClassStateInitializationKind;
  initializationNode: ts.Node | null;
  issues: ReadonlyArray<ClassConstructionIssueDescriptor>;
  representedMembers: ReadonlyArray<ts.ClassElement>;
  stateRequirement: ReactClassStateInitializationRequirement;
}

const KNOWN_CONSTRUCTION_SIDE_EFFECT_CALLS = new Set([
  "console.error",
  "console.info",
  "console.log",
  "console.warn",
  "document.write",
]);

const KNOWN_CONSTRUCTION_SIDE_EFFECT_CALL_MEMBERS = new Set([
  "addEventListener",
  "alert",
  "clear",
  "dispatchEvent",
  "fetch",
  "queueMicrotask",
  "removeEventListener",
  "removeItem",
  "requestAnimationFrame",
  "setInterval",
  "setItem",
  "setTimeout",
  "write",
]);

const isKnownConstructionSideEffectCall = (
  callExpression: ts.CallExpression,
  context: ReactAnalysisContext,
): boolean => {
  const callName = getCallName(callExpression);
  const callSymbol = getResolvedSymbol(callExpression.expression, context.typeChecker);
  if (!callName || !callSymbol || !isPlatformDeclarationSymbol(callSymbol)) return false;
  if (
    KNOWN_IMPURE_RENDER_CALLS.has(callName) ||
    KNOWN_CONSTRUCTION_SIDE_EFFECT_CALLS.has(callName)
  ) {
    return true;
  }
  const finalCallName = callName.split(".").at(-1);
  return Boolean(finalCallName && KNOWN_CONSTRUCTION_SIDE_EFFECT_CALL_MEMBERS.has(finalCallName));
};

const isDirectThisStateAccess = (expression: ts.Expression): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return Boolean(
    (ts.isPropertyAccessExpression(unwrappedExpression) ||
      ts.isElementAccessExpression(unwrappedExpression)) &&
    unwrappedExpression.expression.kind === ts.SyntaxKind.ThisKeyword &&
    getStaticAccessMemberName(unwrappedExpression) === "state",
  );
};

const getDirectThisPropertyAccess = (
  expression: ts.Expression,
): ts.PropertyAccessExpression | ts.ElementAccessExpression | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return (ts.isPropertyAccessExpression(unwrappedExpression) ||
    ts.isElementAccessExpression(unwrappedExpression)) &&
    unwrappedExpression.expression.kind === ts.SyntaxKind.ThisKeyword
    ? unwrappedExpression
    : null;
};

const isStateRead = (expression: ts.Expression): boolean => {
  if (!isDirectThisStateAccess(expression)) return false;
  const parentNode = expression.parent;
  return !(
    ts.isBinaryExpression(parentNode) &&
    parentNode.left === expression &&
    parentNode.operatorToken.kind === ts.SyntaxKind.EqualsToken
  );
};

const containsStateRead = (rootNode: ts.Node, includeNestedFunctions = false): boolean => {
  let hasStateRead = false;
  const visit = (node: ts.Node): void => {
    if (hasStateRead) return;
    if (!includeNestedFunctions && node !== rootNode && isFunctionBoundary(node)) return;
    if (ts.isExpression(node) && isStateRead(node)) {
      hasStateRead = true;
      return;
    }
    node.forEachChild(visit);
  };
  rootNode.forEachChild(visit);
  return hasStateRead;
};

const hasMountUpdaterStateDereference = (
  classNode: ts.ClassDeclaration,
  context: ReactAnalysisContext,
): boolean => {
  const mountMethod = getClassMethodDeclaration(classNode, "componentDidMount");
  if (!mountMethod) return false;
  let hasStateDereference = false;
  const visit = (node: ts.Node): void => {
    if (hasStateDereference) return;
    if (node !== mountMethod && isFunctionBoundary(node)) return;
    if (ts.isCallExpression(node) && isReactSetStateCall(node, context)) {
      const updaterExpression = node.arguments[0];
      const updaterFunction = updaterExpression
        ? resolveFunction(updaterExpression, context.typeChecker)
        : null;
      const previousStateParameter = updaterFunction?.parameters[0];
      if (!updaterFunction || !previousStateParameter) return;
      if (!ts.isIdentifier(previousStateParameter.name)) {
        hasStateDereference = true;
        return;
      }
      const previousStateSymbol = context.typeChecker.getSymbolAtLocation(
        previousStateParameter.name,
      );
      const visitUpdater = (updaterNode: ts.Node): void => {
        if (hasStateDereference) return;
        if (updaterNode !== updaterFunction && isFunctionBoundary(updaterNode)) return;
        if (
          (ts.isPropertyAccessExpression(updaterNode) ||
            ts.isElementAccessExpression(updaterNode)) &&
          context.typeChecker.getSymbolAtLocation(getRootIdentifier(updaterNode) ?? updaterNode) ===
            previousStateSymbol
        ) {
          hasStateDereference = true;
          return;
        }
        updaterNode.forEachChild(visitUpdater);
      };
      updaterFunction.forEachChild(visitUpdater);
      return;
    }
    node.forEachChild(visit);
  };
  mountMethod.forEachChild(visit);
  return hasStateDereference;
};

const getStateRequirement = (
  classNode: ts.ClassDeclaration,
  renderMethod: ts.MethodDeclaration,
  context: ReactAnalysisContext,
): ReactClassStateInitializationRequirement => {
  if (containsStateRead(renderMethod) || hasMountUpdaterStateDereference(classNode, context)) {
    return ReactClassStateInitializationRequirement.Required;
  }
  const hasRequiredLifecycleRead = classNode.members.some(
    (member) =>
      ts.isMethodDeclaration(member) &&
      ["componentDidMount", "componentDidUpdate", "componentWillUnmount"].includes(
        getStaticPropertyName(member.name) ?? "",
      ) &&
      containsStateRead(member),
  );
  if (hasRequiredLifecycleRead) return ReactClassStateInitializationRequirement.Required;
  return classNode.members.some(
    (member) => member !== renderMethod && containsStateRead(member, true),
  )
    ? ReactClassStateInitializationRequirement.Conditional
    : ReactClassStateInitializationRequirement.None;
};

const addIssue = (
  issues: ClassConstructionIssueDescriptor[],
  node: ts.Node,
  kind: ReactClassConstructionIssueKind,
  status: ReactClassConstructionIssueStatus,
): void => {
  issues.push({ kind, node, status });
};

const isParameterReference = (expression: ts.Expression, context: ReactAnalysisContext): boolean =>
  ts.isIdentifier(expression) &&
  Boolean(
    context.typeChecker
      .getSymbolAtLocation(expression)
      ?.declarations?.some((declaration) => ts.isParameter(declaration)),
  );

const isThisPropsExpression = (expression: ts.Expression): boolean => {
  let currentExpression = unwrapTypescriptExpression(expression);
  const members: string[] = [];
  while (
    ts.isPropertyAccessExpression(currentExpression) ||
    ts.isElementAccessExpression(currentExpression)
  ) {
    const memberName = getStaticAccessMemberName(currentExpression);
    if (!memberName) return false;
    members.unshift(memberName);
    currentExpression = unwrapTypescriptExpression(currentExpression.expression);
  }
  return currentExpression.kind === ts.SyntaxKind.ThisKeyword && members[0] === "props";
};

const collectPureExpressionIssues = (
  expression: ts.Expression,
  context: ReactAnalysisContext,
  pureLocalSymbols: ReadonlySet<ts.Symbol> = new Set(),
): ReadonlyArray<ClassConstructionIssueDescriptor> => {
  const issues: ClassConstructionIssueDescriptor[] = [];
  const visit = (currentExpression: ts.Expression): void => {
    const unwrappedExpression = unwrapTypescriptExpression(currentExpression);
    if (
      ts.isStringLiteralLike(unwrappedExpression) ||
      ts.isNumericLiteral(unwrappedExpression) ||
      ts.isBigIntLiteral(unwrappedExpression) ||
      unwrappedExpression.kind === ts.SyntaxKind.TrueKeyword ||
      unwrappedExpression.kind === ts.SyntaxKind.FalseKeyword ||
      unwrappedExpression.kind === ts.SyntaxKind.NullKeyword
    ) {
      return;
    }
    if (ts.isIdentifier(unwrappedExpression)) {
      const symbol = context.typeChecker.getSymbolAtLocation(unwrappedExpression);
      if (symbol && pureLocalSymbols.has(symbol)) return;
      if (
        unwrappedExpression.text === "undefined" ||
        unwrappedExpression.text === "NaN" ||
        unwrappedExpression.text === "Infinity"
      ) {
        return;
      }
      if (isParameterReference(unwrappedExpression, context)) return;
      addIssue(
        issues,
        unwrappedExpression,
        ReactClassConstructionIssueKind.UnsupportedInitializer,
        ReactClassConstructionIssueStatus.Unknown,
      );
      return;
    }
    if (ts.isPropertyAccessExpression(unwrappedExpression)) {
      if (isThisPropsExpression(unwrappedExpression)) return;
      const rootIdentifier = getRootIdentifier(unwrappedExpression);
      if (rootIdentifier && isParameterReference(rootIdentifier, context)) return;
      addIssue(
        issues,
        unwrappedExpression,
        ReactClassConstructionIssueKind.UnsupportedInitializer,
        ReactClassConstructionIssueStatus.Unknown,
      );
      return;
    }
    if (ts.isElementAccessExpression(unwrappedExpression)) {
      visit(unwrappedExpression.expression);
      if (unwrappedExpression.argumentExpression) visit(unwrappedExpression.argumentExpression);
      return;
    }
    if (ts.isObjectLiteralExpression(unwrappedExpression)) {
      for (const property of unwrappedExpression.properties) {
        if (ts.isPropertyAssignment(property)) {
          if (ts.isComputedPropertyName(property.name)) visit(property.name.expression);
          visit(property.initializer);
        } else if (ts.isShorthandPropertyAssignment(property)) {
          visit(property.name);
        } else if (ts.isSpreadAssignment(property)) {
          addIssue(
            issues,
            property,
            ReactClassConstructionIssueKind.UnsupportedInitializer,
            ReactClassConstructionIssueStatus.Unknown,
          );
        } else {
          addIssue(
            issues,
            property,
            ReactClassConstructionIssueKind.UnsupportedInitializer,
            ReactClassConstructionIssueStatus.Unknown,
          );
        }
      }
      return;
    }
    if (ts.isArrayLiteralExpression(unwrappedExpression)) {
      for (const element of unwrappedExpression.elements) {
        if (ts.isSpreadElement(element)) {
          addIssue(
            issues,
            element,
            ReactClassConstructionIssueKind.UnsupportedInitializer,
            ReactClassConstructionIssueStatus.Unknown,
          );
        } else {
          visit(element);
        }
      }
      return;
    }
    if (ts.isArrowFunction(unwrappedExpression) || ts.isFunctionExpression(unwrappedExpression)) {
      return;
    }
    if (ts.isTemplateExpression(unwrappedExpression)) {
      for (const templateSpan of unwrappedExpression.templateSpans) visit(templateSpan.expression);
      return;
    }
    if (ts.isNoSubstitutionTemplateLiteral(unwrappedExpression)) return;
    if (ts.isConditionalExpression(unwrappedExpression)) {
      visit(unwrappedExpression.condition);
      visit(unwrappedExpression.whenTrue);
      visit(unwrappedExpression.whenFalse);
      return;
    }
    if (ts.isBinaryExpression(unwrappedExpression)) {
      if (isAssignmentOperator(unwrappedExpression.operatorToken.kind)) {
        addIssue(
          issues,
          unwrappedExpression,
          ReactClassConstructionIssueKind.SideEffect,
          ReactClassConstructionIssueStatus.Violated,
        );
        return;
      }
      visit(unwrappedExpression.left);
      visit(unwrappedExpression.right);
      return;
    }
    if (
      ts.isPrefixUnaryExpression(unwrappedExpression) ||
      ts.isPostfixUnaryExpression(unwrappedExpression)
    ) {
      if (
        unwrappedExpression.operator === ts.SyntaxKind.PlusPlusToken ||
        unwrappedExpression.operator === ts.SyntaxKind.MinusMinusToken
      ) {
        addIssue(
          issues,
          unwrappedExpression,
          ReactClassConstructionIssueKind.SideEffect,
          ReactClassConstructionIssueStatus.Violated,
        );
      } else {
        visit(unwrappedExpression.operand);
      }
      return;
    }
    if (ts.isCallExpression(unwrappedExpression)) {
      const isKnownSideEffect = isKnownConstructionSideEffectCall(unwrappedExpression, context);
      addIssue(
        issues,
        unwrappedExpression,
        isKnownSideEffect
          ? ReactClassConstructionIssueKind.SideEffect
          : ReactClassConstructionIssueKind.UnsupportedInitializer,
        isKnownSideEffect
          ? ReactClassConstructionIssueStatus.Violated
          : ReactClassConstructionIssueStatus.Unknown,
      );
      return;
    }
    if (ts.isNewExpression(unwrappedExpression)) {
      const constructorSymbol = getResolvedSymbol(
        unwrappedExpression.expression,
        context.typeChecker,
      );
      const isPlatformDate =
        constructorSymbol?.getName() === "Date" && isPlatformDeclarationSymbol(constructorSymbol);
      addIssue(
        issues,
        unwrappedExpression,
        isPlatformDate
          ? ReactClassConstructionIssueKind.SideEffect
          : ReactClassConstructionIssueKind.UnsupportedInitializer,
        isPlatformDate
          ? ReactClassConstructionIssueStatus.Violated
          : ReactClassConstructionIssueStatus.Unknown,
      );
      return;
    }
    addIssue(
      issues,
      unwrappedExpression,
      ReactClassConstructionIssueKind.UnsupportedInitializer,
      ReactClassConstructionIssueStatus.Unknown,
    );
  };
  visit(expression);
  return issues;
};

const getMethodBindingName = (
  expression: ts.Expression,
  context: ReactAnalysisContext,
): string | null => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  if (
    !ts.isBinaryExpression(unwrappedExpression) ||
    unwrappedExpression.operatorToken.kind !== ts.SyntaxKind.EqualsToken ||
    !getDirectThisPropertyAccess(unwrappedExpression.left)
  ) {
    return null;
  }
  const leftProperty = getDirectThisPropertyAccess(unwrappedExpression.left);
  if (!leftProperty) return null;
  const rightExpression = unwrapTypescriptExpression(unwrappedExpression.right);
  if (
    !ts.isCallExpression(rightExpression) ||
    rightExpression.arguments.length !== 1 ||
    rightExpression.arguments[0]?.kind !== ts.SyntaxKind.ThisKeyword
  ) {
    return null;
  }
  const callTarget = unwrapTypescriptExpression(rightExpression.expression);
  if (
    !ts.isPropertyAccessExpression(callTarget) ||
    callTarget.name.text !== "bind" ||
    !getDirectThisPropertyAccess(callTarget.expression)
  ) {
    return null;
  }
  const rightProperty = getDirectThisPropertyAccess(callTarget.expression);
  if (!rightProperty) return null;
  const leftName = getStaticAccessMemberName(leftProperty);
  const rightName = getStaticAccessMemberName(rightProperty);
  return leftName === rightName &&
    isPlatformDeclarationSymbol(getResolvedSymbol(callTarget.name, context.typeChecker))
    ? leftName
    : null;
};

const isSuperCallStatement = (statement: ts.Statement): boolean =>
  Boolean(
    ts.isExpressionStatement(statement) &&
    ts.isCallExpression(statement.expression) &&
    statement.expression.expression.kind === ts.SyntaxKind.SuperKeyword,
  );

const isThisSetStateCall = (expression: ts.Expression, context: ReactAnalysisContext): boolean => {
  const unwrappedExpression = unwrapTypescriptExpression(expression);
  return ts.isCallExpression(unwrappedExpression)
    ? isReactSetStateCall(unwrappedExpression, context)
    : false;
};

const hasValidSuperCall = (
  constructorDeclaration: ts.ConstructorDeclaration,
  context: ReactAnalysisContext,
): boolean => {
  const firstStatement = constructorDeclaration.body?.statements[0];
  if (
    !firstStatement ||
    !ts.isExpressionStatement(firstStatement) ||
    !isSuperCallStatement(firstStatement)
  ) {
    return false;
  }
  const superCall = firstStatement.expression;
  if (!ts.isCallExpression(superCall)) return false;
  if (constructorDeclaration.parameters.length === 0) return superCall.arguments.length === 0;
  const firstParameter = constructorDeclaration.parameters[0];
  return Boolean(
    firstParameter &&
    ts.isIdentifier(firstParameter.name) &&
    superCall.arguments.length === 1 &&
    ts.isIdentifier(superCall.arguments[0]) &&
    context.typeChecker.getSymbolAtLocation(firstParameter.name) ===
      context.typeChecker.getSymbolAtLocation(superCall.arguments[0]),
  );
};

const collectConstructorStateAssignments = (
  constructorDeclaration: ts.ConstructorDeclaration,
): ReadonlyArray<ts.BinaryExpression> => {
  const assignments: ts.BinaryExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== constructorDeclaration && isFunctionBoundary(node)) return;
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isExpression(node.left) &&
      isDirectThisStateAccess(node.left)
    ) {
      assignments.push(node);
      return;
    }
    node.forEachChild(visit);
  };
  constructorDeclaration.body?.forEachChild(visit);
  return assignments;
};

const collectPureConstructorLocalSymbols = (
  constructorDeclaration: ts.ConstructorDeclaration | null,
  context: ReactAnalysisContext,
): ReadonlySet<ts.Symbol> => {
  const pureLocalSymbols = new Set<ts.Symbol>();
  for (const statement of constructorDeclaration?.body?.statements ?? []) {
    if (
      !ts.isVariableStatement(statement) ||
      !(statement.declarationList.flags & ts.NodeFlags.Const)
    ) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const declarationIssues = collectPureExpressionIssues(
        declaration.initializer,
        context,
        pureLocalSymbols,
      );
      const symbol = context.typeChecker.getSymbolAtLocation(declaration.name);
      if (declarationIssues.length === 0 && symbol) pureLocalSymbols.add(symbol);
    }
  }
  return pureLocalSymbols;
};

export const collectClassConstruction = (
  classNode: ts.ClassDeclaration,
  renderMethod: ts.MethodDeclaration,
  context: ReactAnalysisContext,
): ClassConstructionDescriptor => {
  const issues: ClassConstructionIssueDescriptor[] = [];
  const constructorDeclaration = classNode.members.find(ts.isConstructorDeclaration) ?? null;
  const instanceFields = classNode.members.filter(
    (member): member is ts.PropertyDeclaration =>
      ts.isPropertyDeclaration(member) &&
      !member.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.StaticKeyword),
  );
  const stateFields = instanceFields.filter(
    (member) => getStaticPropertyName(member.name) === "state",
  );
  const constructorStateAssignments = constructorDeclaration
    ? collectConstructorStateAssignments(constructorDeclaration)
    : [];
  const constructorStateAssignmentSet = new Set(constructorStateAssignments);
  const pureLocalSymbols = collectPureConstructorLocalSymbols(constructorDeclaration, context);
  const boundMethodNames = new Set<string>();
  const stateRequirement = getStateRequirement(classNode, renderMethod, context);
  const initializationNodes: ts.Node[] = [...stateFields, ...constructorStateAssignments];
  let initializationKind = ReactClassStateInitializationKind.None;
  if (stateFields.length === 1 && constructorStateAssignments.length === 0) {
    initializationKind = ReactClassStateInitializationKind.PublicField;
  } else if (stateFields.length === 0 && constructorStateAssignments.length === 1) {
    initializationKind = ReactClassStateInitializationKind.ConstructorAssignment;
  } else if (initializationNodes.length > 1) {
    initializationKind = ReactClassStateInitializationKind.Multiple;
    addIssue(
      issues,
      initializationNodes[1] ?? classNode,
      ReactClassConstructionIssueKind.MultipleStateInitializations,
      ReactClassConstructionIssueStatus.Unknown,
    );
  }
  const initializer = stateFields[0]?.initializer ?? constructorStateAssignments[0]?.right ?? null;
  if (initializer) {
    const unwrappedInitializer = unwrapTypescriptExpression(initializer);
    if (!ts.isObjectLiteralExpression(unwrappedInitializer)) {
      const initializerType = context.typeChecker.getTypeAtLocation(initializer);
      const isDefinitelyInvalid = Boolean(
        initializerType.flags &
        (ts.TypeFlags.StringLike |
          ts.TypeFlags.NumberLike |
          ts.TypeFlags.BooleanLike |
          ts.TypeFlags.BigIntLike |
          ts.TypeFlags.Null |
          ts.TypeFlags.Undefined),
      );
      addIssue(
        issues,
        initializer,
        isDefinitelyInvalid
          ? ReactClassConstructionIssueKind.InvalidStateValue
          : ReactClassConstructionIssueKind.UnsupportedInitializer,
        isDefinitelyInvalid
          ? ReactClassConstructionIssueStatus.Violated
          : ReactClassConstructionIssueStatus.Unknown,
      );
    } else {
      issues.push(...collectPureExpressionIssues(unwrappedInitializer, context, pureLocalSymbols));
    }
  } else if (initializationNodes.length > 0) {
    addIssue(
      issues,
      initializationNodes[0] ?? classNode,
      ReactClassConstructionIssueKind.InvalidStateValue,
      ReactClassConstructionIssueStatus.Violated,
    );
  } else if (stateRequirement !== ReactClassStateInitializationRequirement.None) {
    addIssue(
      issues,
      renderMethod,
      ReactClassConstructionIssueKind.MissingStateInitialization,
      stateRequirement === ReactClassStateInitializationRequirement.Required
        ? ReactClassConstructionIssueStatus.Violated
        : ReactClassConstructionIssueStatus.Unknown,
    );
  }
  for (const instanceField of instanceFields) {
    if (
      !getStaticPropertyName(instanceField.name) ||
      instanceField.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.AccessorKeyword)
    ) {
      addIssue(
        issues,
        instanceField,
        ReactClassConstructionIssueKind.UnsupportedInitializer,
        ReactClassConstructionIssueStatus.Unknown,
      );
    }
    if (getStaticPropertyName(instanceField.name) === "state" || !instanceField.initializer) {
      continue;
    }
    issues.push(
      ...collectPureExpressionIssues(instanceField.initializer, context, pureLocalSymbols),
    );
  }
  if (constructorDeclaration) {
    if (!constructorDeclaration.body || !hasValidSuperCall(constructorDeclaration, context)) {
      addIssue(
        issues,
        constructorDeclaration,
        ReactClassConstructionIssueKind.InvalidSuperCall,
        ReactClassConstructionIssueStatus.Violated,
      );
    }
    for (const statement of constructorDeclaration.body?.statements ?? []) {
      if (isSuperCallStatement(statement)) continue;
      if (
        ts.isExpressionStatement(statement) &&
        ts.isBinaryExpression(statement.expression) &&
        constructorStateAssignmentSet.has(statement.expression)
      ) {
        continue;
      }
      if (ts.isVariableStatement(statement)) {
        const declarationIssues = statement.declarationList.declarations.flatMap((declaration) =>
          declaration.initializer
            ? collectPureExpressionIssues(declaration.initializer, context, pureLocalSymbols)
            : [],
        );
        if (declarationIssues.length > 0) {
          issues.push(...declarationIssues);
          continue;
        }
      }
      if (
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.every((declaration) => {
          if (!ts.isIdentifier(declaration.name)) return false;
          const symbol = context.typeChecker.getSymbolAtLocation(declaration.name);
          return Boolean(symbol && pureLocalSymbols.has(symbol));
        })
      ) {
        continue;
      }
      if (ts.isExpressionStatement(statement)) {
        const boundMethodName = getMethodBindingName(statement.expression, context);
        if (boundMethodName) {
          boundMethodNames.add(boundMethodName);
          continue;
        }
      }
      if (
        ts.isExpressionStatement(statement) &&
        isThisSetStateCall(statement.expression, context)
      ) {
        addIssue(
          issues,
          statement,
          ReactClassConstructionIssueKind.SetStateCall,
          ReactClassConstructionIssueStatus.Violated,
        );
        continue;
      }
      if (
        ts.isExpressionStatement(statement) &&
        (ts.isCallExpression(unwrapTypescriptExpression(statement.expression)) ||
          ts.isNewExpression(unwrapTypescriptExpression(statement.expression)))
      ) {
        issues.push(
          ...collectPureExpressionIssues(statement.expression, context, pureLocalSymbols),
        );
        continue;
      }
      addIssue(
        issues,
        statement,
        ReactClassConstructionIssueKind.UnsupportedConstructorStatement,
        ReactClassConstructionIssueStatus.Unknown,
      );
    }
  }
  return {
    constructorDeclaration,
    initializationKind,
    initializationNode: initializationNodes[0] ?? null,
    issues,
    representedMembers: [
      ...(constructorDeclaration ? [constructorDeclaration] : []),
      ...instanceFields,
      ...[...boundMethodNames].flatMap((methodName) => {
        const method = getClassMethodDeclaration(classNode, methodName);
        return method ? [method] : [];
      }),
    ],
    stateRequirement,
  };
};
