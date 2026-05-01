import {
  CHAINABLE_ITERATION_METHODS,
  DEEP_NESTING_THRESHOLD,
  DUPLICATE_STORAGE_READ_THRESHOLD,
  PROPERTY_ACCESS_REPEAT_THRESHOLD,
  SEQUENTIAL_AWAIT_THRESHOLD,
  STORAGE_OBJECTS,
  TEST_FILE_PATTERN,
} from "../constants.js";
import { createLoopAwareVisitors, isMemberProperty, walkAst } from "../helpers.js";
import type { EsTreeNode, Rule, RuleContext } from "../types.js";

export const jsCombineIterations: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
        return;

      const outerMethod = node.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

      const innerCall = node.callee.object;
      if (
        innerCall?.type !== "CallExpression" ||
        innerCall.callee?.type !== "MemberExpression" ||
        innerCall.callee.property?.type !== "Identifier"
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;

      if (innerMethod === "map" && outerMethod === "filter") {
        const filterArgument = node.arguments?.[0];
        const isBooleanOrIdentityFilter =
          (filterArgument?.type === "Identifier" && filterArgument.name === "Boolean") ||
          (filterArgument?.type === "ArrowFunctionExpression" &&
            filterArgument.params?.length === 1 &&
            filterArgument.body?.type === "Identifier" &&
            filterArgument.params[0]?.type === "Identifier" &&
            filterArgument.body.name === filterArgument.params[0].name);
        if (isBooleanOrIdentityFilter) return;
      }

      context.report({
        node,
        message: `.${innerMethod}().${outerMethod}() iterates the array twice — combine into a single loop with .reduce() or for...of`,
      });
    },
  }),
};

export const jsTosortedImmutable: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (!isMemberProperty(node.callee, "sort")) return;

      const receiver = node.callee.object;
      if (
        receiver?.type === "ArrayExpression" &&
        receiver.elements?.length === 1 &&
        receiver.elements[0]?.type === "SpreadElement"
      ) {
        context.report({
          node,
          message: "[...array].sort() — use array.toSorted() for immutable sorting (ES2023)",
        });
      }
    },
  }),
};

export const jsHoistRegexp: Rule = {
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      NewExpression(node: EsTreeNode) {
        if (node.callee?.type === "Identifier" && node.callee.name === "RegExp") {
          context.report({
            node,
            message: "new RegExp() inside a loop — hoist to a module-level constant",
          });
        }
      },
    }),
};

export const jsMinMaxLoop: Rule = {
  create: (context: RuleContext) => ({
    MemberExpression(node: EsTreeNode) {
      if (!node.computed) return;

      const object = node.object;
      if (object?.type !== "CallExpression" || !isMemberProperty(object.callee, "sort")) return;

      const isFirstElement = node.property?.type === "Literal" && node.property.value === 0;
      const isLastElement =
        node.property?.type === "BinaryExpression" &&
        node.property.operator === "-" &&
        node.property.right?.type === "Literal" &&
        node.property.right.value === 1;

      if (isFirstElement || isLastElement) {
        const targetFunction = isFirstElement ? "min" : "max";
        context.report({
          node,
          message: `array.sort()[${isFirstElement ? "0" : "length-1"}] for min/max — use Math.${targetFunction}(...array) instead (O(n) vs O(n log n))`,
        });
      }
    },
  }),
};

export const jsSetMapLookups: Rule = {
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
          return;
        const methodName = node.callee.property.name;
        if (methodName === "includes" || methodName === "indexOf") {
          context.report({
            node,
            message: `array.${methodName}() in a loop is O(n) per call — convert to a Set for O(1) lookups`,
          });
        }
      },
    }),
};

export const jsBatchDomCss: Rule = {
  create: (context: RuleContext) => {
    const isStyleAssignment = (node: EsTreeNode): boolean =>
      node.type === "ExpressionStatement" &&
      node.expression?.type === "AssignmentExpression" &&
      node.expression.left?.type === "MemberExpression" &&
      node.expression.left.object?.type === "MemberExpression" &&
      node.expression.left.object.property?.type === "Identifier" &&
      node.expression.left.object.property.name === "style";

    return {
      BlockStatement(node: EsTreeNode) {
        const statements = node.body ?? [];
        for (let statementIndex = 1; statementIndex < statements.length; statementIndex++) {
          if (
            isStyleAssignment(statements[statementIndex]) &&
            isStyleAssignment(statements[statementIndex - 1])
          ) {
            context.report({
              node: statements[statementIndex],
              message:
                "Multiple sequential element.style assignments — batch with cssText or classList for fewer reflows",
            });
          }
        }
      },
    };
  },
};

