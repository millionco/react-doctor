import ts from "typescript";
import { collectBindingIdentifiers } from "./collect-binding-identifiers.js";
import { createEvidence } from "./create-evidence.js";
import { createObligation } from "./create-obligation.js";
import { isFunctionBoundary } from "./is-function-boundary.js";
import { resolveFunction } from "./resolve-function.js";
import { ReactObligationStatus, ReactProofClaim } from "./types.js";
import type { ReactAnalysisContext, ReactProofEvidence, ReactProofObligation } from "./types.js";

interface JsxKeyFact {
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment;
  keyExpression: ts.Expression | null;
  staticKey: string | null;
}

const getDirectJsxNodes = (
  expression: ts.Expression,
): ReadonlyArray<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment> => {
  if (
    ts.isJsxElement(expression) ||
    ts.isJsxSelfClosingElement(expression) ||
    ts.isJsxFragment(expression)
  ) {
    return [expression];
  }
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return getDirectJsxNodes(expression.expression);
  }
  if (ts.isConditionalExpression(expression)) {
    return [...getDirectJsxNodes(expression.whenTrue), ...getDirectJsxNodes(expression.whenFalse)];
  }
  return [];
};

const getJsxKeyFact = (
  node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment,
): JsxKeyFact => {
  if (ts.isJsxFragment(node)) {
    return { node, keyExpression: null, staticKey: null };
  }
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes;
  const keyAttribute = attributes.properties.find(
    (attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText() === "key",
  );
  if (!keyAttribute || !ts.isJsxAttribute(keyAttribute) || !keyAttribute.initializer) {
    return { node, keyExpression: null, staticKey: null };
  }
  if (ts.isStringLiteral(keyAttribute.initializer)) {
    return {
      node,
      keyExpression: keyAttribute.initializer,
      staticKey: keyAttribute.initializer.text,
    };
  }
  if (ts.isJsxExpression(keyAttribute.initializer) && keyAttribute.initializer.expression) {
    const keyExpression = keyAttribute.initializer.expression;
    const staticKey =
      ts.isStringLiteral(keyExpression) || ts.isNumericLiteral(keyExpression)
        ? keyExpression.text
        : null;
    return { node, keyExpression, staticKey };
  }
  return { node, keyExpression: null, staticKey: null };
};

const getReturnedJsxNodes = (
  callback: ts.FunctionLikeDeclaration,
): ReadonlyArray<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment> => {
  if (callback.body && !ts.isBlock(callback.body)) {
    return getDirectJsxNodes(callback.body);
  }
  const returnedNodes: Array<ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxFragment> = [];
  const visit = (node: ts.Node): void => {
    if (node !== callback && isFunctionBoundary(node)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      returnedNodes.push(...getDirectJsxNodes(node.expression));
      return;
    }
    node.forEachChild(visit);
  };
  callback.body?.forEachChild(visit);
  return returnedNodes;
};

const referencesSymbol = (
  expression: ts.Expression,
  symbol: ts.Symbol,
  typeChecker: ts.TypeChecker,
): boolean => {
  let didFindSymbol = false;
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && typeChecker.getSymbolAtLocation(node) === symbol) {
      didFindSymbol = true;
      return;
    }
    node.forEachChild(visit);
  };
  visit(expression);
  return didFindSymbol;
};

const getContainingForStatement = (
  node: ts.Node,
  owner: ts.FunctionLikeDeclaration,
): ts.ForStatement | null => {
  let currentNode = node;
  while (currentNode !== owner) {
    const parentNode = currentNode.parent;
    if (!parentNode) return null;
    if (ts.isForStatement(parentNode)) return parentNode;
    currentNode = parentNode;
  }
  return null;
};

const getForInitializerSymbols = (
  forStatement: ts.ForStatement,
  typeChecker: ts.TypeChecker,
): ReadonlySet<ts.Symbol> => {
  const symbols = new Set<ts.Symbol>();
  if (forStatement.initializer && ts.isVariableDeclarationList(forStatement.initializer)) {
    for (const declaration of forStatement.initializer.declarations) {
      for (const identifier of collectBindingIdentifiers(declaration.name)) {
        const symbol = typeChecker.getSymbolAtLocation(identifier);
        if (symbol) symbols.add(symbol);
      }
    }
  }
  return symbols;
};

