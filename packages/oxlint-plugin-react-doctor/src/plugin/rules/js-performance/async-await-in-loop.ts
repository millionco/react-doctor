import { INTENTIONAL_SEQUENCING_CALLEE_NAMES, LOOP_TYPES } from "../../constants/js.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
import { containsDirectAwait } from "../../utils/contains-direct-await.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findTransparentExpressionRoot } from "../../utils/find-transparent-expression-root.js";
import { getOrderIndependentLocalFunction } from "../../utils/get-order-independent-local-function.js";
import { hasPossibleStaticMemberCallWrite } from "../../utils/has-static-property-write-before.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const LOOP_STATEMENT_TYPES: ReadonlySet<string> = new Set(LOOP_TYPES);

const findFirstAwaitOutsideNestedFunctions = (
  block: EsTreeNode,
  skipNestedLoops = false,
): EsTreeNode | null => {
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
    // Nested loops are inspected as their own unit, with their own
    // exemptions — attributing their awaits to the outer loop both
    // double-reports and bypasses those exemptions.
    if (skipNestedLoops && child !== block && LOOP_STATEMENT_TYPES.has(child.type)) return false;
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
const isIntentionalSequencingCallee = (callee: EsTreeNode | null | undefined): boolean => {
  if (isNodeOfType(callee, "Identifier")) {
    return INTENTIONAL_SEQUENCING_CALLEE_NAMES.has(callee.name);
  }
  if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
    return INTENTIONAL_SEQUENCING_CALLEE_NAMES.has(callee.property.name);
  }
  return false;
};

const isAwaitingSleepLikeCall = (awaitNode: EsTreeNode, context: RuleContext): boolean => {
  if (!isNodeOfType(awaitNode, "AwaitExpression")) return false;
  const argument = awaitNode.argument;
  if (!argument) return false;
  if (!isNodeOfType(argument, "CallExpression")) return false;
  if (getOrderIndependentLocalFunction(argument, context.scopes) !== null) return false;
  return isIntentionalSequencingCallee(argument.callee);
};

const isAwaitingPossiblyMutatedMemberCall = (
  awaitNode: EsTreeNode,
  context: RuleContext,
): boolean =>
  isNodeOfType(awaitNode, "AwaitExpression") &&
  Boolean(awaitNode.argument) &&
  hasPossibleStaticMemberCallWrite(awaitNode.argument, context.scopes);

const PROMISE_CONCURRENCY_METHODS = new Set(["all", "allSettled", "race", "any"]);

const isPromiseConcurrencyCall = (
  node: EsTreeNode | null | undefined,
): node is EsTreeNodeOfType<"CallExpression"> => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  const callee = node.callee;
  if (!isNodeOfType(callee, "MemberExpression") || callee.computed) return false;
  if (!isNodeOfType(callee.object, "Identifier") || callee.object.name !== "Promise") return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return PROMISE_CONCURRENCY_METHODS.has(callee.property.name);
};

// `for (const chunk of chunks) { await Promise.all(chunk.map(...)); }` is
// deliberate bounded concurrency (batching / rate limiting): the work
// already runs in parallel within each batch, and the sequential batches
// are the point. Awaiting a combinator is never the naive one-at-a-time
// mistake this rule targets.
const isAwaitingPromiseConcurrencyCall = (awaitNode: EsTreeNode): boolean => {
  if (!isNodeOfType(awaitNode, "AwaitExpression")) return false;
  return isPromiseConcurrencyCall(awaitNode.argument);
};

// `await new Promise((resolve) => setTimeout(resolve, delay))` — and the
// event-wait variant that stashes `resolve` for an external caller — are
// manual sleeps/waits, sequential by design just like a named `sleep()`.
const isAwaitingManualPromiseWait = (awaitNode: EsTreeNode): boolean => {
  if (!isNodeOfType(awaitNode, "AwaitExpression")) return false;
  const argument = awaitNode.argument;
  if (!isNodeOfType(argument, "NewExpression")) return false;
  if (!isNodeOfType(argument.callee, "Identifier") || argument.callee.name !== "Promise") {
    return false;
  }
  const executor = argument.arguments?.[0];
  if (
    isNodeOfType(executor, "Identifier") &&
    INTENTIONAL_SEQUENCING_CALLEE_NAMES.has(executor.name)
  ) {
    return true;
  }
  if (!isInlineFunctionExpression(executor)) return false;
  const resolveParam = executor.params?.[0];
  const resolveParamName = isNodeOfType(resolveParam, "Identifier") ? resolveParam.name : null;
  let isWaitLike = false;
  walkAst(executor.body, (child: EsTreeNode): boolean | void => {
    if (isWaitLike) return false;
    if (isNodeOfType(child, "CallExpression") && isIntentionalSequencingCallee(child.callee)) {
      isWaitLike = true;
      return false;
    }
    if (
      resolveParamName &&
      isNodeOfType(child, "AssignmentExpression") &&
      isNodeOfType(child.right, "Identifier") &&
      child.right.name === resolveParamName
    ) {
      isWaitLike = true;
      return false;
    }
  });
  return isWaitLike;
};

