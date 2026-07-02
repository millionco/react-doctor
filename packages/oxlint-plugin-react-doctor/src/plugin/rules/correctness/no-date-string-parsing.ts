import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isAstNode } from "../../utils/is-ast-node.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Full ISO 8601 with a `T` separator AND an explicit timezone designator
// (trailing `Z` or `±HH:MM` offset). ECMAScript specifies this subset
// deterministically, so V8/JSC/SpiderMonkey/Node all parse it to the same
// instant — flagging it would be a false positive. Calendar-valid
// date-only strings (`2022-11-05`) have been spec-deterministic UTC
// midnight since ES2016 and are also safe. Every other shape
// (space-separated `2023-08-04 13:00:00`, slash/word
// `01/02/2021`/`Jan 5 2021`, partial `2021-4-15`, calendar-invalid
// `2021-02-30`) is engine- and timezone-dependent, so it stays flagged.
const SPEC_DETERMINISTIC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const DATE_ONLY_ISO_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const NEW_DATE_MESSAGE =
  "Parsing a date string with `new Date(...)` gives engine- and timezone-dependent results that can silently be `Invalid Date` in some browsers; build the date from numeric parts (`new Date(year, monthIndex, day)`) or parse an explicit format with date-fns `parse`/`parseISO`.";

const DATE_PARSE_MESSAGE =
  "`Date.parse` reads a date string with engine- and timezone-dependent rules that can silently return `NaN` in some browsers; build the date from numeric parts (`new Date(year, monthIndex, day)`) or parse an explicit format with date-fns `parse`/`parseISO`.";

const isCalendarValidDateOnlyLiteral = (value: string): boolean => {
  const match = DATE_ONLY_ISO_PATTERN.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const roundTripped = new Date(Date.UTC(year, monthIndex, day));
  return roundTripped.getUTCMonth() === monthIndex && roundTripped.getUTCDate() === day;
};

const isSpecDeterministicDateString = (value: string): boolean =>
  SPEC_DETERMINISTIC_ISO_PATTERN.test(value) || isCalendarValidDateOnlyLiteral(value);

const someChildNode = (node: EsTreeNode, predicate: (child: EsTreeNode) => boolean): boolean => {
  const nodeRecord = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(nodeRecord)) {
    if (key === "parent") continue;
    const child = nodeRecord[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (isAstNode(item) && predicate(item)) return true;
      }
    } else if (isAstNode(child) && predicate(child)) {
      return true;
    }
  }
  return false;
};

const containsIdentifierNamed = (node: EsTreeNode, bindingName: string): boolean => {
  if (isNodeOfType(node, "Identifier")) return node.name === bindingName;
  return someChildNode(node, (child) => containsIdentifierNamed(child, bindingName));
};

const hasReassignmentOfBinding = (node: EsTreeNode, bindingName: string): boolean => {
  if (
    isNodeOfType(node, "AssignmentExpression") &&
    containsIdentifierNamed(node.left as EsTreeNode, bindingName)
  ) {
    return true;
  }
  if (
    (isNodeOfType(node, "ForInStatement") || isNodeOfType(node, "ForOfStatement")) &&
    isNodeOfType(node.left as EsTreeNode, "Identifier") &&
    (node.left as EsTreeNodeOfType<"Identifier">).name === bindingName
  ) {
    return true;
  }
  return someChildNode(node, (child) => hasReassignmentOfBinding(child, bindingName));
};

// Resolve an expression to a statically-known string value, following a
// single same-file identifier binding. Returns null for anything the
// linter can't prove is the value actually parsed at runtime: numbers,
// Date instances, parameters, imports, member accesses, calls,
// interpolated templates, parameter/destructuring DEFAULTS (only used
// when the caller passes undefined), and non-const bindings that are
// reassigned anywhere in their scope. The rule abstains rather than
// guessing.
const resolveStaticStringValue = (expression: EsTreeNode): string | null => {
  const stripped = stripParenExpression(expression);
  if (isNodeOfType(stripped, "Literal") && typeof stripped.value === "string") {
    return stripped.value;
  }
  if (isNodeOfType(stripped, "TemplateLiteral")) {
    return getStaticTemplateLiteralValue(stripped);
  }
  if (isNodeOfType(stripped, "Identifier")) {
    const binding = findVariableInitializer(stripped, stripped.name);
    const initializer = binding?.initializer;
    if (!binding || !initializer) return null;
    const declarator = binding.bindingIdentifier.parent;
    if (
      !declarator ||
      !isNodeOfType(declarator, "VariableDeclarator") ||
      declarator.init !== initializer
    ) {
      return null;
    }
    const declaration = declarator.parent;
    const isConstBinding = Boolean(
      declaration &&
      isNodeOfType(declaration, "VariableDeclaration") &&
      declaration.kind === "const",
    );
    if (!isConstBinding && hasReassignmentOfBinding(binding.scopeOwner, stripped.name)) {
      return null;
    }
    if (isNodeOfType(initializer, "Literal") && typeof initializer.value === "string") {
      return initializer.value;
    }
    if (isNodeOfType(initializer, "TemplateLiteral")) {
      return getStaticTemplateLiteralValue(initializer);
    }
  }
  return null;
};

const isDateParseMemberCallee = (callee: EsTreeNode): boolean =>
  isNodeOfType(callee, "MemberExpression") &&
  !callee.computed &&
  isNodeOfType(callee.object, "Identifier") &&
  callee.object.name === "Date" &&
  isNodeOfType(callee.property, "Identifier") &&
  callee.property.name === "parse";

// Shared filter for both handlers: report only when the argument
// statically resolves to a string literal that is genuinely ambiguous.
// A runtime value (member access, parameter, call result) can't be
// proven unsafe — real-world callers overwhelmingly pair it with a
// Number.isNaN / getTime() validity guard — so the rule abstains. The
// empty string is the idiomatic deliberate `Invalid Date` sentinel and
// is also skipped.
const shouldReportDateStringArgument = (args: Array<unknown>): boolean => {
  if (args.length !== 1) return false;
  const value = resolveStaticStringValue(args[0] as EsTreeNode);
  if (value === null || value === "") return false;
  return !isSpecDeterministicDateString(value);
};

export const noDateStringParsing = defineRule({
  id: "no-date-string-parsing",
  title: "Date parsed from a string",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Construct dates from explicit numeric parts (`new Date(year, monthIndex, day)`) or an epoch-ms number, or parse a known format with date-fns `parse`/`parseISO` instead of `new Date(str)` / `Date.parse(str)`.",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (!isNodeOfType(node.callee, "Identifier") || node.callee.name !== "Date") return;
      if (!shouldReportDateStringArgument(node.arguments ?? [])) return;
      context.report({ node, message: NEW_DATE_MESSAGE });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isDateParseMemberCallee(node.callee as EsTreeNode)) return;
      if (!shouldReportDateStringArgument(node.arguments ?? [])) return;
      context.report({ node, message: DATE_PARSE_MESSAGE });
    },
  }),
});
