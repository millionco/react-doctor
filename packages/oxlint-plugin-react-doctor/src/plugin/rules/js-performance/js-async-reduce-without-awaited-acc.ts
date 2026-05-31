import { defineRule } from "../../utils/define-rule.js";
import { containsDirectAwait } from "../../utils/contains-direct-await.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: `Array.prototype.reduce` only flows the previous reducer's
// return value into the next iteration's first argument. When the
// reducer is `async`, that "return value" is a Promise. If the body
// never awaits the accumulator parameter, every iteration sees a
// Promise instead of the resolved value, side effects on it land on
// the Promise object, and the final `await` of `reduce(...)` returns
// the last iteration's Promise containing only the initial seed.
// The correct shape awaits the accumulator first:
//   `const acc = await previous; acc[key] = await getItem(); return acc;`

type FunctionExpressionLike =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">;

const isAsyncFunctionLike = (
  node: EsTreeNode | null | undefined,
): node is FunctionExpressionLike => {
  if (!node) return false;
  if (!isNodeOfType(node, "ArrowFunctionExpression") && !isNodeOfType(node, "FunctionExpression")) {
    return false;
  }
  return node.async === true;
};

type FirstParameterShape = { kind: "identifier"; name: string } | { kind: "destructured" } | null;

const classifyFirstParameter = (fn: FunctionExpressionLike): FirstParameterShape => {
  const parameters = fn.params ?? [];
  if (parameters.length === 0) return null;
  const first = parameters[0];
  if (isNodeOfType(first, "Identifier")) return { kind: "identifier", name: first.name };
  // Destructured accumulator — `async ([sum, count], item) => ...` or
  // `async ({ items }, item) => ...`. Destructuring runs *against the
  // previous reducer's return*, which is a Promise on iterations 2+.
  // Destructuring a Promise produces `undefined` slots and the chain
  // silently drops every iteration. Treat this as a distinct (always-
  // broken-with-awaits) shape.
  if (isNodeOfType(first, "ArrayPattern") || isNodeOfType(first, "ObjectPattern")) {
    return { kind: "destructured" };
  }
  // AssignmentPattern (`async (acc = init, item) => ...`) — unwrap.
  if (isNodeOfType(first, "AssignmentPattern")) {
    if (isNodeOfType(first.left, "Identifier")) {
      return { kind: "identifier", name: first.left.name };
    }
    if (isNodeOfType(first.left, "ArrayPattern") || isNodeOfType(first.left, "ObjectPattern")) {
      return { kind: "destructured" };
    }
  }
  return null;
};

const isReduceCallee = (callee: EsTreeNode | null | undefined): { methodName: string } | null => {
  if (!isNodeOfType(callee, "MemberExpression")) return null;
  // Non-computed: `arr.reduce(...)` / `arr.reduceRight(...)`.
  if (!callee.computed) {
    if (!isNodeOfType(callee.property, "Identifier")) return null;
    if (callee.property.name !== "reduce" && callee.property.name !== "reduceRight") return null;
    return { methodName: callee.property.name };
  }
  // Computed with string literal: `arr["reduce"](...)`.
  if (isNodeOfType(callee.property, "Literal") && typeof callee.property.value === "string") {
    const propertyName = callee.property.value;
    if (propertyName !== "reduce" && propertyName !== "reduceRight") return null;
    return { methodName: propertyName };
  }
  return null;
};

const bodyAwaitsAccumulator = (fn: FunctionExpressionLike, accumulatorName: string): boolean => {
  const body = fn.body;
  if (!body) return false;
  let awaitsAccumulator = false;
  walkAst(body, (child: EsTreeNode) => {
    if (awaitsAccumulator) return false;
    // Don't descend into nested functions — their awaits belong to
    // their own async context, not the outer reducer's.
    if (
      isNodeOfType(child, "FunctionDeclaration") ||
      isNodeOfType(child, "FunctionExpression") ||
      isNodeOfType(child, "ArrowFunctionExpression")
    ) {
      if (child !== fn) return false;
    }
    if (!isNodeOfType(child, "AwaitExpression")) return;
    if (!child.argument) return;
    const awaitArgument = stripParenExpression(child.argument);
    if (isNodeOfType(awaitArgument, "Identifier") && awaitArgument.name === accumulatorName) {
      awaitsAccumulator = true;
      return false;
    }
  });
  return awaitsAccumulator;
};

export const jsAsyncReduceWithoutAwaitedAcc = defineRule<Rule>({
  id: "js-async-reduce-without-awaited-acc",
  title: "Async reduce drops its accumulator",
  severity: "warn",
  recommendation:
    "Await the accumulator first: `const acc = await previous; ...; return acc;`. Seed it with `Promise.resolve(initial)` so the first run also gets a Promise",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const reduceMatch = isReduceCallee(node.callee);
      if (!reduceMatch) return;
      const args = node.arguments ?? [];
      if (args.length === 0) return;

      const reducerCandidate = stripParenExpression(args[0]);
      if (!isAsyncFunctionLike(reducerCandidate)) return;
      const reducer = reducerCandidate;

      // Body must actually do async work — pure sync async reducers
      // are unusual but valid; flagging them produces noise.
      if (!containsDirectAwait(reducer.body)) return;

      const firstParameter = classifyFirstParameter(reducer);
      if (!firstParameter) return;

      if (firstParameter.kind === "destructured") {
        context.report({
          node: reducer,
          message: `This async \`.${reduceMatch.methodName}\` reducer destructures its accumulator, but every run after the first gets a Promise, so the pieces come out empty & the work is lost. Await it first: \`async (previous, item) => { const [...] = await previous; ...; return [...]; }\`, & seed with \`Promise.resolve([...])\``,
        });
        return;
      }

      if (bodyAwaitsAccumulator(reducer, firstParameter.name)) return;

      // Pick a "previous" param name that won't shadow the user's
      // accumulator. If they already named it `previous` (or `prev`),
      // fall through to a distinct alternative so the suggestion
      // remains syntactically valid.
      const previousParamCandidates = ["previous", "prev", "priorResult"];
      const previousParamName =
        previousParamCandidates.find((candidate) => candidate !== firstParameter.name) ??
        `${firstParameter.name}Prev`;
      context.report({
        node: reducer,
        message: `This async \`.${reduceMatch.methodName}\` reducer never awaits its accumulator "${firstParameter.name}", so each run gets a Promise instead of the real value & the work is lost. Reassign it at the top (\`${firstParameter.name} = await ${firstParameter.name};\`), or rewrite as \`async (${previousParamName}, item) => { const ${firstParameter.name} = await ${previousParamName}; ...; return ${firstParameter.name}; }\`, & seed with \`Promise.resolve(...)\``,
      });
    },
  }),
});