const isIntentionallySequentialAwait = (awaitNode: EsTreeNode, context: RuleContext): boolean =>
  isAwaitingPossiblyMutatedMemberCall(awaitNode, context) ||
  isAwaitingSleepLikeCall(awaitNode, context) ||
  isAwaitingPromiseConcurrencyCall(awaitNode) ||
  isAwaitingManualPromiseWait(awaitNode);

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
  // `return dataUrl` / `return await op()` — an exit that carries an
  // awaited value out of the loop is conditioned on the await by data flow.
  if (
    isNodeOfType(exitStatement, "ReturnStatement") &&
    exitStatement.argument &&
    isAwaitDependentTest(exitStatement.argument, awaitAssignedNames)
  ) {
    return true;
  }
  let isExitGuardedByAwaitIndependentCondition = false;
  let childOfAncestor: EsTreeNode = exitStatement;
  let ancestor: EsTreeNode | null | undefined = exitStatement;
  while (ancestor) {
    if (isNodeOfType(ancestor, "IfStatement")) {
      if (isAwaitDependentTest(ancestor.test, awaitAssignedNames)) return true;
      isExitGuardedByAwaitIndependentCondition = true;
    }
    // `try { return await op(); } catch { … }` — the exit only happens when
    // the awaited call succeeds, so this is a retry-until-success loop: the
    // exit is conditioned on the await through exception control flow. A
    // bare exit guarded by an await-INDEPENDENT condition inside the try
    // (`if (cancelled) return;`) is a cancellation check, not a success
    // exit, so it doesn't make the awaits order-dependent.
    if (
      isNodeOfType(ancestor, "TryStatement") &&
      ancestor.handler &&
      childOfAncestor === ancestor.block &&
      containsDirectAwait(ancestor.block) &&
      !isExitGuardedByAwaitIndependentCondition
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

const getRootObjectIdentifierName = (node: EsTreeNode | null | undefined): string | null => {
  let current: EsTreeNode | null | undefined = node;
  while (isNodeOfType(current, "MemberExpression")) {
    current = current.object;
  }
  return isNodeOfType(current, "Identifier") ? current.name : null;
};

const MUTATING_ARRAY_METHOD_NAMES = new Set([...ARRAY_MUTATION_METHOD_NAMES, "pop", "shift"]);

const collectBodyWrittenBindingNames = (block: EsTreeNode): Set<string> => {
  const writtenNames = new Set<string>();
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (child !== block && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "AssignmentExpression") && child.left) {
      collectPatternIdentifiers(child.left, writtenNames);
      const assignedRootName = getRootObjectIdentifierName(child.left);
      if (assignedRootName) writtenNames.add(assignedRootName);
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      MUTATING_ARRAY_METHOD_NAMES.has(callee.property.name)
    ) {
      const receiverRootName = getRootObjectIdentifierName(callee.object);
      if (receiverRootName) writtenNames.add(receiverRootName);
    }
  });
  return writtenNames;
};

// A `while`/`do-while` whose continuation condition reads state the body
// writes (drain queues, pagination cursors, `while (!done)` stream pumps,
// fetch-until-enough accumulators) is sequential BY CONSTRUCTION — the
// next iteration cannot be decided before the current one finishes.
const isLoopTestDependentOnBodyState = (
  test: EsTreeNode | null | undefined,
  body: EsTreeNode,
): boolean => {
  if (!test) return false;
  const testReferencedNames = new Set<string>();
  collectReferenceIdentifierNames(test, testReferencedNames);
  if (testReferencedNames.size === 0) return false;
  const writtenNames = collectBodyWrittenBindingNames(body);
  const awaitAssignedNames = collectAwaitAssignedBindingNames(body);
  addDerivedBindings(body, awaitAssignedNames);
  for (const referencedName of testReferencedNames) {
    if (writtenNames.has(referencedName) || awaitAssignedNames.has(referencedName)) return true;
  }
  return false;
};

const getLoopLabelName = (loopNode: EsTreeNode): string | null => {
  const parent = loopNode.parent;
  if (isNodeOfType(parent, "LabeledStatement") && isNodeOfType(parent.label, "Identifier")) {
    return parent.label.name;
  }
  return null;
};

// One deliberate sequencing await in the body — a backoff sleep, a
// `Promise.all` over a batch, a DB transaction step — marks the WHOLE loop
// as intentionally paced: the author already chose sequential execution,
// so parallelizing the remaining awaits would change semantics.
const loopBodyHasIntentionallySequentialAwait = (
  block: EsTreeNode,
  context: RuleContext,
): boolean => {
  let foundIntentional = false;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (foundIntentional) return false;
    if (isInlineFunctionExpression(child) || isNodeOfType(child, "FunctionDeclaration"))
      return false;
    if (isNodeOfType(child, "AwaitExpression") && isIntentionallySequentialAwait(child, context)) {
      foundIntentional = true;
      return false;
    }
  });
  return foundIntentional;
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
// concurrently. The promise array may flow into the combinator through a
// chained `.filter(...)`, an array literal / spread, or a local binding
// that is combined later (`const jobs = items.map(async …); await
// Promise.all(jobs)`), so follow those transparent hops before deciding.
const CHAINED_ARRAY_METHOD_NAMES = new Set([
  "filter",
  "flat",
  "slice",
  "concat",
  "reverse",
  "sort",
  "toReversed",
  "toSorted",
]);

