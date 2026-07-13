import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { findNodeAtOffset } from "../../utils/find-node-at-offset.js";
import {
  bindingNameHasIdentifier,
  getScriptKind,
  getStaticPropertyName,
  getUtf16Offset,
  isIdentifierShadowedByLocalBinding,
  unwrapExpression,
} from "./resolve-use-call-binding.js";

interface OxlintSpan {
  readonly offset: number;
}

interface OxlintLabel {
  readonly span: OxlintSpan;
}

interface OxlintDiagnosticCandidate {
  readonly code: string;
  readonly filename: string;
  readonly labels: readonly OxlintLabel[];
}

interface StateSelectionAnalysis {
  readonly isStable: boolean;
  readonly usesCapability: boolean;
}

const SET_STATE_IN_EFFECT_CODE = "react-hooks-js(set-state-in-effect)";
const MEDIA_CAPABILITY_METHOD = "canPlayType";
const VIDEO_ELEMENT_NAME = "video";
const SUPPRESS_DECISION = "suppress";
const UNPROVEN_DIAGNOSTIC_DECISION = "unproven-diagnostic";
const UNPROVEN_EFFECT_DECISION = "unproven-effect";
const UNPROVEN_STATE_SELECTION_DECISION = "unproven-state-selection";

const findDeclarationInStatements = (
  statements: ts.NodeArray<ts.Statement>,
  name: string,
  referencePosition: number,
): ts.Declaration | null => {
  let matchedDeclaration: ts.Declaration | null = null;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          bindingNameHasIdentifier(declaration.name, name) &&
          declaration.getStart() < referencePosition
        ) {
          matchedDeclaration = declaration;
        }
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) {
      matchedDeclaration = statement;
      continue;
    }
    if (ts.isImportEqualsDeclaration(statement) && statement.name.text === name) {
      return statement;
    }
    if (
      ts.isModuleDeclaration(statement) &&
      ts.isIdentifier(statement.name) &&
      statement.name.text === name
    ) {
      return statement;
    }
    if (ts.isImportDeclaration(statement) && statement.importClause) {
      const importClause = statement.importClause;
      if (importClause.name?.text === name) return importClause;
      const namedBindings = importClause.namedBindings;
      if (
        namedBindings &&
        ts.isNamespaceImport(namedBindings) &&
        namedBindings.name.text === name
      ) {
        return namedBindings;
      }
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        const specifier = namedBindings.elements.find((element) => element.name.text === name);
        if (specifier) return specifier;
      }
    }
  }
  return matchedDeclaration;
};

const findLoopDeclaration = (node: ts.Node, name: string): ts.VariableDeclaration | null => {
  if (!ts.isForStatement(node) && !ts.isForInStatement(node) && !ts.isForOfStatement(node)) {
    return null;
  }
  const initializer = node.initializer;
  if (!initializer || !ts.isVariableDeclarationList(initializer)) return null;
  return (
    initializer.declarations.find((declaration) =>
      bindingNameHasIdentifier(declaration.name, name),
    ) ?? null
  );
};

const findVisibleDeclaration = (identifier: ts.Identifier): ts.Declaration | null => {
  let currentNode: ts.Node | undefined = identifier.parent;
  while (currentNode) {
    const loopDeclaration = findLoopDeclaration(currentNode, identifier.text);
    if (loopDeclaration) return loopDeclaration;
    if (ts.isBlock(currentNode) || ts.isSourceFile(currentNode)) {
      const declaration = findDeclarationInStatements(
        currentNode.statements,
        identifier.text,
        identifier.getStart(),
      );
      if (declaration) return declaration;
    }
    if (ts.isFunctionLike(currentNode)) {
      const parameter = currentNode.parameters.find((candidate) =>
        bindingNameHasIdentifier(candidate.name, identifier.text),
      );
      if (parameter) return parameter;
    }
    if (
      ts.isCatchClause(currentNode) &&
      currentNode.variableDeclaration &&
      bindingNameHasIdentifier(currentNode.variableDeclaration.name, identifier.text)
    ) {
      return currentNode.variableDeclaration;
    }
    currentNode = currentNode.parent;
  }
  return null;
};

const isConstVariableDeclaration = (
  declaration: ts.Declaration,
): declaration is ts.VariableDeclaration =>
  ts.isVariableDeclaration(declaration) &&
  ts.isVariableDeclarationList(declaration.parent) &&
  Boolean(declaration.parent.flags & ts.NodeFlags.Const);

