import { defineRule } from "../../utils/define-rule.js";
import { collectPatternDefaultReferenceNames } from "../../utils/collect-pattern-default-reference-names.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { containsDirectAwait } from "../../utils/contains-direct-await.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isBareAwaitExpressionStatement } from "../../utils/is-bare-await-expression-statement.js";
import { isEarlyExitIfStatement } from "../../utils/is-early-exit-if-statement.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
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
  // `await this.init();` — an await whose value is discarded exists for its
  // side effect, and the guard below it very often reads state that side
  // effect establishes (`if (!this.db) throw`). Never report those windows.
  hasBareSideEffectAwait: boolean;
}

// `await Y(); if (cancelled) return;` is the cancellation-check
// idiom — the await isn't there for its value, it's there to yield
// control so an outer flag (a captured `cancelled`/`isMounted`
// variable, or an `AbortSignal.aborted`) can flip during the
// suspension. Moving the await *after* the check defeats the entire
// pattern; the check would race instead of see the cancellation.
const CANCELLATION_GUARD_NAMES: ReadonlySet<string> = new Set([
  "cancelled",
  "canceled",
  "isCancelled",
  "isCanceled",
  "aborted",
  "isAborted",
  "disposed",
  "isDisposed",
  "destroyed",
  "isDestroyed",
  "stopped",
  "isStopped",
  "mounted",
  "isMounted",
  "unmounted",
  "isUnmounted",
  "active",
  "isActive",
  "stale",
  "isStale",
  "signal",
  "abortSignal",
  "abortController",
]);

// Ref handles (`aliveRef`, `disposedRef`, `inputRef`) hold the live
// disposable in `.current` — the Solid→React port turned Solid disposables
// into refs named `*Ref`, so `if (!aliveRef.current) return` is the same
// post-await staleness check as `if (cancelled) return`. Only an actual
// `.current` read counts: a bare `if (!tableRef) return` checks the handle
// itself, which can't change during the suspension, so the await should
// still be deferred below it.
const testReadsRefCurrent = (test: EsTreeNode): boolean => {
  let didFindRefCurrentRead = false;
  walkAst(test, (child: EsTreeNode): boolean | void => {
    if (didFindRefCurrentRead) return false;
    if (!isNodeOfType(child, "MemberExpression") || child.computed) return;
    if (!isNodeOfType(child.property, "Identifier") || child.property.name !== "current") return;
    if (!isNodeOfType(child.object, "Identifier")) return;
    const refCandidateName = child.object.name;
    if (refCandidateName.endsWith("Ref") && refCandidateName.length > "Ref".length) {
      didFindRefCurrentRead = true;
      return false;
    }
  });
  return didFindRefCurrentRead;
};

const CANCELLATION_NAME_FRAGMENTS: ReadonlyArray<string> = [
  "cancel",
  "abort",
  "dispos",
  "destroy",
  "stale",
  "alive",
  "mounted",
  "stopped",
  "settled",
  "cleanedup",
  "generation",
  "current",
  "token",
  "signal",
];