export const jsIndexMaps: Rule = {
  create: (context: RuleContext) =>
    createLoopAwareVisitors({
      CallExpression(node: EsTreeNode) {
        if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
          return;
        const methodName = node.callee.property.name;
        if (methodName === "find" || methodName === "findIndex") {
          context.report({
            node,
            message: `array.${methodName}() in a loop is O(n*m) — build a Map for O(1) lookups`,
          });
        }
      },
    }),
};

export const jsCacheStorage: Rule = {
  create: (context: RuleContext) => {
    const storageReadCounts = new Map<string, number>();

    return {
      CallExpression(node: EsTreeNode) {
        if (!isMemberProperty(node.callee, "getItem")) return;
        if (
          node.callee.object?.type !== "Identifier" ||
          !STORAGE_OBJECTS.has(node.callee.object.name)
        )
          return;
        if (node.arguments?.[0]?.type !== "Literal") return;

        const storageKey = String(node.arguments[0].value);
        const readCount = (storageReadCounts.get(storageKey) ?? 0) + 1;
        storageReadCounts.set(storageKey, readCount);

        if (readCount === DUPLICATE_STORAGE_READ_THRESHOLD) {
          const storageName = node.callee.object.name;
          context.report({
            node,
            message: `${storageName}.getItem("${storageKey}") called multiple times — cache the result in a variable`,
          });
        }
      },
    };
  },
};

export const jsEarlyExit: Rule = {
  create: (context: RuleContext) => ({
    IfStatement(node: EsTreeNode) {
      if (node.consequent?.type !== "BlockStatement" || !node.consequent.body) return;

      let nestingDepth = 0;
      let currentBlock = node.consequent;
      while (currentBlock?.type === "BlockStatement" && currentBlock.body?.length === 1) {
        const innerStatement = currentBlock.body[0];
        if (innerStatement.type !== "IfStatement") break;
        nestingDepth++;
        currentBlock = innerStatement.consequent;
      }

      if (nestingDepth >= DEEP_NESTING_THRESHOLD) {
        context.report({
          node,
          message: `${nestingDepth + 1} levels of nested if statements — use early returns to flatten`,
        });
      }
    },
  }),
};

export const asyncParallel: Rule = {
  create: (context: RuleContext) => {
    const filename = context.getFilename?.() ?? "";
    const isTestFile = TEST_FILE_PATTERN.test(filename);

    return {
      BlockStatement(node: EsTreeNode) {
        if (isTestFile) return;
        const consecutiveAwaitStatements: EsTreeNode[] = [];

        const flushConsecutiveAwaits = (): void => {
          if (consecutiveAwaitStatements.length >= SEQUENTIAL_AWAIT_THRESHOLD) {
            reportIfIndependent(consecutiveAwaitStatements, context);
          }
          consecutiveAwaitStatements.length = 0;
        };

        for (const statement of node.body ?? []) {
          const isAwaitStatement =
            (statement.type === "VariableDeclaration" &&
              statement.declarations?.length === 1 &&
              statement.declarations[0].init?.type === "AwaitExpression") ||
            (statement.type === "ExpressionStatement" &&
              statement.expression?.type === "AwaitExpression");

          if (isAwaitStatement) {
            consecutiveAwaitStatements.push(statement);
          } else {
            flushConsecutiveAwaits();
          }
        }
        flushConsecutiveAwaits();
      },
    };
  },
};

const reportIfIndependent = (statements: EsTreeNode[], context: RuleContext): void => {
  const declaredNames = new Set<string>();

  for (const statement of statements) {
    if (statement.type !== "VariableDeclaration") continue;
    const declarator = statement.declarations[0];
    const awaitArgument = declarator.init?.argument;

    let referencesEarlierResult = false;
    walkAst(awaitArgument, (child: EsTreeNode) => {
      if (child.type === "Identifier" && declaredNames.has(child.name)) {
        referencesEarlierResult = true;
      }
    });

    if (referencesEarlierResult) return;

    if (declarator.id?.type === "Identifier") {
      declaredNames.add(declarator.id.name);
    }
  }

  context.report({
    node: statements[0],
    message: `${statements.length} sequential await statements that appear independent — use Promise.all() for parallel execution`,
  });
};

