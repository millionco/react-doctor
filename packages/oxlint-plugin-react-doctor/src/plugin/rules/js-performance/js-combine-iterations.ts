import {
  CHAINABLE_ITERATION_METHODS,
  ITERATOR_PRODUCING_METHOD_NAMES,
} from "../../constants/js.js";
import { SMALL_LITERAL_ARRAY_MAX_ELEMENTS } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { walkAst } from "../../utils/walk-ast.js";

const isIteratorProducingCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
  generatorNamesInFile: ReadonlySet<string>,
): boolean => {
  const callee = callExpression.callee;
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Iterator" &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from"
  ) {
    return true;
  }
  if (isNodeOfType(callee, "Identifier") && generatorNamesInFile.has(callee.name)) {
    return true;
  }
  if (
    isNodeOfType(callee, "MemberExpression") &&
    isNodeOfType(callee.property, "Identifier") &&
    ITERATOR_PRODUCING_METHOD_NAMES.has(callee.property.name)
  ) {
    const receiver = callee.object;
    if (isNodeOfType(receiver, "Identifier") && receiver.name === "Object") return false;
    return true;
  }
  return false;
};

const isChainPassThroughCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const callee = callExpression.callee;
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (!isNodeOfType(callee.property, "Identifier")) return false;
  return CHAINABLE_ITERATION_METHODS.has(callee.property.name);
};

const isReceiverChainIteratorRooted = (
  receiverNode: EsTreeNode | null | undefined,
  generatorNamesInFile: ReadonlySet<string>,
): boolean => {
  let cursor: EsTreeNode | null | undefined = receiverNode;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (!isNodeOfType(cursor, "CallExpression")) return false;
    if (isIteratorProducingCall(cursor, generatorNamesInFile)) return true;
    if (!isChainPassThroughCall(cursor)) return false;
    const nextCallee = cursor.callee;
    if (!isNodeOfType(nextCallee, "MemberExpression")) return false;
    cursor = nextCallee.object;
  }
  return false;
};

// `.filter(x => x != null)` — type-narrowing predicate. The
// `.map().filter()` form is the canonical "transform then narrow to
// non-null" pattern; the .reduce() rewrite loses both readability
// and type narrowing.
const isNullishComparison = (expression: EsTreeNode | null | undefined): boolean => {
  if (!expression) return false;
  if (isNodeOfType(expression, "BinaryExpression")) {
    const operator = expression.operator;
    if (operator !== "!=" && operator !== "!==" && operator !== "==" && operator !== "===") {
      return false;
    }
    const isNullLiteral = (n: EsTreeNode | null | undefined): boolean => {
      if (!n) return false;
      if (isNodeOfType(n, "Literal") && (n as { value?: unknown }).value === null) return true;
      if (isNodeOfType(n, "Identifier") && n.name === "undefined") return true;
      return false;
    };
    return (
      isNullLiteral(expression.left as EsTreeNode | null) ||
      isNullLiteral(expression.right as EsTreeNode | null)
    );
  }
  return false;
};

const isNullFilteringPredicateBody = (body: EsTreeNode): boolean => {
  // `x != null` / `x !== undefined` etc.
  if (isNullishComparison(body)) return true;
  // `x != null && x !== undefined` / `x !== null || x.foo` — both
  // branches are nullish comparisons (conservative — only accept when
  // EVERY clause is a nullish comparison so we don't accept arbitrary
  // logic).
  if (
    isNodeOfType(body, "LogicalExpression") &&
    (body.operator === "&&" || body.operator === "||")
  ) {
    return (
      isNullFilteringPredicateBody(body.left as EsTreeNode) &&
      isNullFilteringPredicateBody(body.right as EsTreeNode)
    );
  }
  return false;
};

// `.filter((x): x is T => …)` — TypeScript type predicate. The arrow
// has an explicit `is T` return annotation on its body, which only
// makes sense when chained with .map() to operate on the narrowed
// type. We detect by checking for a `returnType` field whose name
// contains "TSTypePredicate" — robust against AST shape variance.
const isTypePredicateArrow = (filterArgument: EsTreeNode | null | undefined): boolean => {
  if (!filterArgument) return false;
  if (!isNodeOfType(filterArgument, "ArrowFunctionExpression")) return false;
  const returnType = (filterArgument as { returnType?: unknown }).returnType;
  if (!returnType || typeof returnType !== "object") return false;
  const annotation = (returnType as { typeAnnotation?: unknown }).typeAnnotation;
  if (!annotation || typeof annotation !== "object") return false;
  const annotationType = (annotation as { type?: unknown }).type;
  return typeof annotationType === "string" && annotationType.includes("TypePredicate");
};

const isNullFilteringPredicate = (filterArgument: EsTreeNode | null | undefined): boolean => {
  if (!filterArgument) return false;
  if (!isNodeOfType(filterArgument, "ArrowFunctionExpression")) return false;
  if ((filterArgument.params?.length ?? 0) === 0) return false;
  const body = filterArgument.body as EsTreeNode;
  // Expression-body arrow.
  if (!isNodeOfType(body, "BlockStatement")) {
    return isNullFilteringPredicateBody(body);
  }
  // Block-body arrow with a single `return <nullish-cmp>` statement.
  const statements = body.body ?? [];
  if (statements.length !== 1) return false;
  const only = statements[0] as EsTreeNode;
  if (!isNodeOfType(only, "ReturnStatement") || !only.argument) return false;
  return isNullFilteringPredicateBody(only.argument as EsTreeNode);
};

