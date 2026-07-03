import { INTENTIONAL_SEQUENCING_CALLEE_NAMES, LOOP_TYPES } from "../../constants/js.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { containsDirectAwait } from "../../utils/contains-direct-await.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const findFirstAwaitOutsideNestedFunctions = (block: EsTreeNode): EsTreeNode | null => {
  let firstAwait: EsTreeNode | null = null;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (firstAwait) return false;
    if (child !== block && isFunctionLike(child)) {
      // Don't descend into nested functions — their `await`s belong to
      // their own async parent, not this loop. (`child !== block` so we
      // still walk the body of the loop callback itself when called with
      // the callback's body.)
      return false;
    }
    if (isNodeOfType(child, "AwaitExpression")) {
      firstAwait = child;
    }
  });
  return firstAwait;
};

// HACK: heuristic to reduce false positives in the asyncAwaitInLoop
// rule. Polling loops (`while (true) { await sleep(1000); … }`) and
// paginated fetches (`while (hasMore) { page = await fetch(cursor);
// cursor = page.next; }`) are intentionally sequential and should not
// be flagged. Same applies to database / file-system / process
// operations where serialization is required for transactions, FK
// constraints, mutation ordering, etc. The callee list is shared with
// `INTENTIONAL_SEQUENCING_CALLEE_NAMES` so the two rules can't diverge.
const isAwaitingSleepLikeCall = (awaitNode: EsTreeNode): boolean => {
  if (!isNodeOfType(awaitNode, "AwaitExpression")) return false;
  const argument = awaitNode.argument;
  if (!argument) return false;
  if (!isNodeOfType(argument, "CallExpression")) return false;
  if (
    isNodeOfType(argument.callee, "Identifier") &&
    INTENTIONAL_SEQUENCING_CALLEE_NAMES.has(argument.callee.name)
  ) {
    return true;
  }
  if (
    isNodeOfType(argument.callee, "MemberExpression") &&
    isNodeOfType(argument.callee.property, "Identifier") &&
    INTENTIONAL_SEQUENCING_CALLEE_NAMES.has(argument.callee.property.name)
  ) {
    return true;
  }
  return false;
};

const collectPatternIdentifiers = (pattern: EsTreeNode, target: Set<string>): void => {
  if (isNodeOfType(pattern, "Identifier")) {
    target.add(pattern.name);
  } else if (isNodeOfType(pattern, "ObjectPattern")) {
    for (const property of pattern.properties ?? []) {
      if (isNodeOfType(property, "Property") && property.value) {
        collectPatternIdentifiers(property.value, target);
      } else if (isNodeOfType(property, "RestElement") && property.argument) {
        collectPatternIdentifiers(property.argument, target);
      }
    }
  } else if (isNodeOfType(pattern, "ArrayPattern")) {
    for (const element of pattern.elements ?? []) {
      if (element) collectPatternIdentifiers(element, target);
    }
  } else if (isNodeOfType(pattern, "AssignmentPattern") && pattern.left) {
    collectPatternIdentifiers(pattern.left, target);
  }
};

const ARRAY_MUTATION_METHOD_NAMES = new Set(["push", "unshift", "splice"]);

// Variables initialized by reading any of `names` (e.g.
// `const prev = results[results.length - 1]`) carry the mutated array's
// state forward, so awaiting on them is also order-dependent. Iterated to
// a fixpoint to follow multi-step derivations. The declarators and their
// referenced names never change between passes, so they are collected in
// one walk and only the membership test repeats per round.
const addDerivedBindings = (block: EsTreeNode, names: Set<string>): void => {
  const declaratorBindings: Array<{ declaredName: string; referencedNames: Set<string> }> = [];
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (child !== block && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
    if (!isNodeOfType(child.id, "Identifier")) return;
    const referencedNames = new Set<string>();
    collectReferenceIdentifierNames(child.init, referencedNames);
    declaratorBindings.push({ declaredName: child.id.name, referencedNames });
  });
  let didGrow = true;
  while (didGrow) {
    didGrow = false;
    for (const { declaredName, referencedNames } of declaratorBindings) {
      if (names.has(declaredName)) continue;
      for (const referenced of referencedNames) {
        if (names.has(referenced)) {
          names.add(declaredName);
          didGrow = true;
          break;
        }
      }
    }
  }
};

