import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getZodFactoryCallName,
  getMethodCall,
  isObjectExpressionWithAnyProperty,
  isZodFactoryCall,
} from "./utils/zod-ast.js";

const ZOD_FACTORIES_WITH_ERROR_PARAMS = new Set([
  "any",
  "array",
  "bigint",
  "boolean",
  "date",
  "enum",
  "literal",
  "map",
  "nativeEnum",
  "never",
  "null",
  "number",
  "object",
  "record",
  "set",
  "string",
  "tuple",
  "undefined",
  "union",
  "unknown",
  "void",
]);

const DROPPED_ERROR_OPTION_PROPERTIES = new Set([
  "errorMap",
  "invalid_type_error",
  "required_error",
]);
const FACTORIES_WITH_LEGACY_FIRST_ARG_MESSAGE = new Set([
  "bigint",
  "boolean",
  "date",
  "number",
  "string",
]);
const ERROR_MAP_PROPERTY = new Set(["errorMap"]);
const PARSE_METHODS = new Set(["parse", "safeParse", "parseAsync", "safeParseAsync"]);

const firstArgumentIsMessageString = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const firstArgument = callExpression.arguments[0] as EsTreeNode | undefined;
  const inner = firstArgument ? stripParenExpression(firstArgument) : null;
  return Boolean(inner && isNodeOfType(inner, "Literal") && typeof inner.value === "string");
};

const factoryUsesDeprecatedErrorParameter = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const factoryName = getZodFactoryCallName(callExpression);
  if (factoryName === null || !ZOD_FACTORIES_WITH_ERROR_PARAMS.has(factoryName)) return false;
  return (
    (FACTORIES_WITH_LEGACY_FIRST_ARG_MESSAGE.has(factoryName) &&
      firstArgumentIsMessageString(callExpression)) ||
    callExpression.arguments.some((argument) =>
      isObjectExpressionWithAnyProperty(
        argument as EsTreeNode | undefined,
        DROPPED_ERROR_OPTION_PROPERTIES,
      ),
    )
  );
};

const parseCallUsesErrorMap = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean => {
  const methodCall = getMethodCall(callExpression);
  if (!methodCall || !PARSE_METHODS.has(methodCall.methodName)) return false;
  const receiver = stripParenExpression(methodCall.receiver);
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  if (!isZodFactoryCall(receiver, ZOD_FACTORIES_WITH_ERROR_PARAMS)) return false;
  return isObjectExpressionWithAnyProperty(
    callExpression.arguments[1] as EsTreeNode | undefined,
    ERROR_MAP_PROPERTY,
  );
};

export const zodV4NoDeprecatedErrorCustomization = defineRule<Rule>({
  id: "zod-v4-no-deprecated-error-customization",
  title: "Deprecated Zod error customization",
  requires: ["zod:4"],
  tags: ["migration-hint"],
  severity: "warn",
  recommendation:
    "In Zod 4, use the single `{ error }` option instead of message strings, `invalid_type_error`, `required_error`, or `errorMap`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!factoryUsesDeprecatedErrorParameter(node) && !parseCallUsesErrorMap(node)) return;
      context.report({
        node,
        message: "Zod 4 changed how you customize error messages, so this breaks when you upgrade.",
      });
    },
  }),
});