export const jsFlatmapFilter: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression" || node.callee.property?.type !== "Identifier")
        return;

      const outerMethod = node.callee.property.name;
      if (outerMethod !== "filter") return;

      const filterArgument = node.arguments?.[0];
      if (!filterArgument) return;

      const isIdentityArrow =
        filterArgument.type === "ArrowFunctionExpression" &&
        filterArgument.params?.length === 1 &&
        filterArgument.body?.type === "Identifier" &&
        filterArgument.params[0]?.type === "Identifier" &&
        filterArgument.body.name === filterArgument.params[0].name;

      const isFilterBoolean =
        (filterArgument.type === "Identifier" && filterArgument.name === "Boolean") ||
        isIdentityArrow;

      if (!isFilterBoolean) return;

      const innerCall = node.callee.object;
      if (
        innerCall?.type !== "CallExpression" ||
        innerCall.callee?.type !== "MemberExpression" ||
        innerCall.callee.property?.type !== "Identifier"
      )
        return;

      const innerMethod = innerCall.callee.property.name;
      if (innerMethod !== "map") return;

      context.report({
        node,
        message:
          ".map().filter(Boolean) iterates twice — use .flatMap() to transform and filter in a single pass",
      });
    },
  }),
};

const buildMemberAccessKey = (node: EsTreeNode): string | null => {
  if (node.type === "Identifier") return node.name;
  if (node.type === "ThisExpression") return "this";
  if (node.type !== "MemberExpression" || node.computed) return null;
  const objectKey = buildMemberAccessKey(node.object);
  if (!objectKey) return null;
  if (node.property?.type !== "Identifier") return null;
  return `${objectKey}.${node.property.name}`;
};

// HACK: detect repeated deep `obj.a.b.c` reads inside the same loop —
// JS engines can sometimes optimize, but reads through proxies, getters,
// or hot user-code paths often benefit from caching the access in a const
// at the top of the loop body. We require a member-expression depth ≥ 2
// (two dots) and ≥ 3 occurrences in the same loop block to fire.
export const jsCachePropertyAccess: Rule = {
  create: (context: RuleContext) => {
    const inspectLoopBody = (loopBody: EsTreeNode): void => {
      const counts = new Map<string, { count: number; firstNode: EsTreeNode }>();
      walkAst(loopBody, (child: EsTreeNode) => {
        if (child.type !== "MemberExpression") return;
        if (child.computed) return;
        // Skip if this MemberExpression is itself nested inside another (only
        // count the deepest reference per chain).
        if (child.parent?.type === "MemberExpression" && child.parent.object === child) return;
        const key = buildMemberAccessKey(child);
        if (!key) return;
        if (key.split(".").length < 3) return;
        const existing = counts.get(key);
        if (existing) {
          existing.count++;
        } else {
          counts.set(key, { count: 1, firstNode: child });
        }
      });

      for (const [key, { count, firstNode }] of counts) {
        if (count >= PROPERTY_ACCESS_REPEAT_THRESHOLD) {
          context.report({
            node: firstNode,
            message: `${key} is read ${count} times inside this loop — hoist into a const at the top of the loop body`,
          });
        }
      }
    };

    const handleLoop = (node: EsTreeNode): void => {
      if (node.body) inspectLoopBody(node.body);
    };

    return {
      ForStatement: handleLoop,
      ForInStatement: handleLoop,
      ForOfStatement: handleLoop,
      WhileStatement: handleLoop,
      DoWhileStatement: handleLoop,
    };
  },
};