const resolvePromiseFlowNode = (mapCall: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode = mapCall;
  while (true) {
    current = findTransparentExpressionRoot(current);
    const parent = current.parent;
    if (!parent) return current;
    if (isNodeOfType(parent, "SpreadElement") || isNodeOfType(parent, "ArrayExpression")) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "LogicalExpression")) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "ConditionalExpression") && parent.test !== current) {
      current = parent;
      continue;
    }
    if (isNodeOfType(parent, "MemberExpression") && parent.object === current) {
      const grandParent = parent.parent;
      if (
        isNodeOfType(grandParent, "CallExpression") &&
        grandParent.callee === parent &&
        !parent.computed &&
        isNodeOfType(parent.property, "Identifier") &&
        CHAINED_ARRAY_METHOD_NAMES.has(parent.property.name)
      ) {
        current = grandParent;
        continue;
      }
    }
    return current;
  }
};

const findEnclosingFunctionOrProgram = (node: EsTreeNode): EsTreeNode => {
  let current: EsTreeNode = node;
  while (current.parent && !isFunctionLike(current)) {
    current = current.parent;
  }
  return current;
};

const isBindingCombinedWithPromiseConcurrency = (
  bindingName: string,
  scope: EsTreeNode,
): boolean => {
  let isCombined = false;
  walkAst(scope, (child: EsTreeNode): boolean | void => {
    if (isCombined) return false;
    if (!isPromiseConcurrencyCall(child)) return;
    const referencedNames = new Set<string>();
    for (const combinatorArgument of child.arguments ?? []) {
      collectReferenceIdentifierNames(combinatorArgument, referencedNames);
    }
    if (referencedNames.has(bindingName)) {
      isCombined = true;
      return false;
    }
  });
  return isCombined;
};

const isWrappedInPromiseConcurrency = (mapCall: EsTreeNode): boolean => {
  const flowNode = resolvePromiseFlowNode(mapCall);
  const parent = flowNode.parent;
  if (
    isNodeOfType(parent, "CallExpression") &&
    isPromiseConcurrencyCall(parent) &&
    (parent.arguments ?? []).some((argument) => argument === flowNode)
  ) {
    return true;
  }
  let bindingName: string | null = null;
  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === flowNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    bindingName = parent.id.name;
  } else if (
    isNodeOfType(parent, "AssignmentExpression") &&
    parent.right === flowNode &&
    isNodeOfType(parent.left, "Identifier")
  ) {
    bindingName = parent.left.name;
  }
  if (!bindingName || !parent) return false;
  return isBindingCombinedWithPromiseConcurrency(
    bindingName,
    findEnclosingFunctionOrProgram(parent),
  );
};

// A sequential loop inside a `worker` function that is instantiated
// several times into `Promise.all(Array.from({ length: N }, worker))` is
// a bounded worker pool: each worker draining items one at a time IS the
// concurrency-limit mechanism, not a missed parallelization.
const isLoopInsideWorkerPoolFunction = (loopNode: EsTreeNode): boolean => {
  const enclosingFunction = findEnclosingFunctionOrProgram(loopNode);
  if (!isFunctionLike(enclosingFunction)) return false;
  let functionBindingName: string | null = null;
  if (
    isNodeOfType(enclosingFunction, "FunctionDeclaration") &&
    isNodeOfType(enclosingFunction.id, "Identifier")
  ) {
    functionBindingName = enclosingFunction.id.name;
  } else if (
    isNodeOfType(enclosingFunction.parent, "VariableDeclarator") &&
    isNodeOfType(enclosingFunction.parent.id, "Identifier")
  ) {
    functionBindingName = enclosingFunction.parent.id.name;
  }
  if (!functionBindingName || !enclosingFunction.parent) return false;
  return isBindingCombinedWithPromiseConcurrency(
    functionBindingName,
    findEnclosingFunctionOrProgram(enclosingFunction.parent),
  );
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
      if (loopBodyHasIntentionallySequentialAwait(loopBody, context)) return;
      if (
        (isNodeOfType(loopNode, "WhileStatement") || isNodeOfType(loopNode, "DoWhileStatement")) &&
        isLoopTestDependentOnBodyState(loopNode.test, loopBody)
      ) {
        return;
      }
      if (hasLoopCarriedDependency(loopBody)) return;
      if (loopBodyHasAwaitDependentEarlyExit(loopBody, getLoopLabelName(loopNode))) return;
      if (isLoopInsideWorkerPoolFunction(loopNode)) return;
      const firstAwait = findFirstAwaitOutsideNestedFunctions(loopBody, true);
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