const isCancellationLikeName = (rawName: string): boolean => {
  const normalized = rawName.replace(/^[_#]+/, "").toLowerCase();
  // A variable named exactly `current` (a loop cursor, a pagination
  // index) is not staleness vocabulary — only compounds like `isCurrent`
  // or `currentRequestId` are.
  if (normalized === "current") return false;
  for (const fragment of CANCELLATION_NAME_FRAGMENTS) {
    if (normalized.includes(fragment)) return true;
  }
  return false;
};

const collectAllTestNames = (test: EsTreeNode): Set<string> => {
  const names = new Set<string>();
  walkAst(test, (child: EsTreeNode): void => {
    if (isNodeOfType(child, "Identifier") || isNodeOfType(child, "PrivateIdentifier")) {
      names.add(child.name);
    }
  });
  return names;
};

const isCancellationGuardTest = (test: EsTreeNode | null): boolean => {
  if (!test) return false;
  const referenced = new Set<string>();
  collectReferenceIdentifierNames(test, referenced);
  // Match either a bare identifier reference (`cancelled`, `!cancelled`),
  // a property access on one (`controller.signal.aborted`), or a
  // ref-staleness read (`aliveRef.current`, `inputRef.current.foo()`).
  for (const name of referenced) {
    if (CANCELLATION_GUARD_NAMES.has(name)) return true;
  }
  // Also scan EVERY identifier in the test (member property names,
  // private fields) for cancellation/staleness vocabulary:
  // `controller.signal.aborted`, `this._destroyed`, `batch.aborted`,
  // `seq !== getSeq.current`, `token !== runToken`.
  for (const name of collectAllTestNames(test)) {
    if (isCancellationLikeName(name)) return true;
  }
  return testReadsRefCurrent(test);
};

// Guards whose test CALLS something (`isCurrent()`, `ctx.isStale()`,
// `configManager.get(...)`) or reads instance/private state (`this.db`,
// `this.#db`) are re-checking mutable state that the await itself may have
// changed — deferring the await would change behavior. An immediately
// invoked inline arrow/function expression is transparent, though: its body
// is fully visible, so only calls/this/private reads INSIDE it count.
const guardTestReadsMutableEnvironment = (test: EsTreeNode | null): boolean => {
  if (!test) return false;
  let readsMutableEnvironment = false;
  walkAst(test, (child: EsTreeNode): boolean | void => {
    if (readsMutableEnvironment) return false;
    if (isNodeOfType(child, "CallExpression")) {
      const isInlineFunctionCallee =
        isNodeOfType(child.callee, "ArrowFunctionExpression") ||
        isNodeOfType(child.callee, "FunctionExpression");
      if (!isInlineFunctionCallee) {
        readsMutableEnvironment = true;
        return false;
      }
      return;
    }
    if (isNodeOfType(child, "ThisExpression") || isNodeOfType(child, "PrivateIdentifier")) {
      readsMutableEnvironment = true;
      return false;
    }
  });
  return readsMutableEnvironment;
};

// `if (refreshId !== currentRefreshId) return` — an (in)equality between two
// non-literal operands is the staleness-comparison signature: the right side
// is a captured value that may have advanced during the await. Literal
// comparisons (`if (mode === "off") return`) stay reportable.
const isNonLiteralComparisonTest = (test: EsTreeNode | null): boolean => {
  if (!test) return false;
  if (!isNodeOfType(test, "BinaryExpression")) return false;
  if (!["===", "!==", "==", "!="].includes(test.operator)) return false;
  const isLiteralOperand = (operand: EsTreeNode): boolean =>
    isNodeOfType(operand, "Literal") ||
    isNodeOfType(operand, "TemplateLiteral") ||
    (isNodeOfType(operand, "UnaryExpression") && isLiteralOperand(operand.argument));
  return !isLiteralOperand(test.left) && !isLiteralOperand(test.right);
};

// A guard whose consequent performs its own effect calls (`if (smime) {
// setComposerMode('compose'); setShowComposer(true); return; }`) is not a
// cheap skip path — the awaited call's side effects and the consequent's
// effects have an observable order, so hoisting the guard above the await
// changes behavior instead of just saving latency.
const guardConsequentPerformsSideEffects = (consequent: EsTreeNode | null | undefined): boolean => {
  if (!consequent) return false;
  let performsSideEffects = false;
  walkAst(consequent, (child: EsTreeNode): boolean | void => {
    if (performsSideEffects) return false;
    if (isFunctionLike(child)) return false;
    // Constructing the exception in `throw new Error(...)` is part of the
    // early exit itself, not ordered work — a throw-exit guard is exactly
    // the hoistable shape the rule targets.
    if (isNodeOfType(child, "ThrowStatement")) return false;
    if (
      isNodeOfType(child, "CallExpression") ||
      isNodeOfType(child, "NewExpression") ||
      isNodeOfType(child, "AssignmentExpression") ||
      isNodeOfType(child, "UpdateExpression")
    ) {
      performsSideEffects = true;
      return false;
    }
  });
  return performsSideEffects;
};

const findEnclosingFunction = (node: EsTreeNode): EsTreeNode | null => {
  let ancestor: EsTreeNode | null | undefined = node.parent;
  while (ancestor) {
    if (isFunctionLike(ancestor)) return ancestor;
    ancestor = ancestor.parent;
  }
  return null;
};

// `let failed = false; try { await del(); } catch { failed = true; }
// if (failed) return;` — the guard reads a local flag that the function
// itself reassigns, so the flag's value depends on work around the await.
const guardTestReadsReassignedLocal = (
  test: EsTreeNode | null,
  guardStatement: EsTreeNode,
): boolean => {
  if (!test) return false;
  const testIdentifierNames = new Set<string>();
  collectReferenceIdentifierNames(test, testIdentifierNames);
  if (testIdentifierNames.size === 0) return false;
  const enclosingFunction = findEnclosingFunction(guardStatement);
  if (!enclosingFunction || !isFunctionLike(enclosingFunction) || !enclosingFunction.body) {
    return false;
  }
  let readsReassignedLocal = false;
  walkAst(enclosingFunction.body, (child: EsTreeNode): boolean | void => {
    if (readsReassignedLocal) return false;
    let assignedTarget: EsTreeNode | null = null;
    if (isNodeOfType(child, "AssignmentExpression")) assignedTarget = child.left;
    else if (isNodeOfType(child, "UpdateExpression")) assignedTarget = child.argument;
    if (!assignedTarget) return;
    const assignedNames = new Set<string>();
    collectPatternNames(assignedTarget, assignedNames);
    if (isNodeOfType(assignedTarget, "Identifier")) assignedNames.add(assignedTarget.name);
    for (const name of assignedNames) {
      if (testIdentifierNames.has(name)) {
        readsReassignedLocal = true;
        return false;
      }
    }
  });
  return readsReassignedLocal;
};

// Walks forward from `startIndex` collecting an "await preamble" — the
// originating awaited statement plus any contiguous bare-await statements
// or VariableDeclarations whose declarators introduce their own await OR
// derive from the running `awaitedBindingNames`. Returns `null` when the
// statement at `startIndex` is not itself an awaiting statement.
const collectAwaitWindow = (statements: EsTreeNode[], startIndex: number): AwaitWindow | null => {
  const firstStatement = statements[startIndex];
  const awaitedBindingNames = new Set<string>();
  let isAwaitingStatement = false;
  let hasBareSideEffectAwait = false;
  if (isNodeOfType(firstStatement, "VariableDeclaration")) {
    const result = processVariableDeclaration(firstStatement, awaitedBindingNames);
    if (result.didIntroduceAwait) isAwaitingStatement = true;
  } else if (isBareAwaitExpressionStatement(firstStatement)) {
    isAwaitingStatement = true;
    hasBareSideEffectAwait = true;
  }
  if (!isAwaitingStatement) return null;

  let cursor = startIndex + 1;
  while (cursor < statements.length) {
    const candidate = statements[cursor];
    if (isBareAwaitExpressionStatement(candidate)) {
      hasBareSideEffectAwait = true;
      cursor++;
      continue;
    }
    if (!isNodeOfType(candidate, "VariableDeclaration")) break;
    const result = processVariableDeclaration(candidate, awaitedBindingNames);
    if (!result.didIntroduceAwait && !result.didGrowBindings) break;
    cursor++;
  }

  return {
    firstAwaitStatement: firstStatement,
    awaitedBindingNames,
    guardCandidateIndex: cursor,
    hasBareSideEffectAwait,
  };
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
export const asyncDeferAwait = defineRule({
  id: "async-defer-await",
  title: "await before an early-return guard",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Move the `await` below the early-return guard so the skip path stays fast and avoids unnecessary async work.",
  create: (context: RuleContext) => {
    const inspectStatements = (statements: EsTreeNode[]): void => {
      for (let statementIndex = 0; statementIndex < statements.length - 1; statementIndex++) {
        const window = collectAwaitWindow(statements, statementIndex);
        if (!window) continue;
        if (window.guardCandidateIndex >= statements.length) continue;
        const guardStatement = statements[window.guardCandidateIndex];
        if (!isEarlyExitIfStatement(guardStatement)) continue;
        if (!isNodeOfType(guardStatement, "IfStatement")) continue;

        if (window.hasBareSideEffectAwait || window.awaitedBindingNames.size === 0) {
          statementIndex = window.guardCandidateIndex - 1;
          continue;
        }

        const testIdentifierNames = new Set<string>();
        collectReferenceIdentifierNames(guardStatement.test, testIdentifierNames);
        if (hasAnyIdentifierName(testIdentifierNames, window.awaitedBindingNames)) {
          statementIndex = window.guardCandidateIndex - 1;
          continue;
        }
        if (
          isCancellationGuardTest(guardStatement.test) ||
          guardTestReadsMutableEnvironment(guardStatement.test) ||
          isNonLiteralComparisonTest(guardStatement.test) ||
          guardTestReadsReassignedLocal(guardStatement.test, guardStatement) ||
          guardConsequentPerformsSideEffects(guardStatement.consequent)
        ) {
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
            "This await blocks the function before an early-return that doesn't use the awaited value, so the skip path waits for nothing. Move the await below the guard so it only runs when you need the data",
        });
        statementIndex = window.guardCandidateIndex - 1;
      }
    };

    const inspectAllStatementBlocks = (functionBody: EsTreeNode | null | undefined): void => {
      if (!functionBody) return;
      walkAst(functionBody, (descendant: EsTreeNode) => {
        if (isFunctionLike(descendant)) return false;
        if (isNodeOfType(descendant, "BlockStatement")) {
          inspectStatements(descendant.body ?? []);
        } else if (isNodeOfType(descendant, "SwitchCase")) {
          inspectStatements(descendant.consequent ?? []);
        }
      });
    };

    const enterFunction = (node: EsTreeNode): void => {
      if (!isFunctionLike(node)) return;
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
