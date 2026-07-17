import { FUNCTION_LIKE_TYPES } from "../../constants/js.js";
import type { ScopeAnalysis } from "../../semantic/scope-analysis.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isConstDeclaredBinding } from "../../utils/is-const-declared-binding.js";
import { isMemberProperty } from "../../utils/is-member-property.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";

const OBJECT_ENUMERATION_METHOD_NAMES = new Set(["keys", "entries", "values"]);
const NON_GROWING_ARRAY_METHOD_NAMES = new Set([
  "copyWithin",
  "fill",
  "filter",
  "map",
  "reverse",
  "slice",
  "sort",
  "toReversed",
  "toSorted",
  "with",
]);

const isFreshLiteralSeed = (seedArgument: EsTreeNode | undefined): boolean => {
  if (!isAstNode(seedArgument)) return false;
  const stripped = stripParenExpression(seedArgument);
  return isNodeOfType(stripped, "ObjectExpression") || isNodeOfType(stripped, "ArrayExpression");
};

const isSpreadFreeArrayLiteral = (node: EsTreeNode, mustHaveElements: boolean): boolean => {
  if (!isNodeOfType(node, "ArrayExpression")) return false;
  if (mustHaveElements && node.elements.length === 0) return false;
  return node.elements.every((element) => !isNodeOfType(element, "SpreadElement"));
};

const isSpreadFreeObjectLiteral = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "ObjectExpression") &&
  node.properties.every((property) => !isNodeOfType(property, "SpreadElement"));

const isRestParameterBinding = (bindingIdentifier: EsTreeNode): boolean => {
  const restCandidate = bindingIdentifier.parent;
  return Boolean(
    restCandidate &&
    isNodeOfType(restCandidate, "RestElement") &&
    restCandidate.parent &&
    FUNCTION_LIKE_TYPES.has(restCandidate.parent.type),
  );
};

const isLocallyConstructedBoundedObject = (expression: EsTreeNode): boolean => {
  const stripped = stripParenExpression(expression);
  if (isSpreadFreeObjectLiteral(stripped)) return true;
  if (!isNodeOfType(stripped, "Identifier")) return false;
  const binding = findVariableInitializer(stripped, stripped.name);
  if (!binding?.initializer || !isConstDeclaredBinding(binding)) return false;
  return isSpreadFreeObjectLiteral(stripParenExpression(binding.initializer));
};

// A `const IDS = cond ? ["a", "b"] : ["a", "b", "c"]` initializer is as
// statically bounded as a plain array literal — both branches enumerate a
// fixed key set.
const isBoundedArrayInitializer = (initializer: EsTreeNode): boolean => {
  const stripped = stripParenExpression(initializer);
  if (isSpreadFreeArrayLiteral(stripped, true)) return true;
  if (!isNodeOfType(stripped, "ConditionalExpression")) return false;
  return (
    isSpreadFreeArrayLiteral(stripParenExpression(stripped.consequent), true) &&
    isSpreadFreeArrayLiteral(stripParenExpression(stripped.alternate), true)
  );
};

const isFixedLengthArrayConstruction = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const stripped = stripParenExpression(expression);
  if (!isNodeOfType(stripped, "CallExpression") && !isNodeOfType(stripped, "NewExpression")) {
    return false;
  }
  const callee = stripParenExpression(stripped.callee);
  if (
    !isNodeOfType(callee, "Identifier") ||
    callee.name !== "Array" ||
    !scopes.isGlobalReference(callee)
  ) {
    return false;
  }
  const lengthArgument = stripped.arguments[0];
  return Boolean(
    isAstNode(lengthArgument) &&
    isNodeOfType(lengthArgument, "Literal") &&
    typeof lengthArgument.value === "number",
  );
};

