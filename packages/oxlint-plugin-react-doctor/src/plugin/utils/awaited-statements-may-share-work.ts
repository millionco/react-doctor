import { FUNCTION_RESOLUTION_MAX_DEPTH } from "../constants/thresholds.js";
import type { ScopeAnalysis } from "../semantic/scope-analysis.js";
import type { EsTreeNode } from "./es-tree-node.js";
import { findEnclosingFunction } from "./find-enclosing-function.js";
import { getAwaitedStatementInfo } from "./find-sequential-independent-await.js";
import { getStaticPropertyName } from "./get-static-property-name.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { resolveConstIdentifierAlias } from "./resolve-const-identifier-alias.js";
import { resolveExactLocalFunction } from "./resolve-exact-local-function.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface AwaitedWork {
  cache: EsTreeNode | null;
  inputs: ReadonlyArray<EsTreeNode | null>;
}

const collectAwaitedWork = (statement: EsTreeNode, scopes: ScopeAnalysis): AwaitedWork[] => {
  const work: AwaitedWork[] = [];
  let remainingCalls = FUNCTION_RESOLUTION_MAX_DEPTH;

  const collect = (
    expression: EsTreeNode,
    bindings: ReadonlyMap<number, EsTreeNode | null>,
    functionNode: EsTreeNode | null,
  ): void => {
    const resolveInput = (input: EsTreeNode): EsTreeNode | null => {
      const symbol = resolveConstIdentifierAlias(stripParenExpression(input), scopes);
      if (!symbol || symbol.references.some((reference) => reference.flag !== "read")) return null;
      if (bindings.has(symbol.id)) return bindings.get(symbol.id) ?? null;
      if (functionNode && findEnclosingFunction(symbol.bindingIdentifier) === functionNode) {
        return null;
      }
      return symbol.bindingIdentifier;
    };

    walkAst(expression, (node) => {
      if (
        isFunctionLike(node) ||
        isNodeOfType(node, "ClassDeclaration") ||
        isNodeOfType(node, "ClassExpression")
      ) {
        return false;
      }
      if (!isNodeOfType(node, "CallExpression")) return;
      const callee = stripParenExpression(node.callee);
      const inputs = node.arguments.map(resolveInput);
      const receiver = isNodeOfType(callee, "MemberExpression")
        ? stripParenExpression(callee.object)
        : callee;
      const receiverSymbol = resolveConstIdentifierAlias(receiver, scopes);
      if (receiverSymbol?.kind === "import") {
        work.push({ cache: null, inputs });
      } else if (
        isNodeOfType(callee, "MemberExpression") &&
        getStaticPropertyName(callee) === "get" &&
        receiverSymbol?.kind === "const" &&
        receiverSymbol.initializer
      ) {
        const initializer = stripParenExpression(receiverSymbol.initializer);
        if (
          isNodeOfType(initializer, "NewExpression") &&
          isNodeOfType(initializer.callee, "Identifier") &&
          (initializer.callee.name === "Map" || initializer.callee.name === "WeakMap") &&
          scopes.isGlobalReference(initializer.callee)
        ) {
          const cache = resolveInput(receiver);
          if (cache) work.push({ cache, inputs: [inputs[0] ?? null] });
        }
      }
      if (!isNodeOfType(callee, "Identifier") || remainingCalls <= 0) return;
      const localSymbol = resolveConstIdentifierAlias(callee, scopes);
      if (!localSymbol || !isFunctionLike(localSymbol.initializer)) return;
      const localFunction = resolveExactLocalFunction(callee, scopes);
      if (!isFunctionLike(localFunction)) return;
      remainingCalls--;
      const localBindings = new Map(bindings);
      for (const [parameterIndex, parameter] of localFunction.params.entries()) {
        const symbol = scopes.symbolFor(parameter);
        if (symbol) localBindings.set(symbol.id, inputs[parameterIndex] ?? null);
      }
      collect(localFunction.body, localBindings, localFunction);
    });
  };

  for (const expression of getAwaitedStatementInfo(statement)?.awaitedExpressions ?? []) {
    collect(expression, new Map(), null);
  }
  return work;
};

export const awaitedStatementsMayShareWork = (
  previousStatement: EsTreeNode,
  nextStatement: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const previousWork = collectAwaitedWork(previousStatement, scopes);
  if (previousWork.length === 0) return false;
  const nextWork = collectAwaitedWork(nextStatement, scopes);
  return previousWork.some((previous) =>
    nextWork.some(
      (next) =>
        previous.cache === next.cache &&
        previous.inputs.some((input) => input !== null && next.inputs.includes(input)),
    ),
  );
};
