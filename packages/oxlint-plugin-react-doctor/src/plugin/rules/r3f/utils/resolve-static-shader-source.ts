import type { ScopeAnalysis } from "../../../semantic/scope-analysis.js";
import type { EsTreeNode } from "../../../utils/es-tree-node.js";
import { getStaticPropertyName } from "../../../utils/get-static-property-name.js";
import { getStaticStringExpression } from "../../../utils/get-static-string-expression.js";
import { isNodeOfType } from "../../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../../utils/strip-paren-expression.js";

interface StaticShaderSourceSegment {
  readonly endOffset: number;
  readonly node: EsTreeNode;
  readonly startOffset: number;
}

interface ResolvedStaticShaderSource {
  readonly fallbackNode: EsTreeNode;
  readonly segments: ReadonlyArray<StaticShaderSourceSegment>;
  readonly text: string;
}

export interface StaticShaderSource {
  readonly getOriginNodeAtOffset: (offset: number) => EsTreeNode;
  readonly text: string;
}

const shiftSegments = (
  source: ResolvedStaticShaderSource,
  offset: number,
): StaticShaderSourceSegment[] =>
  source.segments.map((segment) => ({
    endOffset: segment.endOffset + offset,
    node: segment.node,
    startOffset: segment.startOffset + offset,
  }));

const combineStaticShaderSources = (
  sources: ReadonlyArray<ResolvedStaticShaderSource>,
  separator: ResolvedStaticShaderSource | null,
  fallbackNode: EsTreeNode,
): ResolvedStaticShaderSource => {
  let text = "";
  const segments: StaticShaderSourceSegment[] = [];
  sources.forEach((source, sourceIndex) => {
    if (sourceIndex > 0 && separator) {
      segments.push(...shiftSegments(separator, text.length));
      text += separator.text;
    }
    segments.push(...shiftSegments(source, text.length));
    text += source.text;
  });
  return { fallbackNode, segments, text };
};

const resolveStaticShaderSourceExpression = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
  visitedSymbolIds: ReadonlySet<number>,
): ResolvedStaticShaderSource | null => {
  const candidate = stripParenExpression(expression);
  const directStaticString = getStaticStringExpression(candidate);
  if (directStaticString !== null) {
    return {
      fallbackNode: candidate,
      segments:
        directStaticString.length === 0
          ? []
          : [{ endOffset: directStaticString.length, node: candidate, startOffset: 0 }],
      text: directStaticString,
    };
  }
  if (isNodeOfType(candidate, "Identifier")) {
    const symbol = scopes.symbolFor(candidate);
    if (
      symbol?.kind !== "const" ||
      !symbol.initializer ||
      visitedSymbolIds.has(symbol.id) ||
      !isNodeOfType(symbol.declarationNode, "VariableDeclarator") ||
      symbol.declarationNode.id !== symbol.bindingIdentifier
    ) {
      return null;
    }
    const nextVisitedSymbolIds = new Set(visitedSymbolIds);
    nextVisitedSymbolIds.add(symbol.id);
    return resolveStaticShaderSourceExpression(symbol.initializer, scopes, nextVisitedSymbolIds);
  }
  if (isNodeOfType(candidate, "BinaryExpression") && candidate.operator === "+") {
    const leftSource = resolveStaticShaderSourceExpression(
      candidate.left,
      scopes,
      new Set(visitedSymbolIds),
    );
    const rightSource = resolveStaticShaderSourceExpression(
      candidate.right,
      scopes,
      new Set(visitedSymbolIds),
    );
    return leftSource && rightSource
      ? combineStaticShaderSources([leftSource, rightSource], null, candidate)
      : null;
  }
  if (
    !isNodeOfType(candidate, "CallExpression") ||
    !isNodeOfType(candidate.callee, "MemberExpression") ||
    getStaticPropertyName(candidate.callee) !== "join"
  ) {
    return null;
  }
  const arrayExpression = stripParenExpression(candidate.callee.object);
  if (!isNodeOfType(arrayExpression, "ArrayExpression") || candidate.arguments.length > 1) {
    return null;
  }
  const separatorArgument = candidate.arguments[0];
  let separator: ResolvedStaticShaderSource | null;
  if (!separatorArgument) {
    separator = {
      fallbackNode: candidate,
      segments: [],
      text: ",",
    };
  } else if (isNodeOfType(separatorArgument, "SpreadElement")) {
    separator = null;
  } else {
    separator = resolveStaticShaderSourceExpression(
      separatorArgument,
      scopes,
      new Set(visitedSymbolIds),
    );
  }
  if (!separator) return null;
  const elementSources: ResolvedStaticShaderSource[] = [];
  for (const element of arrayExpression.elements) {
    if (!element || isNodeOfType(element, "SpreadElement")) return null;
    const elementSource = resolveStaticShaderSourceExpression(
      element,
      scopes,
      new Set(visitedSymbolIds),
    );
    if (!elementSource) return null;
    elementSources.push(elementSource);
  }
  return combineStaticShaderSources(elementSources, separator, candidate);
};

export const resolveStaticShaderSource = (
  expression: EsTreeNode,
  scopes: ScopeAnalysis,
): StaticShaderSource | null => {
  const source = resolveStaticShaderSourceExpression(expression, scopes, new Set());
  if (!source) return null;
  return {
    getOriginNodeAtOffset: (offset) =>
      source.segments.find((segment) => offset >= segment.startOffset && offset < segment.endOffset)
        ?.node ?? source.fallbackNode,
    text: source.text,
  };
};