// HACK: detects patterns like `cursor = (await fetch(cursor)).next` where
// the loop body assigns a variable that is then read by the next
// iteration's await argument — paginated fetch, retry loops, etc. Also
// covers carries that flow through an in-place array mutation
// (`results.push(await fetchNext(id, prev))` with `prev` read from
// `results`): the awaited argument reads a binding the loop mutates.
// Assignments, in-place array mutations, and awaited-argument reads inspect
// disjoint node types, so one walk collects all three signal sets.
const hasLoopCarriedDependency = (block: EsTreeNode): boolean => {
  const carried = new Set<string>();
  const awaitedReferences = new Set<string>();
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (child !== block && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "AssignmentExpression") && child.left) {
      collectPatternIdentifiers(child.left, carried);
      return;
    }
    if (isNodeOfType(child, "AwaitExpression") && child.argument) {
      collectReferenceIdentifierNames(child.argument, awaitedReferences);
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      ARRAY_MUTATION_METHOD_NAMES.has(callee.property.name) &&
      isNodeOfType(callee.object, "Identifier")
    ) {
      carried.add(callee.object.name);
    }
  });
  if (carried.size === 0) return false;
  addDerivedBindings(block, carried);
  for (const name of carried) {
    if (awaitedReferences.has(name)) return true;
  }
  return false;
};

const NESTED_LOOP_OR_SWITCH_TYPES: ReadonlySet<string> = new Set([
  ...LOOP_TYPES,
  "SwitchStatement",
]);

const collectAwaitAssignedBindingNames = (block: EsTreeNode): Set<string> => {
  const awaitAssignedNames = new Set<string>();
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (child !== block && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "VariableDeclarator") && child.id && containsDirectAwait(child.init)) {
      collectPatternIdentifiers(child.id, awaitAssignedNames);
    }
    if (
      isNodeOfType(child, "AssignmentExpression") &&
      child.left &&
      containsDirectAwait(child.right)
    ) {
      collectPatternIdentifiers(child.left, awaitAssignedNames);
    }
  });
  return awaitAssignedNames;
};

const isAwaitDependentTest = (
  test: EsTreeNode | null | undefined,
  awaitAssignedNames: ReadonlySet<string>,
): boolean => {
  if (!test) return false;
  if (containsDirectAwait(test)) return true;
  const referencedNames = new Set<string>();
  collectReferenceIdentifierNames(test, referencedNames);
  for (const referencedName of referencedNames) {
    if (awaitAssignedNames.has(referencedName)) return true;
  }
  return false;
};

// `break` is captured by the nearest enclosing loop/switch, so an unlabeled
// `break` only exits the inspected loop when no loop/switch sits between it
// and the loop body. A labeled `break` exits the inspected loop exactly when
// the label names the loop's own `LabeledStatement` (`break outer` from a
// nested loop).
const doesBreakExitInspectedLoop = (
  breakStatement: EsTreeNodeOfType<"BreakStatement">,
  block: EsTreeNode,
  loopLabelName: string | null,
): boolean => {
  if (breakStatement.label) {
    return (
      isNodeOfType(breakStatement.label, "Identifier") &&
      breakStatement.label.name === loopLabelName
    );
  }
  let ancestor: EsTreeNode | null | undefined = breakStatement.parent;
  while (ancestor && ancestor !== block) {
    if (NESTED_LOOP_OR_SWITCH_TYPES.has(ancestor.type)) return false;
    ancestor = ancestor.parent;
  }
  return true;
};

const ITERATION_SHORT_CIRCUIT_STATEMENT_TYPES: ReadonlySet<string> = new Set([
  "ContinueStatement",
  "BreakStatement",
  "ReturnStatement",
  "ThrowStatement",
]);

const doesGuardShortCircuitIteration = (branch: EsTreeNode | null | undefined): boolean => {
  if (!branch) return false;
  if (ITERATION_SHORT_CIRCUIT_STATEMENT_TYPES.has(branch.type)) return true;
  if (isNodeOfType(branch, "BlockStatement")) {
    const statements = branch.body ?? [];
    return doesGuardShortCircuitIteration(statements[statements.length - 1]);
  }
  return false;
};

