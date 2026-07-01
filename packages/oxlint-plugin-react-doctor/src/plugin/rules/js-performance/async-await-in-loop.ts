import { INTENTIONAL_SEQUENCING_CALLEE_NAMES, LOOP_TYPES } from "../../constants/js.js";
import { collectReferenceIdentifierNames } from "../../utils/collect-reference-identifier-names.js";
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

const collectAssignedIdentifiers = (block: EsTreeNode): Set<string> => {
  const assigned = new Set<string>();
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (isInlineFunctionExpression(child) || isNodeOfType(child, "FunctionDeclaration"))
      return false;
    if (isNodeOfType(child, "AssignmentExpression") && child.left) {
      collectPatternIdentifiers(child.left, assigned);
    }
  });
  return assigned;
};

const collectAwaitedArgIdentifiers = (block: EsTreeNode): Set<string> => {
  const referenced = new Set<string>();
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (isInlineFunctionExpression(child) || isNodeOfType(child, "FunctionDeclaration"))
      return false;
    if (!isNodeOfType(child, "AwaitExpression") || !child.argument) return;
    walkAst(child.argument, (innerChild: EsTreeNode) => {
      if (isNodeOfType(innerChild, "Identifier")) referenced.add(innerChild.name);
      if (
        isNodeOfType(innerChild, "MemberExpression") &&
        isNodeOfType(innerChild.object, "Identifier")
      ) {
        referenced.add(innerChild.object.name);
      }
    });
  });
  return referenced;
};

const ARRAY_MUTATION_METHOD_NAMES = new Set(["push", "unshift", "splice"]);

// Arrays mutated in-place (`results.push(...)`, `acc.unshift(...)`) carry
// state across iterations just like a reassigned variable. Collect the
// mutated object's name so a later iteration reading from it counts as a
// loop-carried dependency.
const collectMutatedArrayNames = (block: EsTreeNode): Set<string> => {
  const mutated = new Set<string>();
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (child !== block && isFunctionLike(child)) return false;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (
      isNodeOfType(callee, "MemberExpression") &&
      !callee.computed &&
      isNodeOfType(callee.property, "Identifier") &&
      ARRAY_MUTATION_METHOD_NAMES.has(callee.property.name) &&
      isNodeOfType(callee.object, "Identifier")
    ) {
      mutated.add(callee.object.name);
    }
  });
  return mutated;
};

// Variables initialized by reading any of `names` (e.g.
// `const prev = results[results.length - 1]`) carry the mutated array's
// state forward, so awaiting on them is also order-dependent. Iterated to
// a fixpoint to follow multi-step derivations.
const addDerivedBindings = (block: EsTreeNode, names: Set<string>): void => {
  let didGrow = true;
  while (didGrow) {
    didGrow = false;
    walkAst(block, (child: EsTreeNode): boolean | void => {
      if (child !== block && isFunctionLike(child)) return false;
      if (!isNodeOfType(child, "VariableDeclarator") || !child.init) return;
      if (!isNodeOfType(child.id, "Identifier") || names.has(child.id.name)) return;
      const initReferences = new Set<string>();
      collectReferenceIdentifierNames(child.init, initReferences);
      for (const referenced of initReferences) {
        if (names.has(referenced)) {
          names.add(child.id.name);
          didGrow = true;
          break;
        }
      }
    });
  }
};

// HACK: detects patterns like `cursor = (await fetch(cursor)).next` where
// the loop body assigns a variable that is then read by the next
// iteration's await argument — paginated fetch, retry loops, etc. Also
// covers carries that flow through an in-place array mutation
// (`results.push(await fetchNext(id, prev))` with `prev` read from
// `results`): the awaited argument reads a binding the loop mutates.
const hasLoopCarriedDependency = (block: EsTreeNode): boolean => {
  const carried = collectAssignedIdentifiers(block);
  for (const name of collectMutatedArrayNames(block)) carried.add(name);
  if (carried.size === 0) return false;
  addDerivedBindings(block, carried);
  const awaitedReferences = collectAwaitedArgIdentifiers(block);
  for (const name of carried) {
    if (awaitedReferences.has(name)) return true;
  }
  return false;
};

const NESTED_LOOP_OR_SWITCH_TYPES: ReadonlySet<string> = new Set([
  ...LOOP_TYPES,
  "SwitchStatement",
]);

// A `return` / `break` at this loop's own level means iterations are
// NOT independent: the loop short-circuits on the first hit (ordered
// fallback / first-success search), so the awaits must run in sequence
// — you can't decide whether to try iteration N+1 until N resolves.
// Such a loop is order-dependent, not parallelizable, so we don't flag it.
//
// The two exits prune differently:
//   - `return` exits the whole function (and so this loop) from anywhere
//     except a NESTED function — including from inside a `switch` or a
//     nested loop. Prune only function-like subtrees.
//   - `break` is captured by the nearest enclosing loop/switch, so it only
//     short-circuits THIS loop when it isn't nested inside another one.
//     Prune nested loops/switches (and functions) too.
const loopBodyHasEarlyExit = (block: EsTreeNode): boolean => {
  let hasReturn = false;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (hasReturn) return false;
    if (child !== block && isFunctionLike(child)) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      hasReturn = true;
      return false;
    }
  });
  if (hasReturn) return true;

  let hasBreak = false;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (hasBreak) return false;
    if (child !== block && (isFunctionLike(child) || NESTED_LOOP_OR_SWITCH_TYPES.has(child.type))) {
      return false;
    }
    if (isNodeOfType(child, "BreakStatement")) {
      hasBreak = true;
      return false;
    }
  });
  return hasBreak;
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
    const inspectLoopBody = (loopBody: EsTreeNode | null | undefined, label: string): void => {
      if (!loopBody) return;
      if (loopBodyHasOnlySleepLikeAwaits(loopBody)) return;
      if (hasLoopCarriedDependency(loopBody)) return;
      if (loopBodyHasEarlyExit(loopBody)) return;
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
        inspectLoopBody(node.body, "for-loop");
      },
      ForInStatement(node: EsTreeNodeOfType<"ForInStatement">) {
        inspectLoopBody(node.body, "for…in loop");
      },
      ForOfStatement(node: EsTreeNodeOfType<"ForOfStatement">) {
        // `for await (const x of …)` is the legitimate async-iterator
        // pattern — skip it.
        if (node.await) return;
        inspectLoopBody(node.body, "for…of loop");
      },
      WhileStatement(node: EsTreeNodeOfType<"WhileStatement">) {
        inspectLoopBody(node.body, "while-loop");
      },
      DoWhileStatement(node: EsTreeNodeOfType<"DoWhileStatement">) {
        inspectLoopBody(node.body, "do-while loop");
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
