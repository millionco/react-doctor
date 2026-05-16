import { defineRule } from "../../utils/define-rule.js";
import { collectPatternDefaultReferenceNames } from "../../utils/collect-pattern-default-reference-names.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { containsDirectAwait } from "../../utils/contains-direct-await.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isBareAwaitExpressionStatement } from "../../utils/is-bare-await-expression-statement.js";
import { isEarlyExitIfStatement } from "../../utils/is-early-exit-if-statement.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

interface DeclarationProcessResult {
  didIntroduceAwait: boolean;
  didGrowBindings: boolean;
}

const hasAnyIdentifierName = (
  identifierNames: ReadonlySet<string>,
  candidateNames: ReadonlySet<string>,
): boolean => {
  for (const candidateName of candidateNames) {
    if (identifierNames.has(candidateName)) return true;
  }
  return false;
};

const collectDeclaratorDependencyIdentifierNames = (
  declarator: EsTreeNode,
  into: Set<string>,
): void => {
  if (!isNodeOfType(declarator, "VariableDeclarator")) return;
  collectReferenceIdentifierNames(declarator.init, into);
  collectPatternDefaultReferenceNames(declarator.id, into);
};

// Iterates declarators to a fixed point so backward-referenced derivations
// (`const isMissing = !flowRow, flowRow = await select();`) still propagate
// `flowRow` and its dependents into `awaitedBindingNames` regardless of the
// authored order.
const processVariableDeclaration = (
  declaration: EsTreeNode,
  awaitedBindingNames: Set<string>,
): DeclarationProcessResult => {
  if (!isNodeOfType(declaration, "VariableDeclaration"))
    return { didIntroduceAwait: false, didGrowBindings: false };
  let didIntroduceAwait = false;
  const sizeBeforeAll = awaitedBindingNames.size;
  let hasChanged = true;
  while (hasChanged) {
    hasChanged = false;
    for (const declarator of declaration.declarations ?? []) {
      if (!isNodeOfType(declarator, "VariableDeclarator")) continue;
      const declaratorHasAwait =
        containsDirectAwait(declarator.init) || containsDirectAwait(declarator.id);
      if (declaratorHasAwait) {
        didIntroduceAwait = true;
        const sizeBefore = awaitedBindingNames.size;
        collectPatternNames(declarator.id, awaitedBindingNames);
        if (awaitedBindingNames.size > sizeBefore) hasChanged = true;
        continue;
      }
      const dependencyIdentifiers = new Set<string>();
      collectDeclaratorDependencyIdentifierNames(declarator, dependencyIdentifiers);
      if (!hasAnyIdentifierName(dependencyIdentifiers, awaitedBindingNames)) continue;
      const sizeBefore = awaitedBindingNames.size;
      collectPatternNames(declarator.id, awaitedBindingNames);
      if (awaitedBindingNames.size > sizeBefore) hasChanged = true;
    }
  }
  const didGrowBindings = awaitedBindingNames.size > sizeBeforeAll;
  return { didIntroduceAwait, didGrowBindings };
};

interface AwaitWindow {
  firstAwaitStatement: EsTreeNode;
  awaitedBindingNames: Set<string>;
  // Index of the first statement past the preamble (where the guard, if any,
  // must live).
  guardCandidateIndex: number;
}

// Walks forward from `startIndex` collecting an "await preamble" — the
// originating awaited statement plus any contiguous bare-await statements
// or VariableDeclarations whose declarators introduce their own await OR
// derive from the running `awaitedBindingNames`. Returns `null` when the
// statement at `startIndex` is not itself an awaiting statement.
const collectAwaitWindow = (statements: EsTreeNode[], startIndex: number): AwaitWindow | null => {
  const firstStatement = statements[startIndex];
  const awaitedBindingNames = new Set<string>();
  let isAwaitingStatement = false;
  if (isNodeOfType(firstStatement, "VariableDeclaration")) {
    const result = processVariableDeclaration(firstStatement, awaitedBindingNames);
    if (result.didIntroduceAwait) isAwaitingStatement = true;
  } else if (isBareAwaitExpressionStatement(firstStatement)) {
    isAwaitingStatement = true;
  }
  if (!isAwaitingStatement) return null;

  let cursor = startIndex + 1;
  while (cursor < statements.length) {
    const candidate = statements[cursor];
    if (isBareAwaitExpressionStatement(candidate)) {
      cursor++;
      continue;
    }
    if (!isNodeOfType(candidate, "VariableDeclaration")) break;
    const result = processVariableDeclaration(candidate, awaitedBindingNames);
    if (!result.didIntroduceAwait && !result.didGrowBindings) break;
    cursor++;
  }

  return { firstAwaitStatement: firstStatement, awaitedBindingNames, guardCandidateIndex: cursor };
};

