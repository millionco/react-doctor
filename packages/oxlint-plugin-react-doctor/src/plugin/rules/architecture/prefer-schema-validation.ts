import { defineRule } from "../../utils/define-rule.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import { getStaticMemberPropertyName } from "../state-and-effects/utils/static-member-property-name.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

// A function is flagged as hand-rolled validation only once it carries at
// least this many DISTINCT `typeof <param>.<member>` checks. Two is the
// floor for "validating the shape of an object" — a single `typeof`
// member check (`typeof options.onChange === "function"`) is ordinary
// optional-callback handling, not a schema.
const MINIMUM_TYPEOF_MEMBER_CHECKS = 2;

// The eight runtime results of the `typeof` operator. Requiring the
// compared literal to be one of these keeps the detector on the genuine
// type-validation idiom and ignores incidental string comparisons.
const TYPEOF_RESULT_TAGS: ReadonlySet<string> = new Set([
  "string",
  "number",
  "boolean",
  "object",
  "undefined",
  "function",
  "symbol",
  "bigint",
]);

const TYPE_COMPARISON_OPERATORS: ReadonlySet<string> = new Set(["===", "!==", "==", "!="]);

// Names that signal the author intends a function to validate a value's
// shape. `is`/`has`/`are` require an uppercase boundary so `island` or
// `haste` never match; the full-word prefixes are case-insensitive so
// PascalCase factory names (`ValidateInput`) still count.
const VALIDATOR_CAMEL_PREFIX_PATTERN = /^(is|has|are)[A-Z]/;
const VALIDATOR_WORD_PREFIX_PATTERN = /^(validate|assert|ensure|verify|guard|check)/i;

const looksLikeValidatorName = (name: string): boolean =>
  VALIDATOR_CAMEL_PREFIX_PATTERN.test(name) || VALIDATOR_WORD_PREFIX_PATTERN.test(name);

type FunctionLikeNode =
  | EsTreeNodeOfType<"ArrowFunctionExpression">
  | EsTreeNodeOfType<"FunctionExpression">
  | EsTreeNodeOfType<"FunctionDeclaration">;

// The `value is User` / `asserts value is User` annotation on a function's
// return type. Both forms are explicit declarations that the function's
// job is to validate the named parameter's type at runtime.
const getReturnTypePredicate = (
  functionNode: FunctionLikeNode,
): EsTreeNodeOfType<"TSTypePredicate"> | null => {
  const returnType = functionNode.returnType;
  if (!returnType || !isNodeOfType(returnType, "TSTypeAnnotation")) return null;
  const annotation = returnType.typeAnnotation;
  if (!isNodeOfType(annotation, "TSTypePredicate")) return null;
  return annotation;
};

const getStaticPropertyKeyName = (key: EsTreeNode, computed: boolean): string | null => {
  if (!computed && isNodeOfType(key, "Identifier")) return key.name;
  if (computed && isNodeOfType(key, "Literal") && typeof key.value === "string") return key.value;
  return null;
};

// Resolves the binding name a function is exposed under: a declaration /
// expression `id`, the `const name = …` it initializes, the object or
// class member it implements, or the assignment target it is assigned to.
const getFunctionBindingName = (functionNode: FunctionLikeNode): string | null => {
  if (
    (isNodeOfType(functionNode, "FunctionDeclaration") ||
      isNodeOfType(functionNode, "FunctionExpression")) &&
    functionNode.id
  ) {
    return functionNode.id.name;
  }

  const parent = functionNode.parent;
  if (!parent) return null;

  if (
    isNodeOfType(parent, "VariableDeclarator") &&
    parent.init === functionNode &&
    isNodeOfType(parent.id, "Identifier")
  ) {
    return parent.id.name;
  }

  if (
    (isNodeOfType(parent, "Property") ||
      isNodeOfType(parent, "PropertyDefinition") ||
      isNodeOfType(parent, "MethodDefinition")) &&
    parent.value === functionNode
  ) {
    return getStaticPropertyKeyName(parent.key, Boolean(parent.computed));
  }

  if (isNodeOfType(parent, "AssignmentExpression") && parent.right === functionNode) {
    if (isNodeOfType(parent.left, "Identifier")) return parent.left.name;
    return getStaticMemberPropertyName(parent.left);
  }

  return null;
};

// The parameter whose shape the function validates: the parameter named
// by a type predicate when present, otherwise the first plain-identifier
// parameter. Destructured parameters are skipped — their members are
// already named bindings, not a single value being inspected.
const getValidatedParameterName = (
  functionNode: FunctionLikeNode,
  predicate: EsTreeNodeOfType<"TSTypePredicate"> | null,
): string | null => {
  if (predicate && isNodeOfType(predicate.parameterName, "Identifier")) {
    return predicate.parameterName.name;
  }
  const firstParameter = functionNode.params?.[0];
  if (isNodeOfType(firstParameter, "Identifier")) return firstParameter.name;
  return null;
};

const isTypeofOperand = (
  node: EsTreeNode | undefined,
): node is EsTreeNodeOfType<"UnaryExpression"> =>
  isNodeOfType(node, "UnaryExpression") && node.operator === "typeof";

