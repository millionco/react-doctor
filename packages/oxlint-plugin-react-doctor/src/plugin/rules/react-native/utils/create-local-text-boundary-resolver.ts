import { REACT_HOC_NAMES } from "../../../constants/react.js";
import type { SymbolDescriptor } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../../utils/es-tree-node-of-type.js";
import { flattenCalleeName } from "../../../utils/flatten-callee-name.js";
import { isFunctionLike } from "../../../utils/is-function-like.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import type { RuleContext } from "../../../utils/rule-context.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";
import { walkAst } from "../../../utils/walk-ast.js";

export interface LocalTextBoundaryResolverOptions {
  context: RuleContext;
  isTextHandlingComponent: (elementName: string) => boolean;
  resolveTextBoundaryName: (openingElement: EsTreeNodeOfType<"JSXOpeningElement">) => string | null;
}

export interface LocalTextBoundaryResolver {
  isTextBoundaryElement: (node: EsTreeNodeOfType<"JSXElement">) => boolean;
}

const isReactComponentWrapperCall = (node: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = stripParenExpression(node.callee as EsTreeNode);
  const calleeName = flattenCalleeName(callee);
  return calleeName !== null && REACT_HOC_NAMES.has(calleeName);
};

const resolveComponentFunction = (node: EsTreeNode | null): EsTreeNode | null => {
  if (!node) return null;
  const expression = stripParenExpression(node);
  if (isFunctionLike(expression)) return expression;
  if (!isNodeOfType(expression, "CallExpression") || !isReactComponentWrapperCall(expression)) {
    return null;
  }
  const firstArgument = expression.arguments[0];
  return firstArgument ? resolveComponentFunction(firstArgument as EsTreeNode) : null;
};

const collectRenderReturnExpressions = (functionNode: EsTreeNode): EsTreeNode[] => {
  if (!isFunctionLike(functionNode)) return [];
  if (
    isNodeOfType(functionNode, "ArrowFunctionExpression") &&
    !isNodeOfType(functionNode.body, "BlockStatement")
  ) {
    return [functionNode.body];
  }

  if (!functionNode.body) return [];

  const returnExpressions: EsTreeNode[] = [];
  walkAst(functionNode.body, (node) => {
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (isNodeOfType(node, "ReturnStatement") && node.argument) {
      returnExpressions.push(node.argument);
    }
  });

  return returnExpressions;
};

const isNullableRenderExpression = (node: EsTreeNode): boolean => {
  const expression = stripParenExpression(node);
  if (isNodeOfType(expression, "Literal"))
    return expression.value === null || expression.value === false;
  return isNodeOfType(expression, "Identifier") && expression.name === "undefined";
};

export const createLocalTextBoundaryResolver = (
  options: LocalTextBoundaryResolverOptions,
): LocalTextBoundaryResolver => {
  const textWrapperCache = new Map<number, boolean>();

  const isLocalTextWrapperComponent = (
    symbol: SymbolDescriptor,
    seenSymbols: Set<number>,
  ): boolean => {
    const cachedResult = textWrapperCache.get(symbol.id);
    if (cachedResult !== undefined) return cachedResult;
    if (seenSymbols.has(symbol.id)) return false;

    const functionNode = resolveComponentFunction(symbol.initializer);
    if (!functionNode) {
      textWrapperCache.set(symbol.id, false);
      return false;
    }

    seenSymbols.add(symbol.id);
    const returnExpressions = collectRenderReturnExpressions(functionNode);
    const isTextWrapper =
      returnExpressions.length > 0 &&
      returnExpressions.every(
        (expression) =>
          isNullableRenderExpression(expression) ||
          isTextBoundaryExpression(expression, seenSymbols),
      );
    seenSymbols.delete(symbol.id);
    textWrapperCache.set(symbol.id, isTextWrapper);
    return isTextWrapper;
  };

  const isTextBoundaryElement = (
    node: EsTreeNodeOfType<"JSXElement">,
    seenSymbols: Set<number>,
  ): boolean => {
    const elementName = options.resolveTextBoundaryName(node.openingElement);
    if (elementName && options.isTextHandlingComponent(elementName)) return true;
    const nameNode = node.openingElement.name;
    if (!isNodeOfType(nameNode, "JSXIdentifier")) return false;
    const symbol = options.context.scopes.symbolFor(nameNode);
    return symbol ? isLocalTextWrapperComponent(symbol, seenSymbols) : false;
  };

  const isTextBoundaryExpression = (node: EsTreeNode, seenSymbols: Set<number>): boolean => {
    const expression = stripParenExpression(node);
    if (isNodeOfType(expression, "JSXElement")) {
      return isTextBoundaryElement(expression, seenSymbols);
    }
    if (isNodeOfType(expression, "ConditionalExpression")) {
      return (
        (isNullableRenderExpression(expression.consequent) ||
          isTextBoundaryExpression(expression.consequent, seenSymbols)) &&
        (isNullableRenderExpression(expression.alternate) ||
          isTextBoundaryExpression(expression.alternate, seenSymbols))
      );
    }
    if (isNodeOfType(expression, "LogicalExpression") && expression.operator === "&&") {
      return (
        isNullableRenderExpression(expression.right) ||
        isTextBoundaryExpression(expression.right, seenSymbols)
      );
    }
    return false;
  };

  return {
    isTextBoundaryElement: (node) => isTextBoundaryElement(node, new Set()),
  };
};