// `str.split(',').map(...).filter(...)` — split returns a bounded
// array whose size is determined by the source string (typically
// small). Walks past chained pass-through calls (.map, .filter, etc.)
// to find the receiver root and checks for `.split(...)`.
const isStringSplitRootedChain = (receiverNode: EsTreeNode | null | undefined): boolean => {
  let cursor: EsTreeNode | null | undefined = receiverNode;
  let hops = 0;
  while (cursor && hops < 12) {
    hops += 1;
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (!isNodeOfType(cursor, "CallExpression")) return false;
    const callee = cursor.callee;
    if (!isNodeOfType(callee, "MemberExpression")) return false;
    if (!isNodeOfType(callee.property, "Identifier")) return false;
    if (callee.property.name === "split") return true;
    // Walk past .map / .filter / etc. — any chainable iteration method.
    if (!isChainPassThroughCall(cursor)) return false;
    cursor = callee.object;
  }
  return false;
};

const isSmallLiteralArrayRootedChain = (receiverNode: EsTreeNode | null | undefined): boolean => {
  let cursor: EsTreeNode | null | undefined = receiverNode;
  while (cursor) {
    if (isNodeOfType(cursor, "ChainExpression")) {
      cursor = cursor.expression;
      continue;
    }
    if (isNodeOfType(cursor, "ArrayExpression")) {
      const elements = cursor.elements ?? [];
      if (elements.length === 0 || elements.length > SMALL_LITERAL_ARRAY_MAX_ELEMENTS) {
        return false;
      }
      // No spread elements — those could expand to arbitrary length.
      for (const element of elements) {
        if (!element) continue;
        if (isNodeOfType(element, "SpreadElement")) return false;
      }
      return true;
    }
    if (!isNodeOfType(cursor, "CallExpression")) return false;
    if (!isChainPassThroughCall(cursor)) return false;
    const nextCallee = cursor.callee;
    if (!isNodeOfType(nextCallee, "MemberExpression")) return false;
    cursor = nextCallee.object;
  }
  return false;
};

const collectGeneratorNames = (programNode: EsTreeNode): Set<string> => {
  const generatorNames = new Set<string>();
  walkAst(programNode, (child: EsTreeNode) => {
    if (
      isNodeOfType(child, "FunctionDeclaration") &&
      child.generator === true &&
      isNodeOfType(child.id, "Identifier")
    ) {
      generatorNames.add(child.id.name);
      return;
    }
    if (
      isNodeOfType(child, "VariableDeclarator") &&
      isNodeOfType(child.id, "Identifier") &&
      isNodeOfType(child.init, "FunctionExpression") &&
      child.init.generator === true
    ) {
      generatorNames.add(child.id.name);
    }
  });
  return generatorNames;
};

export const jsCombineIterations = defineRule<Rule>({
  id: "js-combine-iterations",
  title: "Chained array iterations",
  tags: ["test-noise"],
  severity: "warn",
  recommendation:
    "Combine `.map().filter()` style chains into one pass with `.reduce()` or a `for...of` loop, so you only loop over the list once",
  create: (context: RuleContext) => {
    let generatorNamesInFile: ReadonlySet<string> = new Set();

    return {
      Program(programNode: EsTreeNodeOfType<"Program">) {
        generatorNamesInFile = collectGeneratorNames(programNode);
      },
      CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
        if (
          !isNodeOfType(node.callee, "MemberExpression") ||
          !isNodeOfType(node.callee.property, "Identifier")
        )
          return;

        const outerMethod = node.callee.property.name;
        if (!CHAINABLE_ITERATION_METHODS.has(outerMethod)) return;

        const innerCall = node.callee.object;
        if (
          !isNodeOfType(innerCall, "CallExpression") ||
          !isNodeOfType(innerCall.callee, "MemberExpression") ||
          !isNodeOfType(innerCall.callee.property, "Identifier")
        )
          return;

        const innerMethod = innerCall.callee.property.name;
        if (!CHAINABLE_ITERATION_METHODS.has(innerMethod)) return;

        if (innerMethod === "map" && outerMethod === "filter") {
          const filterArgument = node.arguments?.[0];
          const isBooleanOrIdentityFilter =
            (isNodeOfType(filterArgument, "Identifier") && filterArgument.name === "Boolean") ||
            (isNodeOfType(filterArgument, "ArrowFunctionExpression") &&
              filterArgument.params?.length === 1 &&
              isNodeOfType(filterArgument.body, "Identifier") &&
              isNodeOfType(filterArgument.params[0], "Identifier") &&
              filterArgument.body.name === filterArgument.params[0].name);
          if (isBooleanOrIdentityFilter) return;
          if (isNullFilteringPredicate(filterArgument as EsTreeNode | null | undefined)) return;
          // `.map(transform).filter((x): x is T => …)` — TS type predicate
          // narrows the result element type; rewriting to `.reduce()`
          // loses the narrowing (same rationale as the `.filter().map()`
          // branch below).
          if (isTypePredicateArrow(filterArgument as EsTreeNode | null | undefined)) return;
        }
        if (innerMethod === "filter" && outerMethod === "map") {
          const filterArgument = (innerCall as EsTreeNodeOfType<"CallExpression">).arguments?.[0];
          if (isNullFilteringPredicate(filterArgument as EsTreeNode | null | undefined)) return;
          if (isTypePredicateArrow(filterArgument as EsTreeNode | null | undefined)) return;
        }

        if (isReceiverChainIteratorRooted(innerCall.callee.object, generatorNamesInFile)) return;
        if (isSmallLiteralArrayRootedChain(innerCall.callee.object)) return;
        if (isStringSplitRootedChain(innerCall.callee.object)) return;

        context.report({
          node,
          message: `This loops over your list twice because .${innerMethod}().${outerMethod}() makes two passes, so do it in one pass with .reduce() or a for...of loop`,
        });
      },
    };
  },
});