const isFixedLengthArrayExpression = (expression: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const stripped = stripParenExpression(expression);
  if (isFixedLengthArrayConstruction(stripped, scopes)) return true;
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const callee = stripParenExpression(stripped.callee);
  if (!isNodeOfType(callee, "MemberExpression")) return false;
  if (
    isNodeOfType(callee.object, "Identifier") &&
    callee.object.name === "Array" &&
    scopes.isGlobalReference(callee.object) &&
    isNodeOfType(callee.property, "Identifier") &&
    callee.property.name === "from"
  ) {
    const sourceArgument = stripped.arguments[0];
    return isAstNode(sourceArgument) && isFixedLengthArrayConstruction(sourceArgument, scopes);
  }
  return (
    isNodeOfType(callee.property, "Identifier") &&
    NON_GROWING_ARRAY_METHOD_NAMES.has(callee.property.name) &&
    isFixedLengthArrayConstruction(callee.object, scopes)
  );
};

// The empirical false-positive pattern is spreading the accumulator over a
// statically bounded collection — a rest parameter (bounded by call-site
// arity), an array literal, or the keys/entries of a locally constructed
// object literal — where n is tiny and fixed, so the O(n²) copy cost is
// unobservable and the immutable idiom is deliberate.
const isStaticallyBoundedReduceSource = (source: EsTreeNode, scopes: ScopeAnalysis): boolean => {
  const stripped = stripParenExpression(source);
  if (isSpreadFreeArrayLiteral(stripped, false)) return true;
  if (isFixedLengthArrayExpression(stripped, scopes)) return true;
  if (isNodeOfType(stripped, "Identifier")) {
    const binding = findVariableInitializer(stripped, stripped.name);
    if (!binding) return false;
    if (isRestParameterBinding(binding.bindingIdentifier)) return true;
    return Boolean(
      binding.initializer &&
      isConstDeclaredBinding(binding) &&
      isBoundedArrayInitializer(binding.initializer),
    );
  }
  if (!isNodeOfType(stripped, "CallExpression")) return false;
  const enumerationCallee = stripParenExpression(stripped.callee);
  if (!isNodeOfType(enumerationCallee, "MemberExpression")) return false;
  if (
    !isNodeOfType(enumerationCallee.object, "Identifier") ||
    enumerationCallee.object.name !== "Object" ||
    !scopes.isGlobalReference(enumerationCallee.object)
  ) {
    return false;
  }
  if (!isNodeOfType(enumerationCallee.property, "Identifier")) return false;
  if (!OBJECT_ENUMERATION_METHOD_NAMES.has(enumerationCallee.property.name)) return false;
  const enumeratedObject = stripped.arguments[0];
  return isAstNode(enumeratedObject) && isLocallyConstructedBoundedObject(enumeratedObject);
};

interface ReducerReturnAnalysis {
  returnedLiterals: EsTreeNode[];
  // A `return acc` path unchanged alongside the spread is the filter /
  // dedup shape — growth is bounded by matches, empirically benign.
  hasAccumulatorPassthroughReturn: boolean;
}

// Collects the object/array literals a reducer callback returns — the
// concise-body expression, or every top-level `return X`. Stops at
// nested function boundaries so an inner callback's return isn't
// mistaken for the reducer's own.
const analyzeReducerReturns = (
  callback: EsTreeNodeOfType<"ArrowFunctionExpression"> | EsTreeNodeOfType<"FunctionExpression">,
  accumulatorParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): ReducerReturnAnalysis => {
  const analysis: ReducerReturnAnalysis = {
    returnedLiterals: [],
    hasAccumulatorPassthroughReturn: false,
  };
  const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
  const recordReturnedExpression = (expression: EsTreeNode | null | undefined): void => {
    if (!expression) return;
    const stripped = stripParenExpression(expression);
    if (isNodeOfType(stripped, "ObjectExpression") || isNodeOfType(stripped, "ArrayExpression")) {
      analysis.returnedLiterals.push(stripped);
      return;
    }
    if (
      isNodeOfType(stripped, "Identifier") &&
      accumulatorSymbol !== null &&
      scopes.symbolFor(stripped) === accumulatorSymbol
    ) {
      analysis.hasAccumulatorPassthroughReturn = true;
    }
  };

  const body = callback.body;
  if (!body) return analysis;
  if (!isNodeOfType(body, "BlockStatement")) {
    recordReturnedExpression(body);
    return analysis;
  }

  walkAst(body, (child) => {
    if (FUNCTION_LIKE_TYPES.has(child.type)) return false;
    if (isNodeOfType(child, "ReturnStatement")) {
      recordReturnedExpression(child.argument);
      return false;
    }
  });
  return analysis;
};