// HACK: `const x = await something(); if (skip) return defaultValue;` —
// the early-return doesn't depend on the awaited value, so the await
// blocked the function for nothing on the skip path. Move the await
// after the cheap synchronous guard so we only pay the latency when we
// actually need the data.
//
// Heuristic: an awaiting preamble (a `VariableDeclaration` containing
// `await`, or a bare `await expr;` statement, optionally followed by
// further bare awaits and binding-only declarations that derive from the
// awaited values) immediately followed by an early-exit `IfStatement`
// whose test references no identifiers bound by the preamble. Any
// non-binding statement between the await and the if implies the awaited
// value is being prepared for use, so we conservatively skip.
export const asyncDeferAwait = defineRule<Rule>({
  id: "async-defer-await",
  severity: "warn",
  recommendation:
    "Move the `await` after the synchronous early-return guard so the skip path stays fast",
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const window = collectAwaitWindow(statements, statementIndex);
        if (!window) continue;
        if (window.guardCandidateIndex >= statements.length) continue;
        const guardStatement = statements[window.guardCandidateIndex];
        if (!isEarlyExitIfStatement(guardStatement)) continue;
        if (!isNodeOfType(guardStatement, "IfStatement")) continue;

        const testIdentifierNames = new Set<string>();
        collectReferenceIdentifierNames(guardStatement.test, testIdentifierNames);
        if (hasAnyIdentifierName(testIdentifierNames, window.awaitedBindingNames)) {
          statementIndex = window.guardCandidateIndex - 1;
          continue;
        }

        const consequentIdentifierNames = new Set<string>();
        collectReferenceIdentifierNames(guardStatement.consequent, consequentIdentifierNames);
        if (hasAnyIdentifierName(consequentIdentifierNames, window.awaitedBindingNames)) {
          statementIndex = window.guardCandidateIndex - 1;
          continue;
        }

        context.report({
          node: window.firstAwaitStatement,
          message:
            "await blocks the function before an early-return that doesn't use the awaited value — move the await after the synchronous guard so the skip path stays fast",
        });
        statementIndex = window.guardCandidateIndex - 1;
      }
    };

    const inspectAllStatementBlocks = (functionBody: EsTreeNode | null | undefined): void => {
      if (!functionBody) return;
      walkAst(functionBody, (descendant: EsTreeNode) => {
        if (
          isNodeOfType(descendant, "FunctionDeclaration") ||
          isNodeOfType(descendant, "FunctionExpression") ||
          isNodeOfType(descendant, "ArrowFunctionExpression")
        ) {
          return false;
        }
        if (isNodeOfType(descendant, "BlockStatement")) {
          inspectStatements(descendant.body ?? []);
        } else if (isNodeOfType(descendant, "SwitchCase")) {
          inspectStatements(descendant.consequent ?? []);
        }
      });
    };

    const enterFunction = (node: EsTreeNode): void => {
      if (
        !isNodeOfType(node, "FunctionDeclaration") &&
        !isNodeOfType(node, "FunctionExpression") &&
        !isNodeOfType(node, "ArrowFunctionExpression")
      ) {
        return;
      }
      if (!node.async) return;
      if (!isNodeOfType(node.body, "BlockStatement")) return;
      inspectAllStatementBlocks(node.body);
    };

    return {
      FunctionDeclaration: enterFunction,
      FunctionExpression: enterFunction,
      ArrowFunctionExpression: enterFunction,
    };
  },
});