const getStaticMemberChain = (expression: ts.Expression): string[] | null => {
  const candidate = unwrapExpression(expression);
  if (ts.isIdentifier(candidate)) return [candidate.text];
  if (ts.isPropertyAccessExpression(candidate)) {
    const receiverChain = getStaticMemberChain(candidate.expression);
    return receiverChain ? [...receiverChain, candidate.name.text] : null;
  }
  if (
    ts.isElementAccessExpression(candidate) &&
    candidate.argumentExpression &&
    (ts.isStringLiteral(candidate.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(candidate.argumentExpression))
  ) {
    const receiverChain = getStaticMemberChain(candidate.expression);
    return receiverChain ? [...receiverChain, candidate.argumentExpression.text] : null;
  }
  return null;
};

const getOuterMemberExpression = (identifier: ts.Identifier): ts.Expression => {
  let currentExpression: ts.Expression = identifier;
  while (
    (ts.isPropertyAccessExpression(currentExpression.parent) ||
      ts.isElementAccessExpression(currentExpression.parent)) &&
    currentExpression.parent.expression === currentExpression
  ) {
    currentExpression = currentExpression.parent;
  }
  return currentExpression;
};

const isDirectDocumentCreateElementCall = (expression: ts.Expression): boolean => {
  const memberChain = getStaticMemberChain(expression);
  return (
    memberChain?.length === 2 &&
    memberChain[0] === "document" &&
    memberChain[1] === "createElement" &&
    ts.isCallExpression(expression.parent) &&
    expression.parent.expression === expression
  );
};

const hasUntrustedCapabilityGlobalReference = (sourceFile: ts.SourceFile): boolean => {
  let hasUntrustedReference = false;
  const visit = (node: ts.Node): void => {
    if (hasUntrustedReference) return;
    if (
      ts.isIdentifier(node) &&
      (node.text === "document" || node.text === "HTMLMediaElement") &&
      findVisibleDeclaration(node) === null &&
      !isIdentifierShadowedByLocalBinding(node, sourceFile)
    ) {
      const memberExpression = getOuterMemberExpression(node);
      if (
        (node.text === "document" && !isDirectDocumentCreateElementCall(memberExpression)) ||
        (node.text === "HTMLMediaElement" &&
          getStaticMemberChain(memberExpression)?.[1] === "prototype")
      ) {
        hasUntrustedReference = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hasUntrustedReference;
};

const getOuterTransparentExpression = (identifier: ts.Identifier): ts.Expression => {
  let currentExpression: ts.Expression = identifier;
  while (
    (ts.isParenthesizedExpression(currentExpression.parent) ||
      ts.isAsExpression(currentExpression.parent) ||
      ts.isTypeAssertionExpression(currentExpression.parent) ||
      ts.isNonNullExpression(currentExpression.parent) ||
      ts.isSatisfiesExpression(currentExpression.parent)) &&
    currentExpression.parent.expression === currentExpression
  ) {
    currentExpression = currentExpression.parent;
  }
  return currentExpression;
};

const isAllowedVideoReference = (identifier: ts.Identifier): boolean => {
  const expression = getOuterTransparentExpression(identifier);
  const parent = expression.parent;
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === expression &&
    parent.name.text === MEDIA_CAPABILITY_METHOD &&
    ts.isCallExpression(parent.parent) &&
    parent.parent.expression === parent
  ) {
    return true;
  }
  return ts.isConditionalExpression(parent) && parent.condition === expression;
};

const isJsxTagName = (identifier: ts.Identifier): boolean => {
  const parent = identifier.parent;
  return (
    ((ts.isJsxOpeningElement(parent) || ts.isJsxSelfClosingElement(parent)) &&
      parent.tagName === identifier) ||
    (ts.isJsxClosingElement(parent) && parent.tagName === identifier)
  );
};

const hasOnlyAllowedVideoReferences = (
  sourceFile: ts.SourceFile,
  declaration: ts.VariableDeclaration,
): boolean => {
  if (!ts.isIdentifier(declaration.name)) return false;
  const declarationName = declaration.name.text;
  let hasDisallowedReference = false;
  const visit = (node: ts.Node): void => {
    if (hasDisallowedReference) return;
    if (node === declaration.name) return;
    if (
      ts.isIdentifier(node) &&
      node.text === declarationName &&
      !isJsxTagName(node) &&
      findVisibleDeclaration(node) === declaration &&
      !isAllowedVideoReference(node)
    ) {
      hasDisallowedReference = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return !hasDisallowedReference;
};

const isGlobalDocumentCreateVideoCall = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
): boolean => {
  const candidate = unwrapExpression(expression);
  if (!ts.isCallExpression(candidate) || candidate.arguments.length !== 1) return false;
  const callee = unwrapExpression(candidate.expression);
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "createElement") return false;
  const receiver = unwrapExpression(callee.expression);
  if (!ts.isIdentifier(receiver) || receiver.text !== "document") return false;
  if (hasUntrustedCapabilityGlobalReference(sourceFile)) return false;
  if (
    findVisibleDeclaration(receiver) !== null ||
    isIdentifierShadowedByLocalBinding(receiver, sourceFile)
  ) {
    return false;
  }
  const tagName = unwrapExpression(candidate.arguments[0]);
  return (
    (ts.isStringLiteral(tagName) || ts.isNoSubstitutionTemplateLiteral(tagName)) &&
    tagName.text.toLowerCase() === VIDEO_ELEMENT_NAME
  );
};

const isProvenVideoElement = (expression: ts.Expression, sourceFile: ts.SourceFile): boolean => {
  const candidate = unwrapExpression(expression);
  if (!ts.isIdentifier(candidate)) return false;
  const declaration = findVisibleDeclaration(candidate);
  return Boolean(
    declaration &&
    isConstVariableDeclaration(declaration) &&
    ts.isIdentifier(declaration.name) &&
    declaration.initializer &&
    isGlobalDocumentCreateVideoCall(declaration.initializer, sourceFile) &&
    hasOnlyAllowedVideoReferences(sourceFile, declaration),
  );
};

const isEmptyString = (expression: ts.Expression): boolean => {
  const candidate = unwrapExpression(expression);
  return (
    (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) &&
    candidate.text === ""
  );
};

const isCapabilityComparison = (expression: ts.Expression, sourceFile: ts.SourceFile): boolean => {
  const candidate = unwrapExpression(expression);
  if (!ts.isBinaryExpression(candidate)) return false;
  if (
    candidate.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsToken &&
    candidate.operatorToken.kind !== ts.SyntaxKind.EqualsEqualsEqualsToken &&
    candidate.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsToken &&
    candidate.operatorToken.kind !== ts.SyntaxKind.ExclamationEqualsEqualsToken
  ) {
    return false;
  }
  return (
    (isMediaCapabilityCall(candidate.left, sourceFile) && isEmptyString(candidate.right)) ||
    (isEmptyString(candidate.left) && isMediaCapabilityCall(candidate.right, sourceFile))
  );
};

const isAssignedIdentifier = (node: ts.Node, name: string): boolean => {
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
    node.operatorToken.kind <= ts.SyntaxKind.LastAssignment
  ) {
    let hasAssignedIdentifier = false;
    const visitAssignedValue = (assignedNode: ts.Node): void => {
      if (hasAssignedIdentifier) return;
      if (ts.isIdentifier(assignedNode) && assignedNode.text === name) {
        hasAssignedIdentifier = true;
        return;
      }
      ts.forEachChild(assignedNode, visitAssignedValue);
    };
    visitAssignedValue(node.left);
    if (hasAssignedIdentifier) return true;
  }
  return (
    (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
    ts.isIdentifier(node.operand) &&
    node.operand.text === name
  );
};

const getFunctionBody = (node: ts.Node): ts.ConciseBody | ts.Block | undefined => {
  if (ts.isArrowFunction(node)) return node.body;
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    return node.body;
  }
  return undefined;
};

const isStableBindingPath = (
  bindingName: ts.BindingName,
  identifierName: string,
): boolean | null => {
  if (ts.isIdentifier(bindingName)) {
    return bindingName.text === identifierName ? true : null;
  }
  for (const element of bindingName.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const isNestedPathStable = isStableBindingPath(element.name, identifierName);
    if (isNestedPathStable === null) continue;
    return Boolean(isNestedPathStable && !element.initializer && !element.dotDotDotToken);
  }
  return null;
};

const isParameterNeverAssigned = (
  parameter: ts.ParameterDeclaration,
  identifierName: string,
): boolean => {
  if (
    parameter.initializer ||
    parameter.dotDotDotToken ||
    isStableBindingPath(parameter.name, identifierName) !== true
  ) {
    return false;
  }
  const functionNode = parameter.parent;
  const functionBody = getFunctionBody(functionNode);
  if (!functionBody) return false;
  let hasAssignment = false;
  const visit = (node: ts.Node): void => {
    if (hasAssignment) return;
    if (isAssignedIdentifier(node, identifierName)) {
      hasAssignment = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(functionBody);
  return !hasAssignment;
};

const isStringTypeNode = (typeNode: ts.TypeNode | undefined): boolean => {
  if (!typeNode) return false;
  if (typeNode.kind === ts.SyntaxKind.StringKeyword) return true;
  if (ts.isLiteralTypeNode(typeNode)) return ts.isStringLiteral(typeNode.literal);
  return ts.isUnionTypeNode(typeNode) && typeNode.types.every(isStringTypeNode);
};

const isStringParameterBinding = (
  parameter: ts.ParameterDeclaration,
  identifierName: string,
): boolean => {
  if (ts.isIdentifier(parameter.name)) {
    return parameter.name.text === identifierName && isStringTypeNode(parameter.type);
  }
  if (
    !ts.isObjectBindingPattern(parameter.name) ||
    !parameter.type ||
    !ts.isTypeLiteralNode(parameter.type)
  ) {
    return false;
  }
  const bindingElement = parameter.name.elements.find(
    (element) =>
      ts.isIdentifier(element.name) &&
      element.name.text === identifierName &&
      (!element.propertyName || getStaticPropertyName(element.propertyName) === identifierName),
  );
  if (!bindingElement) return false;
  for (const member of parameter.type.members) {
    if (ts.isPropertySignature(member) && getStaticPropertyName(member.name) === identifierName) {
      return isStringTypeNode(member.type);
    }
  }
  return false;
};

const isStableCapabilityArgument = (expression: ts.Expression): boolean => {
  const candidate = unwrapExpression(expression);
  if (ts.isStringLiteral(candidate) || ts.isNoSubstitutionTemplateLiteral(candidate)) {
    return true;
  }
  if (!ts.isIdentifier(candidate)) return false;
  const declaration = findVisibleDeclaration(candidate);
  return Boolean(
    declaration &&
    ts.isParameter(declaration) &&
    isStringParameterBinding(declaration, candidate.text) &&
    isParameterNeverAssigned(declaration, candidate.text),
  );
};

const isMediaCapabilityCall = (expression: ts.Expression, sourceFile: ts.SourceFile): boolean => {
  const candidate = unwrapExpression(expression);
  if (!ts.isCallExpression(candidate) || candidate.arguments.length !== 1) return false;
  const callee = unwrapExpression(candidate.expression);
  return (
    ts.isPropertyAccessExpression(callee) &&
    callee.name.text === MEDIA_CAPABILITY_METHOD &&
    isProvenVideoElement(callee.expression, sourceFile) &&
    isStableCapabilityArgument(candidate.arguments[0])
  );
};

const analyzeStateSelection = (
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  allowVideoGuard = false,
): StateSelectionAnalysis => {
  const candidate = unwrapExpression(expression);
  if (
    candidate.kind === ts.SyntaxKind.NullKeyword ||
    candidate.kind === ts.SyntaxKind.TrueKeyword ||
    candidate.kind === ts.SyntaxKind.FalseKeyword ||
    ts.isStringLiteral(candidate) ||
    ts.isNoSubstitutionTemplateLiteral(candidate) ||
    ts.isNumericLiteral(candidate)
  ) {
    return { isStable: true, usesCapability: false };
  }
  if (isMediaCapabilityCall(candidate, sourceFile)) {
    return { isStable: true, usesCapability: true };
  }
  if (isCapabilityComparison(candidate, sourceFile)) {
    return { isStable: true, usesCapability: true };
  }
  if (ts.isIdentifier(candidate)) {
    const declaration = findVisibleDeclaration(candidate);
    return {
      isStable: Boolean(
        (declaration &&
          ts.isParameter(declaration) &&
          isParameterNeverAssigned(declaration, candidate.text)) ||
        (allowVideoGuard && isProvenVideoElement(candidate, sourceFile)),
      ),
      usesCapability: false,
    };
  }
  if (ts.isConditionalExpression(candidate)) {
    const condition = analyzeStateSelection(candidate.condition, sourceFile, true);
    const whenTrue = analyzeStateSelection(candidate.whenTrue, sourceFile);
    const whenFalse = analyzeStateSelection(candidate.whenFalse, sourceFile);
    return {
      isStable: condition.isStable && whenTrue.isStable && whenFalse.isStable,
      usesCapability:
        condition.usesCapability || whenTrue.usesCapability || whenFalse.usesCapability,
    };
  }
  return { isStable: false, usesCapability: false };
};

const findEnclosingCallExpression = (node: ts.Node | null): ts.CallExpression | null => {
  let currentNode = node;
  while (currentNode) {
    if (ts.isCallExpression(currentNode)) return currentNode;
    currentNode = currentNode.parent;
  }
  return null;
};

const isReactUseEffectBinding = (identifier: ts.Identifier): boolean => {
  const declaration = findVisibleDeclaration(identifier);
  if (!declaration || !ts.isImportSpecifier(declaration)) return false;
  if ((declaration.propertyName?.text ?? declaration.name.text) !== "useEffect") return false;
  const importDeclaration = declaration.parent.parent.parent;
  return (
    ts.isImportDeclaration(importDeclaration) &&
    ts.isStringLiteral(importDeclaration.moduleSpecifier) &&
    importDeclaration.moduleSpecifier.text === "react"
  );
};

const collectParameterReferences = (expression: ts.Expression): Set<string> => {
  const parameterNames = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isIdentifier(node)) {
      const declaration = findVisibleDeclaration(node);
      if (declaration && ts.isParameter(declaration)) parameterNames.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(expression);
  return parameterNames;
};

const isInsideReactEffectWithCompleteDependencies = (
  stateSetterCall: ts.CallExpression,
  stateSelection: ts.Expression,
): boolean => {
  let currentNode: ts.Node | undefined = stateSetterCall.parent;
  while (currentNode) {
    if (ts.isFunctionLike(currentNode)) {
      const effectCall = currentNode.parent;
      if (
        !ts.isCallExpression(effectCall) ||
        effectCall.arguments[0] !== currentNode ||
        !ts.isIdentifier(effectCall.expression) ||
        effectCall.expression.text !== "useEffect" ||
        !isReactUseEffectBinding(effectCall.expression)
      ) {
        return false;
      }
      const dependencyArray = effectCall.arguments[1];
      if (!dependencyArray || !ts.isArrayLiteralExpression(dependencyArray)) return false;
      const dependencyNames = new Set(
        dependencyArray.elements.flatMap((element) => {
          const dependency = unwrapExpression(element);
          return ts.isIdentifier(dependency) ? [dependency.text] : [];
        }),
      );
      return [...collectParameterReferences(stateSelection)].every((name) =>
        dependencyNames.has(name),
      );
    }
    currentNode = currentNode.parent;
  }
  return false;
};

export const getBrowserCapabilityStateSyncDecision = (
  diagnostic: OxlintDiagnosticCandidate,
  rootDirectory: string,
): string => {
  if (diagnostic.code !== SET_STATE_IN_EFFECT_CODE) return UNPROVEN_DIAGNOSTIC_DECISION;
  const primaryLabel = diagnostic.labels[0];
  if (!primaryLabel) return UNPROVEN_DIAGNOSTIC_DECISION;
  const absolutePath = path.isAbsolute(diagnostic.filename)
    ? diagnostic.filename
    : path.join(rootDirectory, diagnostic.filename);
  let sourceText: string;
  try {
    sourceText = fs.readFileSync(absolutePath, "utf8");
  } catch {
    return UNPROVEN_DIAGNOSTIC_DECISION;
  }
  const sourceFile = ts.createSourceFile(
    absolutePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    getScriptKind(absolutePath),
  );
  const targetOffset = getUtf16Offset(sourceText, primaryLabel.span.offset);
  const callExpression = findEnclosingCallExpression(findNodeAtOffset(sourceFile, targetOffset));
  const stateSelection = callExpression?.arguments[0];
  if (!stateSelection) return UNPROVEN_DIAGNOSTIC_DECISION;
  if (!isInsideReactEffectWithCompleteDependencies(callExpression, stateSelection)) {
    return UNPROVEN_EFFECT_DECISION;
  }
  const analysis = analyzeStateSelection(stateSelection, sourceFile);
  return analysis.isStable && analysis.usesCapability
    ? SUPPRESS_DECISION
    : UNPROVEN_STATE_SELECTION_DECISION;
};

export const shouldSuppressBrowserCapabilityStateSync = (
  diagnostic: OxlintDiagnosticCandidate,
  rootDirectory: string,
): boolean =>
  getBrowserCapabilityStateSyncDecision(diagnostic, rootDirectory) === SUPPRESS_DECISION;