const isTypeofResultLiteral = (node: EsTreeNode | undefined): boolean =>
  isNodeOfType(node, "Literal") &&
  typeof node.value === "string" &&
  TYPEOF_RESULT_TAGS.has(node.value);

// For `typeof <expression>`, returns a stable per-property key when the
// expression is a member chain rooted at `validatedParameterName`
// (`value.id`, `value.address.city`, `value["id"]`). Returns null for a
// bare `typeof value` (polymorphic dispatch, not shape validation) or a
// chain rooted at any other identifier. Dynamic segments collapse to `*`
// so the count never over-relies on a computed key it cannot prove.
const getTypeofMemberCheckKey = (
  typeofUnary: EsTreeNodeOfType<"UnaryExpression">,
  validatedParameterName: string,
): string | null => {
  let current = stripParenExpression(typeofUnary.argument);
  if (!isNodeOfType(current, "MemberExpression")) return null;

  const propertyPathSegments: string[] = [];
  while (isNodeOfType(current, "MemberExpression")) {
    propertyPathSegments.unshift(getStaticMemberPropertyName(current) ?? "*");
    current = stripParenExpression(current.object);
  }

  if (!isNodeOfType(current, "Identifier") || current.name !== validatedParameterName) return null;
  return `${current.name}.${propertyPathSegments.join(".")}`;
};

const getTypeofMemberCheckKeyFromComparison = (
  comparison: EsTreeNodeOfType<"BinaryExpression">,
  validatedParameterName: string,
): string | null => {
  if (isTypeofOperand(comparison.left) && isTypeofResultLiteral(comparison.right)) {
    return getTypeofMemberCheckKey(comparison.left, validatedParameterName);
  }
  if (isTypeofOperand(comparison.right) && isTypeofResultLiteral(comparison.left)) {
    return getTypeofMemberCheckKey(comparison.right, validatedParameterName);
  }
  return null;
};

// Collects the distinct properties of `validatedParameterName` checked
// with `typeof … === "<tag>"` inside the function body. Nested functions
// are pruned: their checks belong to their own validation, not this one.
const collectTypeofMemberCheckKeys = (
  functionNode: FunctionLikeNode,
  validatedParameterName: string,
): Set<string> => {
  const checkedPropertyKeys = new Set<string>();
  walkAst(functionNode.body, (node) => {
    if (node !== functionNode.body && isFunctionLike(node)) return false;
    if (!isNodeOfType(node, "BinaryExpression")) return;
    if (!TYPE_COMPARISON_OPERATORS.has(node.operator)) return;
    const checkKey = getTypeofMemberCheckKeyFromComparison(node, validatedParameterName);
    if (checkKey) checkedPropertyKeys.add(checkKey);
  });
  return checkedPropertyKeys;
};

const describeFunction = (
  functionName: string | null,
  predicate: EsTreeNodeOfType<"TSTypePredicate"> | null,
): string => {
  if (functionName) return `\`${functionName}\``;
  if (predicate?.asserts) return "This assertion function";
  if (predicate) return "This type guard";
  return "This validator";
};

const buildMessage = (
  functionName: string | null,
  predicate: EsTreeNodeOfType<"TSTypePredicate"> | null,
  validatedParameterName: string,
  checkCount: number,
): string =>
  `${describeFunction(functionName, predicate)} hand-rolls runtime validation with ${checkCount} \`typeof\` checks on \`${validatedParameterName}\`. Parse \`${validatedParameterName}\` once with a schema validator (Zod, Valibot, Yup) to get a typed, validated value instead of maintaining the checks by hand.`;

export const preferSchemaValidation = defineRule<Rule>({
  id: "prefer-schema-validation",
  title: "Hand-rolled type validation",
  severity: "warn",
  recommendation:
    "A function that checks an object's shape with several `typeof` comparisons is a schema written by hand. Define the shape once with a schema validator (Zod, Valibot, Yup) and parse the value, so the type and the runtime check stay in sync.",
  create: (context: RuleContext) => {
    const inspectFunction = (functionNode: FunctionLikeNode): void => {
      const predicate = getReturnTypePredicate(functionNode);
      const functionName = getFunctionBindingName(functionNode);
      const hasValidatorName = functionName !== null && looksLikeValidatorName(functionName);
      if (!predicate && !hasValidatorName) return;

      const validatedParameterName = getValidatedParameterName(functionNode, predicate);
      if (!validatedParameterName) return;

      const checkedPropertyKeys = collectTypeofMemberCheckKeys(
        functionNode,
        validatedParameterName,
      );
      if (checkedPropertyKeys.size < MINIMUM_TYPEOF_MEMBER_CHECKS) return;

      context.report({
        node: functionNode,
        message: buildMessage(
          functionName,
          predicate,
          validatedParameterName,
          checkedPropertyKeys.size,
        ),
      });
    };

    return {
      ArrowFunctionExpression: inspectFunction,
      FunctionExpression: inspectFunction,
      FunctionDeclaration: inspectFunction,
    };
  },
});