// HACK: when comparing two arrays element-by-element via .every / .some /
// .reduce against another array, a length mismatch is the cheapest possible
// shortcut. e.g. `a.length === b.length && a.every((x, i) => x === b[i])`
// runs the every-loop only when lengths match.
export const jsLengthCheckFirst: Rule = {
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNode) {
      if (node.callee?.type !== "MemberExpression") return;
      if (node.callee.property?.type !== "Identifier") return;
      if (node.callee.property.name !== "every") return;

      const callback = node.arguments?.[0];
      if (callback?.type !== "ArrowFunctionExpression" && callback?.type !== "FunctionExpression") {
        return;
      }
      const params = callback.params ?? [];
      if (params.length < 2) return; // need (item, index, ...) to address other array

      // Look for `other[index]` access in the body, suggesting elementwise compare.
      let referencesOtherArrayByIndex = false;
      walkAst(callback.body, (child: EsTreeNode) => {
        if (referencesOtherArrayByIndex) return;
        if (
          child.type === "MemberExpression" &&
          child.computed &&
          child.property?.type === "Identifier" &&
          params[1]?.type === "Identifier" &&
          child.property.name === params[1].name
        ) {
          referencesOtherArrayByIndex = true;
        }
      });

      if (!referencesOtherArrayByIndex) return;

      // Walk up to ensure we're not already inside a length-check guard.
      let guard: EsTreeNode | null = node.parent ?? null;
      while (guard && guard.type !== "LogicalExpression" && guard.type !== "IfStatement") {
        guard = guard.parent ?? null;
      }
      if (guard?.type === "LogicalExpression" && guard.operator === "&&") {
        const left = guard.left;
        if (
          left?.type === "BinaryExpression" &&
          left.operator === "===" &&
          (isMemberProperty(left.left, "length") || isMemberProperty(left.right, "length"))
        ) {
          return;
        }
      }

      context.report({
        node,
        message:
          ".every() over an array compared to another array — short-circuit with `a.length === b.length && a.every(...)` so unequal-length arrays exit immediately",
      });
    },
  }),
};

// HACK: `new Intl.NumberFormat()` / `Intl.DateTimeFormat()` is expensive
// (dozens of allocations per locale lookup). Allocating it inside a render
// function or hot loop tanks scroll/list perf. Hoist to module scope or
// wrap in useMemo.
const INTL_CLASSES = new Set([
  "NumberFormat",
  "DateTimeFormat",
  "Collator",
  "RelativeTimeFormat",
  "ListFormat",
  "PluralRules",
  "Segmenter",
  "DisplayNames",
]);

const isIntlNewExpression = (node: EsTreeNode): boolean => {
  if (node.type !== "NewExpression") return false;
  const callee = node.callee;
  if (
    callee?.type === "MemberExpression" &&
    callee.object?.type === "Identifier" &&
    callee.object.name === "Intl" &&
    callee.property?.type === "Identifier" &&
    INTL_CLASSES.has(callee.property.name)
  ) {
    return true;
  }
  return false;
};

export const jsHoistIntl: Rule = {
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNode) {
      if (!isIntlNewExpression(node)) return;
      // Walk up: if any enclosing function is a function/arrow, this is in
      // a function body. Module-scope `new Intl.X()` is fine; we only flag
      // when wrapped in a function (likely called per render or per item).
      let cursor: EsTreeNode | null = node.parent ?? null;
      let inFunctionBody = false;
      while (cursor) {
        if (
          cursor.type === "FunctionDeclaration" ||
          cursor.type === "FunctionExpression" ||
          cursor.type === "ArrowFunctionExpression"
        ) {
          inFunctionBody = true;
          break;
        }
        cursor = cursor.parent ?? null;
      }
      if (!inFunctionBody) return;

      const className = node.callee.property?.name ?? "Intl";
      context.report({
        node,
        message: `new Intl.${className}() inside a function — hoist to module scope or wrap in useMemo so it isn't recreated each call`,
      });
    },
  }),
};

const findFirstAwaitOutsideNestedFunctions = (block: EsTreeNode): EsTreeNode | null => {
  let firstAwait: EsTreeNode | null = null;
  walkAst(block, (child: EsTreeNode): boolean | void => {
    if (firstAwait) return false;
    if (
      child !== block &&
      (child.type === "FunctionDeclaration" ||
        child.type === "FunctionExpression" ||
        child.type === "ArrowFunctionExpression")
    ) {
      // Don't descend into nested functions — their `await`s belong to
      // their own async parent, not this loop. (`child !== block` so we
      // still walk the body of the loop callback itself when called with
      // the callback's body.)
      return false;
    }
    if (child.type === "AwaitExpression") {
      firstAwait = child;
    }
  });
  return firstAwait;
};