const referencesAnySymbol = (
  expression: ts.Expression,
  symbols: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): boolean => [...symbols].some((symbol) => referencesSymbol(expression, symbol, typeChecker));

const dependsOnForInitializer = (
  expression: ts.Expression,
  forSymbols: ReadonlySet<ts.Symbol>,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (referencesAnySymbol(expression, forSymbols, typeChecker)) return true;
  let didFindDependency = false;
  const visit = (node: ts.Node): void => {
    if (!ts.isIdentifier(node)) {
      node.forEachChild(visit);
      return;
    }
    const symbol = typeChecker.getSymbolAtLocation(node);
    for (const declaration of symbol?.declarations ?? []) {
      if (
        ts.isVariableDeclaration(declaration) &&
        declaration.initializer &&
        referencesAnySymbol(declaration.initializer, forSymbols, typeChecker)
      ) {
        didFindDependency = true;
        return;
      }
    }
  };
  visit(expression);
  return didFindDependency;
};

const isCollectionRendered = (
  collection: ts.Expression,
  functionNode: ts.FunctionLikeDeclaration,
  typeChecker: ts.TypeChecker,
): boolean => {
  if (!ts.isIdentifier(collection)) return false;
  const collectionSymbol = typeChecker.getSymbolAtLocation(collection);
  if (!collectionSymbol) return false;
  let didFindRenderedReference = false;
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (
      ts.isIdentifier(node) &&
      node !== collection &&
      typeChecker.getSymbolAtLocation(node) === collectionSymbol
    ) {
      let currentNode: ts.Node | undefined = node;
      while (currentNode && currentNode !== functionNode) {
        if (ts.isReturnStatement(currentNode) || ts.isJsxExpression(currentNode)) {
          didFindRenderedReference = true;
          return;
        }
        currentNode = currentNode.parent;
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  return didFindRenderedReference;
};

export const analyzeReconciliationIdentity = (
  functionNode: ts.FunctionLikeDeclaration,
  context: ReactAnalysisContext,
): ReactProofObligation => {
  const violations: ReactProofEvidence[] = [];
  const unknownEvidence: ReactProofEvidence[] = [];
  const visit = (node: ts.Node): void => {
    if (node !== functionNode && isFunctionBoundary(node)) return;
    if (ts.isArrayLiteralExpression(node)) {
      const keyFacts = node.elements.flatMap((element) =>
        ts.isJsxElement(element) || ts.isJsxSelfClosingElement(element) || ts.isJsxFragment(element)
          ? [getJsxKeyFact(element)]
          : [],
      );
      const seenStaticKeys = new Set<string>();
      for (const keyFact of keyFacts) {
        if (!keyFact.keyExpression) {
          violations.push(
            createEvidence(
              keyFact.node,
              context.rootDirectory,
              "A JSX child in an array has no reconciliation key",
              ["render list", "unkeyed child", "ambiguous state identity"],
            ),
          );
        } else if (keyFact.staticKey && seenStaticKeys.has(keyFact.staticKey)) {
          violations.push(
            createEvidence(
              keyFact.keyExpression,
              context.rootDirectory,
              `The reconciliation key ${keyFact.staticKey} is duplicated`,
              ["render list", `key ${keyFact.staticKey}`, "duplicate state identity"],
            ),
          );
        } else if (!keyFact.staticKey && keyFacts.length > 1) {
          unknownEvidence.push(
            createEvidence(
              keyFact.keyExpression,
              context.rootDirectory,
              "Dynamic array key uniqueness has no checked contract",
              ["render list", keyFact.keyExpression.getText(), "unproved uniqueness"],
            ),
          );
        }
        if (keyFact.staticKey) seenStaticKeys.add(keyFact.staticKey);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "map"
    ) {
      const callbackExpression = node.arguments[0];
      const callback = callbackExpression
        ? resolveFunction(callbackExpression, context.typeChecker)
        : null;
      if (!callback) {
        unknownEvidence.push(
          createEvidence(
            node,
            context.rootDirectory,
            "The list mapping callback cannot be resolved",
            ["render list", "opaque mapping callback", "reconciliation"],
          ),
        );
      } else {
        const indexParameter = callback.parameters[1];
        const indexSymbol =
          indexParameter && ts.isIdentifier(indexParameter.name)
            ? context.typeChecker.getSymbolAtLocation(indexParameter.name)
            : null;
        for (const returnedNode of getReturnedJsxNodes(callback)) {
          const keyFact = getJsxKeyFact(returnedNode);
          if (!keyFact.keyExpression) {
            violations.push(
              createEvidence(
                returnedNode,
                context.rootDirectory,
                "A JSX child returned from map has no reconciliation key",
                ["render list", "map callback", "unkeyed child"],
              ),
            );
          } else if (keyFact.staticKey) {
            violations.push(
              createEvidence(
                keyFact.keyExpression,
                context.rootDirectory,
                `The constant key ${keyFact.staticKey} is shared by every mapped child`,
                ["render list", "map callback", "duplicate key"],
              ),
            );
          } else if (
            indexSymbol &&
            referencesSymbol(keyFact.keyExpression, indexSymbol, context.typeChecker)
          ) {
            unknownEvidence.push(
              createEvidence(
                keyFact.keyExpression,
                context.rootDirectory,
                "An index key cannot prove state preservation across insertion or reordering",
                ["render list", "index key", "unproved reorder stability"],
              ),
            );
          } else {
            unknownEvidence.push(
              createEvidence(
                keyFact.keyExpression,
                context.rootDirectory,
                "Mapped key uniqueness has no checked data contract",
                ["render list", keyFact.keyExpression.getText(), "unproved uniqueness"],
              ),
            );
          }
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      isCollectionRendered(node.expression.expression, functionNode, context.typeChecker)
    ) {
      const forStatement = getContainingForStatement(node, functionNode);
      const pushedExpression = node.arguments[0];
      if (forStatement && pushedExpression) {
        const forSymbols = getForInitializerSymbols(forStatement, context.typeChecker);
        for (const pushedNode of getDirectJsxNodes(pushedExpression)) {
          const keyFact = getJsxKeyFact(pushedNode);
          if (!keyFact.keyExpression) {
            violations.push(
              createEvidence(
                pushedNode,
                context.rootDirectory,
                "A JSX child pushed from a loop has no reconciliation key",
                ["render list", "loop push", "unkeyed child"],
              ),
            );
          } else if (keyFact.staticKey) {
            violations.push(
              createEvidence(
                keyFact.keyExpression,
                context.rootDirectory,
                `The constant key ${keyFact.staticKey} is shared by every loop iteration`,
                ["render list", "loop push", "duplicate key"],
              ),
            );
          } else if (
            dependsOnForInitializer(keyFact.keyExpression, forSymbols, context.typeChecker)
          ) {
            unknownEvidence.push(
              createEvidence(
                keyFact.keyExpression,
                context.rootDirectory,
                "A loop-index-derived key cannot prove state preservation when positions shift",
                ["render list", "loop index key", "unproved semantic identity"],
              ),
            );
          } else {
            unknownEvidence.push(
              createEvidence(
                keyFact.keyExpression,
                context.rootDirectory,
                "Loop-generated key uniqueness has no checked data contract",
                ["render list", keyFact.keyExpression.getText(), "unproved uniqueness"],
              ),
            );
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  functionNode.forEachChild(visit);
  if (violations.length > 0) {
    return createObligation(
      ReactProofClaim.ReconciliationIdentity,
      ReactObligationStatus.Violated,
      "A rendered list has ambiguous child identity",
      violations,
    );
  }
  if (unknownEvidence.length > 0) {
    return createObligation(
      ReactProofClaim.ReconciliationIdentity,
      ReactObligationStatus.Unknown,
      "List state preservation could not be proved",
      unknownEvidence,
    );
  }
  return createObligation(
    ReactProofClaim.ReconciliationIdentity,
    ReactObligationStatus.Proved,
    "Every represented child position has unambiguous reconciliation identity",
  );
};
