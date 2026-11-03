import type { EsTreeNode } from "./es-tree-node.js";
import type { RuleContext } from "./rule-context.js";
import { isFunctionLike } from "./is-function-like.js";
import { isNodeOfType } from "./is-node-of-type.js";
import { isProvenNonThrowingBuiltInCall } from "./is-proven-non-throwing-built-in-call.js";
import { readStaticBoolean } from "./read-static-boolean.js";
import { stripParenExpression } from "./strip-paren-expression.js";
import { walkAst } from "./walk-ast.js";

interface SynchronousReleaseContinuations {
  onContinue: () => boolean;
  onReturn: () => boolean;
  onThrow: () => boolean;
}

interface SynchronousReleaseInput {
  statement: EsTreeNode;
  owner: EsTreeNode;
  context: RuleContext;
  isRelease: (node: EsTreeNode) => boolean;
}

export const isNodeFollowedBySynchronousRelease = ({
  statement,
  owner,
  context,
  isRelease,
}: SynchronousReleaseInput): boolean => {
  const unreleased: SynchronousReleaseContinuations = {
    onContinue: () => false,
    onReturn: () => false,
    onThrow: () => false,
  };
  const withDisposal = (
    declaration: EsTreeNode,
    continuations: SynchronousReleaseContinuations,
  ): SynchronousReleaseContinuations => {
    if (!isNodeOfType(declaration, "VariableDeclaration")) return continuations;
    if (declaration.kind === "await using") return unreleased;
    if (declaration.kind !== "using") return continuations;
    return {
      onContinue: () => continuations.onContinue() && continuations.onThrow(),
      onReturn: () => continuations.onReturn() && continuations.onThrow(),
      onThrow: continuations.onThrow,
    };
  };
  const evaluateExpression = (
    expression: EsTreeNode | null | undefined,
    onContinue: () => boolean,
    onThrow: () => boolean,
  ): boolean => {
    if (!expression) return onContinue();
    let doesSuspend = false;
    walkAst(expression, (child) => {
      if (isFunctionLike(child)) return false;
      if (isNodeOfType(child, "AwaitExpression") || isNodeOfType(child, "YieldExpression")) {
        doesSuspend = true;
        return false;
      }
    });
    if (doesSuspend) return false;
    const value = stripParenExpression(expression);
    if (isFunctionLike(value) || isNodeOfType(value, "Literal")) return onContinue();
    if (isNodeOfType(value, "Identifier")) {
      const symbol = context.scopes.symbolFor(value);
      if (
        symbol &&
        (symbol.kind === "parameter" ||
          symbol.kind === "import" ||
          symbol.kind === "function" ||
          symbol.kind === "var" ||
          symbol.kind === "catch-clause-parameter" ||
          symbol.declarationNode.range[1] <= value.range[0])
      ) {
        return onContinue();
      }
    }
    if (
      isNodeOfType(value, "UnaryExpression") &&
      (value.operator === "!" || value.operator === "void")
    ) {
      return evaluateExpression(value.argument, onContinue, onThrow);
    }
    if (
      isNodeOfType(value, "CallExpression") &&
      isProvenNonThrowingBuiltInCall(value, context.scopes)
    ) {
      return (
        value.arguments.every((argument) => evaluateExpression(argument, () => true, onThrow)) &&
        onContinue()
      );
    }
    return onContinue() && onThrow();
  };
  const analyzeStatements = (
    statements: ReadonlyArray<EsTreeNode>,
    continuations: SynchronousReleaseContinuations,
    statementIndex = 0,
  ): boolean => {
    const firstStatement = statements[statementIndex];
    if (!firstStatement) return continuations.onContinue();
    if (
      isNodeOfType(firstStatement, "VariableDeclaration") &&
      (firstStatement.kind === "using" || firstStatement.kind === "await using")
    ) {
      const registerDisposables = (
        declarationIndex: number,
        exitContinuations: SynchronousReleaseContinuations,
      ): boolean => {
        const declaration = firstStatement.declarations[declarationIndex];
        if (!declaration)
          return analyzeStatements(statements, exitContinuations, statementIndex + 1);
        return evaluateExpression(
          declaration.init,
          () =>
            registerDisposables(
              declarationIndex + 1,
              withDisposal(firstStatement, exitContinuations),
            ) && exitContinuations.onThrow(),
          exitContinuations.onThrow,
        );
      };
      return registerDisposables(0, continuations);
    }
    let continuationResult: boolean | undefined;
    return analyzeStatement(firstStatement, {
      ...continuations,
      onContinue: () =>
        (continuationResult ??= analyzeStatements(statements, continuations, statementIndex + 1)),
    });
  };
  const withFinalizer = (
    tryStatement: EsTreeNode,
    continuations: SynchronousReleaseContinuations,
  ): SynchronousReleaseContinuations => {
    if (!isNodeOfType(tryStatement, "TryStatement") || !tryStatement.finalizer)
      return continuations;
    const finalizer = tryStatement.finalizer;
    const finalizerResults = new Map<() => boolean, boolean>();
    const runFinalizer = (onContinue: () => boolean): boolean => {
      const cachedResult = finalizerResults.get(onContinue);
      if (cachedResult !== undefined) return cachedResult;
      const result = analyzeStatement(finalizer, { ...continuations, onContinue });
      finalizerResults.set(onContinue, result);
      return result;
    };
    return {
      onContinue: () => runFinalizer(continuations.onContinue),
      onReturn: () => runFinalizer(continuations.onReturn),
      onThrow: () => runFinalizer(continuations.onThrow),
    };
  };
  const tryContinuations = (
    tryStatement: EsTreeNode,
    continuations: SynchronousReleaseContinuations,
  ): SynchronousReleaseContinuations => {
    const finalizerContinuations = withFinalizer(tryStatement, continuations);
    if (!isNodeOfType(tryStatement, "TryStatement") || !tryStatement.handler)
      return finalizerContinuations;
    const handler = tryStatement.handler;
    return {
      ...finalizerContinuations,
      onThrow: () =>
        (!handler.param ||
          isNodeOfType(handler.param, "Identifier") ||
          finalizerContinuations.onThrow()) &&
        analyzeStatement(handler.body, finalizerContinuations),
    };
  };
  const analyzeStatement = (
    currentStatement: EsTreeNode,
    continuations: SynchronousReleaseContinuations,
  ): boolean => {
    if (isNodeOfType(currentStatement, "BlockStatement")) {
      return analyzeStatements(currentStatement.body, continuations);
    }
    if (
      isNodeOfType(currentStatement, "EmptyStatement") ||
      isNodeOfType(currentStatement, "FunctionDeclaration")
    ) {
      return continuations.onContinue();
    }
    if (isNodeOfType(currentStatement, "ExpressionStatement")) {
      return (
        isRelease(currentStatement.expression) ||
        evaluateExpression(
          currentStatement.expression,
          continuations.onContinue,
          continuations.onThrow,
        )
      );
    }
    if (isNodeOfType(currentStatement, "VariableDeclaration")) {
      if (currentStatement.kind === "using" || currentStatement.kind === "await using")
        return false;
      return (
        currentStatement.declarations.every(
          (declaration) =>
            isNodeOfType(declaration.id, "Identifier") &&
            evaluateExpression(declaration.init, () => true, continuations.onThrow),
        ) && continuations.onContinue()
      );
    }
    if (isNodeOfType(currentStatement, "ReturnStatement")) {
      return evaluateExpression(
        currentStatement.argument,
        continuations.onReturn,
        continuations.onThrow,
      );
    }
    if (isNodeOfType(currentStatement, "ThrowStatement")) {
      return evaluateExpression(
        currentStatement.argument,
        continuations.onThrow,
        continuations.onThrow,
      );
    }
    if (isNodeOfType(currentStatement, "IfStatement")) {
      const staticTest = readStaticBoolean(currentStatement.test);
      return evaluateExpression(
        currentStatement.test,
        () =>
          (staticTest === false || analyzeStatement(currentStatement.consequent, continuations)) &&
          (staticTest === true ||
            (currentStatement.alternate
              ? analyzeStatement(currentStatement.alternate, continuations)
              : continuations.onContinue())),
        continuations.onThrow,
      );
    }
    if (isNodeOfType(currentStatement, "TryStatement")) {
      return analyzeStatement(
        currentStatement.block,
        tryContinuations(currentStatement, continuations),
      );
    }
    return false;
  };
  const continuationsAfter = (currentStatement: EsTreeNode): SynchronousReleaseContinuations => {
    const parent = currentStatement.parent;
    if (!parent || currentStatement === owner) return unreleased;
    if (isNodeOfType(parent, "BlockStatement")) {
      const statementIndex = parent.body.findIndex((sibling) => sibling === currentStatement);
      const parentContinuations = parent.body
        .slice(0, statementIndex)
        .reduce(
          (continuations, priorStatement) => withDisposal(priorStatement, continuations),
          continuationsAfter(parent),
        );
      return {
        ...parentContinuations,
        onContinue: () => analyzeStatements(parent.body, parentContinuations, statementIndex + 1),
      };
    }
    if (isNodeOfType(parent, "IfStatement")) return continuationsAfter(parent);
    if (isNodeOfType(parent, "TryStatement") && parent.block === currentStatement) {
      return tryContinuations(parent, continuationsAfter(parent));
    }
    if (isNodeOfType(parent, "TryStatement") && parent.finalizer === currentStatement) {
      const continuations = continuationsAfter(parent);
      return {
        ...continuations,
        onContinue: () =>
          continuations.onContinue() && continuations.onReturn() && continuations.onThrow(),
      };
    }
    if (isNodeOfType(parent, "CatchClause") && isNodeOfType(parent.parent, "TryStatement")) {
      return withFinalizer(parent.parent, continuationsAfter(parent.parent));
    }
    return unreleased;
  };
  return continuationsAfter(statement).onContinue();
};