// `const raw = await get(); if (!raw) continue; … return raw;` — a guard
// clause that short-circuits the iteration on the awaited value makes
// every LATER statement in the same list (including the exit) conditioned
// on that await, even though the guard is a sibling, not an ancestor.
const isPrecededByAwaitDependentGuard = (
  blockStatement: EsTreeNodeOfType<"BlockStatement">,
  childStatement: EsTreeNode,
  awaitAssignedNames: ReadonlySet<string>,
): boolean => {
  for (const siblingStatement of blockStatement.body ?? []) {
    if (siblingStatement === childStatement) return false;
    if (
      isNodeOfType(siblingStatement, "IfStatement") &&
      isAwaitDependentTest(siblingStatement.test, awaitAssignedNames) &&
      (doesGuardShortCircuitIteration(siblingStatement.consequent) ||
        doesGuardShortCircuitIteration(siblingStatement.alternate))
    ) {
      return true;
    }
  }
  return false;
};

const isExitAwaitDependent = (
  exitStatement: EsTreeNode,
  block: EsTreeNode,
  awaitAssignedNames: ReadonlySet<string>,
): boolean => {
  let childOfAncestor: EsTreeNode = exitStatement;
  let ancestor: EsTreeNode | null | undefined = exitStatement;
  while (ancestor) {
    if (
      isNodeOfType(ancestor, "IfStatement") &&
      isAwaitDependentTest(ancestor.test, awaitAssignedNames)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "SwitchStatement") &&
      isAwaitDependentTest(ancestor.discriminant, awaitAssignedNames)
    ) {
      return true;
    }
    if (
      isNodeOfType(ancestor, "BlockStatement") &&
      isPrecededByAwaitDependentGuard(ancestor, childOfAncestor, awaitAssignedNames)
    ) {
      return true;
    }
    if (ancestor === block) return false;
    childOfAncestor = ancestor;
    ancestor = ancestor.parent;
  }
  return false;
};

// A `return` / `break` that exits this loop CONDITIONED ON an awaited
// result means iterations are NOT independent: the loop short-circuits on
// the first hit (ordered fallback / first-success search), so the awaits
// must run in sequence — you can't decide whether to try iteration N+1
// until N resolves. Such a loop is order-dependent, not parallelizable, so
// we don't flag it. The condition can be an enclosing `if`/`switch` OR a
// preceding guard clause (`if (!raw) continue; … return raw;`). An exit
// whose condition never reads an awaited result (`if (signal.aborted)
// break;`) — or an unconditional one — doesn't make the awaits
// order-dependent, so the loop is still flagged.
const loopBodyHasAwaitDependentEarlyExit = (
  block: EsTreeNode,
  loopLabelName: string | null,
): boolean => {
  const awaitAssignedNames = collectAwaitAssignedBindingNames(block);
  addDerivedBindings(block, awaitAssignedNames);
  let hasAwaitDependentExit = false;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (hasAwaitDependentExit) return false;
    if (child !== block && isFunctionLike(child)) return false;
    const isExitOfInspectedLoop =
      isNodeOfType(child, "ReturnStatement") ||
      (isNodeOfType(child, "BreakStatement") &&
        doesBreakExitInspectedLoop(child, block, loopLabelName));
    if (!isExitOfInspectedLoop) return;
    if (isExitAwaitDependent(child, block, awaitAssignedNames)) {
      hasAwaitDependentExit = true;
      return false;
    }
  });
  return hasAwaitDependentExit;
};

const getLoopLabelName = (loopNode: EsTreeNode): string | null => {
  const parent = loopNode.parent;
  if (isNodeOfType(parent, "LabeledStatement") && isNodeOfType(parent.label, "Identifier")) {
    return parent.label.name;
  }
  return null;
};

const loopBodyHasOnlySleepLikeAwaits = (block: EsTreeNode): boolean => {
  let allAreSleepLike = true;
  let foundAny = false;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (isInlineFunctionExpression(child) || isNodeOfType(child, "FunctionDeclaration"))
      return false;
    if (isNodeOfType(child, "AwaitExpression")) {
      foundAny = true;
      if (!isAwaitingSleepLikeCall(child)) allAreSleepLike = false;
    }
  });
  return foundAny && allAreSleepLike;
};

const ITERATION_METHOD_NAMES_WITH_CALLBACK = new Set([
  "forEach",
  "map",
  "filter",
  "reduce",
  "reduceRight",
  "find",
  "findIndex",
  "some",
  "every",
  "flatMap",
]);

