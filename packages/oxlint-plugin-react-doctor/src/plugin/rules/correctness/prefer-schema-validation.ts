import { MANUAL_TYPE_CHECK_THRESHOLD } from "../../constants/thresholds.js";
import { defineRule } from "../../utils/define-rule.js";
import { walkAst } from "../../utils/walk-ast.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";

const SCHEMA_VALIDATION_LIBRARIES: ReadonlySet<string> = new Set([
  "zod",
  "yup",
  "joi",
  "valibot",
  "superstruct",
  "io-ts",
  "runtypes",
  "arktype",
  "@effect/schema",
  "effect/Schema",
  "typebox",
  "@sinclair/typebox",
  "ow",
  "fastest-validator",
  "class-validator",
  "myzod",
  "decoders",
]);

const TYPEOF_GUARD_ONLY_TARGETS: ReadonlySet<string> = new Set(["undefined", "function"]);

const isTypeofExpression = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "UnaryExpression") && node.operator === "typeof";

const isTypeofComparisonForValueType = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "BinaryExpression")) return false;
  if (
    node.operator !== "===" &&
    node.operator !== "!==" &&
    node.operator !== "==" &&
    node.operator !== "!="
  )
    return false;

  const leftIsTypeof = isTypeofExpression(node.left);
  const rightIsTypeof = isTypeofExpression(node.right);
  if (!leftIsTypeof && !rightIsTypeof) return false;

  const literalSide = leftIsTypeof ? node.right : node.left;
  if (!isNodeOfType(literalSide, "Literal") || typeof literalSide.value !== "string") return false;

  return !TYPEOF_GUARD_ONLY_TARGETS.has(literalSide.value);
};

const isInExpressionCheck = (node: EsTreeNode): boolean =>
  isNodeOfType(node, "BinaryExpression") && node.operator === "in";

const isHasOwnPropertyCall = (node: EsTreeNode): boolean => {
  if (!isNodeOfType(node, "CallExpression")) return false;
  if (!isNodeOfType(node.callee, "MemberExpression")) return false;
  if (!isNodeOfType(node.callee.property, "Identifier")) return false;
  return node.callee.property.name === "hasOwnProperty" || node.callee.property.name === "hasOwn";
};

const fileImportsSchemaLibrary = (programNode: EsTreeNodeOfType<"Program">): boolean => {
  for (const statement of programNode.body) {
    if (!isNodeOfType(statement, "ImportDeclaration")) continue;
    const sourceValue = statement.source?.value;
    if (typeof sourceValue !== "string") continue;
    if (SCHEMA_VALIDATION_LIBRARIES.has(sourceValue)) return true;
    for (const libraryName of SCHEMA_VALIDATION_LIBRARIES) {
      if (sourceValue.startsWith(`${libraryName}/`)) return true;
    }
  }
  return false;
};

const countManualTypeChecksInBody = (bodyNode: EsTreeNode): number => {
  let typeCheckCount = 0;
  walkAst(bodyNode, (child) => {
    if (isFunctionLike(child) && child !== bodyNode) return false;
    if (isTypeofComparisonForValueType(child)) {
      typeCheckCount++;
    } else if (isInExpressionCheck(child)) {
      typeCheckCount++;
    } else if (isHasOwnPropertyCall(child)) {
      typeCheckCount++;
    }
  });
  return typeCheckCount;
};

export const preferSchemaValidation = defineRule<Rule>({
  id: "prefer-schema-validation",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Replace manual typeof / in / hasOwnProperty checks with a schema validation library (zod, valibot, superstruct, etc.)",
  create: (context: RuleContext) => {
    let programImportsSchemaLibrary = false;

    return {
      Program(node: EsTreeNodeOfType<"Program">) {
        programImportsSchemaLibrary = fileImportsSchemaLibrary(node);
      },

      FunctionDeclaration(node: EsTreeNodeOfType<"FunctionDeclaration">) {
        if (programImportsSchemaLibrary) return;
        if (!node.body) return;
        const typeCheckCount = countManualTypeChecksInBody(node.body);
        if (typeCheckCount >= MANUAL_TYPE_CHECK_THRESHOLD) {
          context.report({
            node: node.id ?? node,
            message: `${typeCheckCount} manual type checks (typeof / in / hasOwnProperty) — use a schema validation library instead`,
          });
        }
      },

      ArrowFunctionExpression(node: EsTreeNodeOfType<"ArrowFunctionExpression">) {
        if (programImportsSchemaLibrary) return;
        if (!node.body) return;
        const typeCheckCount = countManualTypeChecksInBody(node.body);
        if (typeCheckCount >= MANUAL_TYPE_CHECK_THRESHOLD) {
          const parentNode = node.parent;
          const reportNode =
            parentNode &&
            isNodeOfType(parentNode, "VariableDeclarator") &&
            isNodeOfType(parentNode.id, "Identifier")
              ? parentNode.id
              : node;
          context.report({
            node: reportNode,
            message: `${typeCheckCount} manual type checks (typeof / in / hasOwnProperty) — use a schema validation library instead`,
          });
        }
      },

      FunctionExpression(node: EsTreeNodeOfType<"FunctionExpression">) {
        if (programImportsSchemaLibrary) return;
        if (!node.body) return;
        const typeCheckCount = countManualTypeChecksInBody(node.body);
        if (typeCheckCount >= MANUAL_TYPE_CHECK_THRESHOLD) {
          context.report({
            node: node.id ?? node,
            message: `${typeCheckCount} manual type checks (typeof / in / hasOwnProperty) — use a schema validation library instead`,
          });
        }
      },
    };
  },
});