// HACK: `for (const x of items) { await fetch(x); }` runs the fetches
// sequentially — each one waits for the previous to finish before
// starting. If the calls are independent (which they almost always are
// in a list-iteration loop), the total latency is N × per-call latency
// instead of just per-call. `await Promise.all(items.map(fetch))` runs
// them all concurrently. We flag any `await` inside `for…of`,
// `for…in`, classic `for`, `while`, or `.forEach`/`.map` callback
// bodies where `await` appears at the top level of the loop body.
//
// Notable exceptions we INTENTIONALLY do not exempt:
//  - `for await (const x of asyncIterable)` — that's a different
//    AST node (ForOfStatement with `await: true`); we skip those.
//  - Loops where the next iteration depends on the previous result
//    (e.g. paginated fetch). The plugin can't tell — accept some
//    false positives in exchange for catching the common waterfall.
const isFunctionishExpression = (node: EsTreeNode): boolean =>
  node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression";

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
  if (parent?.type !== "CallExpression") return false;
  if (parent.arguments?.[0] !== mapCall) return false;
  const callee = parent.callee;
  if (callee?.type !== "MemberExpression" || callee.computed) return false;
  if (callee.object?.type !== "Identifier" || callee.object.name !== "Promise") return false;
  if (callee.property?.type !== "Identifier") return false;
  return PROMISE_CONCURRENCY_METHODS.has(callee.property.name);
};

export const asyncAwaitInLoop: Rule = {
  create: (context: RuleContext) => {
    const inspectLoopBody = (loopBody: EsTreeNode | null | undefined, label: string): void => {
      if (!loopBody) return;
      const firstAwait = findFirstAwaitOutsideNestedFunctions(loopBody);
      if (firstAwait) {
        context.report({
          node: firstAwait,
          message: `await inside a ${label} runs the calls sequentially — for independent operations, collect them and use \`await Promise.all(items.map(...))\` to run them concurrently`,
        });
      }
    };

    return {
      ForStatement(node: EsTreeNode) {
        inspectLoopBody(node.body, "for-loop");
      },
      ForInStatement(node: EsTreeNode) {
        inspectLoopBody(node.body, "for…in loop");
      },
      ForOfStatement(node: EsTreeNode) {
        // `for await (const x of …)` is the legitimate async-iterator
        // pattern — skip it.
        if (node.await) return;
        inspectLoopBody(node.body, "for…of loop");
      },
      WhileStatement(node: EsTreeNode) {
        inspectLoopBody(node.body, "while-loop");
      },
      DoWhileStatement(node: EsTreeNode) {
        inspectLoopBody(node.body, "do-while loop");
      },
      CallExpression(node: EsTreeNode) {
        // arr.forEach(async item => { await fn(item); }) — sequential
        // because forEach doesn't await; even worse, the awaits are
        // dropped on the floor (forEach ignores return values).
        if (node.callee?.type !== "MemberExpression") return;
        if (node.callee.property?.type !== "Identifier") return;
        const methodName = node.callee.property.name;
        if (!ITERATION_METHOD_NAMES_WITH_CALLBACK.has(methodName)) return;

        const callback = node.arguments?.[0];
        if (!callback || !isFunctionishExpression(callback)) return;
        if (!callback.async) return;
        const body = callback.body;
        if (!body) return;

        if (
          (methodName === "map" || methodName === "flatMap") &&
          isWrappedInPromiseConcurrency(node)
        ) {
          return;
        }
        // `body` is either a BlockStatement (block body) or any
        // expression (concise body, e.g. `async x => fetch(x)`); walkAst
        // handles both, so we just walk `body` directly.
        const firstAwait = findFirstAwaitOutsideNestedFunctions(body);
        if (firstAwait) {
          const message =
            methodName === "forEach"
              ? "Async callback in .forEach — return values are dropped, so awaits don't actually wait. Use a `for…of` loop or `await Promise.all(items.map(async (item) => {...}))`"
              : `Async callback in .${methodName} — sequential awaits inside the callback waterfall. Use \`await Promise.all(items.map(async (item) => {...}))\` to run them concurrently`;
          context.report({ node: firstAwait, message });
        }
      },
    };
  },
};