// Any spread of the accumulator copies the whole growing collection,
// no matter where it sits in the literal — `{ ...mapItem(x), ...acc }`
// and `[...g.items, ...acc]` are as quadratic as the leading-spread form.
const literalSpreadsAccumulator = (
  literal: EsTreeNode,
  accumulatorParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
  if (!accumulatorSymbol) return false;
  const members = isNodeOfType(literal, "ObjectExpression")
    ? literal.properties
    : isNodeOfType(literal, "ArrayExpression")
      ? literal.elements
      : null;
  if (!members) return false;
  return members.some((member) => {
    if (!isNodeOfType(member, "SpreadElement")) return false;
    const spreadArgument = stripParenExpression(member.argument);
    return (
      isNodeOfType(spreadArgument, "Identifier") &&
      scopes.symbolFor(spreadArgument) === accumulatorSymbol
    );
  });
};

// Only unambiguous growth shapes are worth reporting. An array literal always
// appends. An object literal counts only with a second spread merged in
// (`{ ...acc, ...chunk(x) }`) — a single accumulator spread plus one computed
// key (`{ ...acc, [key]: value }`) is the keyed-lookup-build idiom over a
// semantically bounded key set, empirically the dominant false positive.
const literalGrowsAccumulatorPerIteration = (
  literal: EsTreeNode,
  accumulatorParameter: EsTreeNode,
  scopes: ScopeAnalysis,
): boolean => {
  if (isNodeOfType(literal, "ArrayExpression")) {
    const accumulatorSymbol = scopes.symbolFor(accumulatorParameter);
    return literal.elements.some((element) => {
      if (!element) return false;
      if (!isNodeOfType(element, "SpreadElement")) return true;
      const spreadArgument = stripParenExpression(element.argument);
      return (
        !isNodeOfType(spreadArgument, "Identifier") ||
        scopes.symbolFor(spreadArgument) !== accumulatorSymbol
      );
    });
  }
  if (!isNodeOfType(literal, "ObjectExpression")) return false;
  return (
    literal.properties.filter((property) => isNodeOfType(property, "SpreadElement")).length >= 2
  );
};

export const noSpreadAccumulatorInReduce = defineRule({
  id: "no-spread-accumulator-in-reduce",
  title: "Accumulator spread in reduce is quadratic",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Mutate the accumulator and return it (`acc[key] = value; return acc`) so the fold stays O(n) instead of copying the whole accumulator every step.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = node.callee;
      if (!isMemberProperty(callee, "reduce") && !isMemberProperty(callee, "reduceRight")) {
        return;
      }
      if (!isFreshLiteralSeed(node.arguments[1])) return;
      if (isStaticallyBoundedReduceSource(callee.object, context.scopes)) return;

      const callback = node.arguments[0];
      if (
        !callback ||
        (!isNodeOfType(callback, "ArrowFunctionExpression") &&
          !isNodeOfType(callback, "FunctionExpression"))
      ) {
        return;
      }
      const accumulatorParam = callback.params[0];
      if (!accumulatorParam || !isNodeOfType(accumulatorParam, "Identifier")) return;

      const analysis = analyzeReducerReturns(callback, accumulatorParam, context.scopes);
      if (analysis.hasAccumulatorPassthroughReturn) return;

      for (const literal of analysis.returnedLiterals) {
        if (
          literalSpreadsAccumulator(literal, accumulatorParam, context.scopes) &&
          literalGrowsAccumulatorPerIteration(literal, accumulatorParam, context.scopes)
        ) {
          context.report({
            node: literal,
            message:
              "This is O(n²) because spreading the accumulator copies the entire growing collection every step. Mutate and return the accumulator instead (acc[key] = value; return acc).",
          });
          return;
        }
      }
    },
  }),
});
