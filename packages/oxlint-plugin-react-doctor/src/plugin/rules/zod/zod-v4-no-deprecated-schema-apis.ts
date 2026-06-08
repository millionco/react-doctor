import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import {
  getMethodCall,
  getStaticPropertyName,
  getZodNamedImport,
  getZodNamespaceMemberName,
  isDirectMethodCallOnZodFactory,
  isZodFactoryCall,
  isZodNamespaceIdentifier,
} from "./utils/zod-ast.js";

const OBJECT_FACTORY = new Set(["object"]);
const OBJECT_METHODS = new Set([
  "deepPartial",
  "merge",
  "nonstrict",
  "passthrough",
  "strict",
  "strip",
]);

const NUMBER_FACTORY = new Set(["number"]);
const NUMBER_METHODS = new Set(["safe"]);

const FUNCTION_FACTORY = new Set(["function"]);
const FUNCTION_CHAIN_METHODS = new Set(["args", "returns"]);

const DEPRECATED_TOP_LEVEL_FACTORIES = new Set([
  "nativeEnum",
  "ostring",
  "onumber",
  "oboolean",
  "oarray",
  "promise",
]);

const FACTORIES_WITH_DROPPED_CREATE = new Set([
  "any",
  "array",
  "bigint",
  "boolean",
  "date",
  "enum",
  "function",
  "literal",
  "map",
  "nativeEnum",
  "never",
  "null",
  "number",
  "object",
  "optional",
  "promise",
  "record",
  "set",
  "string",
  "tuple",
  "undefined",
  "union",
  "unknown",
  "void",
]);

const ENUM_PROPERTY_ALIASES = new Set(["Enum", "Values"]);
const ENUM_FACTORY = new Set(["enum"]);
const RECORD_FACTORY = new Set(["record"]);
const LITERAL_FACTORY = new Set(["literal"]);

const reportSchemaMigration = (context: RuleContext, node: EsTreeNode): void => {
  context.report({
    node,
    message: "This Zod 3 schema API changed in Zod 4, so this schema can fail after the upgrade.",
  });
};

const isCallToDeprecatedTopLevelFactory = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => isZodFactoryCall(callExpression, DEPRECATED_TOP_LEVEL_FACTORIES);

const isCallToDroppedCreateFactory = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const methodCall = getMethodCall(callExpression);
  if (!methodCall || methodCall.methodName !== "create") return false;
  const receiver = stripParenExpression(methodCall.receiver);

  const namespaceMemberName = getZodNamespaceMemberName(receiver);
  if (namespaceMemberName !== null) return FACTORIES_WITH_DROPPED_CREATE.has(namespaceMemberName);

  if (!isNodeOfType(receiver, "Identifier")) return false;
  const imported = getZodNamedImport(receiver);
  return imported !== null && FACTORIES_WITH_DROPPED_CREATE.has(imported);
};

const isSingleArgumentRecordCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean =>
  callExpression.arguments.length === 1 && isZodFactoryCall(callExpression, RECORD_FACTORY);

const isDeprecatedFunctionChainCall = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean =>
  isDirectMethodCallOnZodFactory(callExpression, FUNCTION_FACTORY, FUNCTION_CHAIN_METHODS);

const isSymbolLiteralArgument = (node: EsTreeNode | null | undefined): boolean => {
  if (!node) return false;
  const inner = stripParenExpression(node);
  if (isNodeOfType(inner, "CallExpression")) {
    const callee = stripParenExpression(inner.callee as EsTreeNode);
    return isNodeOfType(callee, "Identifier") && callee.name === "Symbol";
  }
  if (!isNodeOfType(inner, "MemberExpression")) return false;
  const object = stripParenExpression(inner.object as EsTreeNode);
  return isNodeOfType(object, "Identifier") && object.name === "Symbol";
};

const isLiteralSymbolCall = (callExpression: EsTreeNodeOfType<"CallExpression">): boolean =>
  callExpression.arguments.length > 0 &&
  isZodFactoryCall(callExpression, LITERAL_FACTORY) &&
  isSymbolLiteralArgument(callExpression.arguments[0] as EsTreeNode);

const isDroppedEnumAliasAccess = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): boolean => {
  const propertyName = getStaticPropertyName(memberExpression);
  if (propertyName === null || !ENUM_PROPERTY_ALIASES.has(propertyName)) return false;
  const receiver = stripParenExpression(memberExpression.object as EsTreeNode);
  return isNodeOfType(receiver, "CallExpression") && isZodFactoryCall(receiver, ENUM_FACTORY);
};

const isRefineSecondArgumentFunction = (
  callExpression: EsTreeNodeOfType<"CallExpression">,
): boolean => {
  const methodCall = getMethodCall(callExpression);
  if (!methodCall || methodCall.methodName !== "refine") return false;
  const receiver = stripParenExpression(methodCall.receiver);
  if (!isNodeOfType(receiver, "CallExpression")) return false;
  if (!isZodFactoryCall(receiver, FACTORIES_WITH_DROPPED_CREATE)) return false;
  const secondArgument = callExpression.arguments[1] as EsTreeNode | undefined;
  return (
    isNodeOfType(secondArgument, "FunctionExpression") ||
    isNodeOfType(secondArgument, "ArrowFunctionExpression")
  );
};

const isZodNamespaceImportMemberCreate = (
  memberExpression: EsTreeNodeOfType<"MemberExpression">,
): boolean => {
  const propertyName = getStaticPropertyName(memberExpression);
  if (propertyName !== "create") return false;
  const receiver = stripParenExpression(memberExpression.object as EsTreeNode);
  if (!isNodeOfType(receiver, "MemberExpression")) return false;
  const factoryName = getStaticPropertyName(receiver);
  return (
    factoryName !== null &&
    FACTORIES_WITH_DROPPED_CREATE.has(factoryName) &&
    isZodNamespaceIdentifier(receiver.object as EsTreeNode)
  );
};

export const zodV4NoDeprecatedSchemaApis = defineRule<Rule>({
  id: "zod-v4-no-deprecated-schema-apis",
  title: "Zod 3 schema API breaks in Zod 4",
  requires: ["zod:4"],
  tags: ["migration-hint"],
  severity: "warn",
  recommendation:
    "Switch to the Zod 4 versions: top-level factories like `z.enum()`, object helpers like `z.strictObject()`, the new `z.function({ input, output })` form, and explicit key/value schemas for `z.record()`.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (
        isCallToDeprecatedTopLevelFactory(node) ||
        isCallToDroppedCreateFactory(node) ||
        isSingleArgumentRecordCall(node) ||
        isLiteralSymbolCall(node) ||
        isDeprecatedFunctionChainCall(node) ||
        isDirectMethodCallOnZodFactory(node, OBJECT_FACTORY, OBJECT_METHODS) ||
        isDirectMethodCallOnZodFactory(node, NUMBER_FACTORY, NUMBER_METHODS) ||
        isRefineSecondArgumentFunction(node)
      ) {
        reportSchemaMigration(context, node);
      }
    },
    MemberExpression(node: EsTreeNodeOfType<"MemberExpression">) {
      const parent = node.parent;
      if (
        parent &&
        isNodeOfType(parent, "CallExpression") &&
        stripParenExpression(parent.callee as EsTreeNode) === node
      ) {
        return;
      }
      if (isDroppedEnumAliasAccess(node) || isZodNamespaceImportMemberCreate(node)) {
        reportSchemaMigration(context, node);
      }
    },
  }),
});