// HACK: `await Promise.all(items.map(async item => { await fetch(item); }))`
// is the canonical PARALLEL-async pattern — not a bug. The async callbacks
// produce an array of promises that `Promise.all` (and friends) await
// concurrently. Don't flag `.map` (or `.flatMap`) when its result flows
// directly into one of the concurrency combinators. We only recognise
// direct member calls (`Promise.all(...)`) since that's how 99% of code
// writes it; `Promise["all"](...)` etc. are rare enough to accept.
const PROMISE_CONCURRENCY_METHODS = new Set(["all", "allSettled", "race", "any"]);

const isWrappedInPromiseConcurrency = (mapCall: EsTreeNode): boolean => {
  const parent = mapCall.parent;
  if (!isNodeOfType(parent, "CallExpression")) return false;
  if (parent.arguments?.[0] !== mapCall) return false;
  const callee = parent.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Promise") return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return PROMISE_CONCURRENCY_METHODS.has(callee.property.name);
};

export const asyncAwaitInLoop = defineRule({
  id: "async-await-in-loop",
  title: "await inside a loop",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Collect the items, then use `await Promise.all(items.map(...))` so independent work runs at the same time",
  create: (context: RuleContext) => {
    const inspectLoop = (
      loopNode:
        | EsTreeNodeOfType<"ForStatement">
        | EsTreeNodeOfType<"ForInStatement">
        | EsTreeNodeOfType<"ForOfStatement">
        | EsTreeNodeOfType<"WhileStatement">
        | EsTreeNodeOfType<"DoWhileStatement">,
      label: string,
    ): void => {
      const loopBody = loopNode.body;
      if (!loopBody) return;
      if (loopBodyHasOnlySleepLikeAwaits(loopBody)) return;
      if (hasLoopCarriedDependency(loopBody)) return;
      if (loopBodyHasAwaitDependentEarlyExit(loopBody, getLoopLabelName(loopNode))) return;
      const firstAwait = findFirstAwaitOutsideNestedFunctions(loopBody);
      if (firstAwait) {
        context.report({
          node: firstAwait,
          message: `This makes the ${label} slow because each await runs one after another, so collect the independent calls & run them together with \`await Promise.all(items.map(...))\``,
        });
      }
    };

    return {
      ForStatement(node: EsTreeNodeOfType<"ForStatement">) {
        inspectLoop(node, "for-loop");
      },
      ForInStatement(node: EsTreeNodeOfType<"ForInStatement">) {
        inspectLoop(node, "for…in loop");
      },
      ForOfStatement(node: EsTreeNodeOfType<"ForOfStatement">) {
        // `for await (const x of …)` is the legitimate async-iterator
        // pattern — skip it.
        if (node.await) return;
        inspectLoop(node, "for…of loop");
      },
      WhileStatement(node: EsTreeNodeOfType<"WhileStatement">) {
        inspectLoop(node, "while-loop");
      },
      DoWhileStatement(node: EsTreeNodeOfType<"DoWhileStatement">) {
        inspectLoop(node, "do-while loop");
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        // arr.forEach(async item => { await fn(item); }) — sequential
        // because forEach doesn't await; even worse, the awaits are
        // dropped on the floor (forEach ignores return values).
        if (!isNodeOfType(node.callee, "MemberExpression")) return;
        if (!isNodeOfType(node.callee.property, "Identifier")) return;
        const methodName = node.callee.property.name;
        if (!ITERATION_METHOD_NAMES_WITH_CALLBACK.has(methodName)) return;

        const callback = node.arguments?.[0];
        if (!callback || !isInlineFunctionExpression(callback)) return;
        if (!callback.async) return;
        const body = callback.body;
        if (!body) return;

        if (
          (methodName === "map" || methodName === "flatMap") &&
          isWrappedInPromiseConcurrency(node)
        ) {
          return;
        }
        const firstAwait = findFirstAwaitOutsideNestedFunctions(body);
        if (firstAwait) {
          const message =
            methodName === "forEach"
              ? "Async callback in .forEach silently drops every await, so the work never finishes before the loop moves on. Use a `for…of` loop, or `await Promise.all(items.map(async (item) => {...}))`"
              : `Async callback in .${methodName} runs the awaits one after another, so it is slow. Use \`await Promise.all(items.map(async (item) => {...}))\` to run them at the same time`;
          context.report({ node: firstAwait, message });
        }
      },
    };
  },
});
