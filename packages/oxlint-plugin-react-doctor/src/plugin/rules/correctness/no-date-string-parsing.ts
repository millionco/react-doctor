import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { findVariableInitializer } from "../../utils/find-variable-initializer.js";
import { getStaticTemplateLiteralValue } from "../../utils/get-static-template-literal-value.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

// Full ISO 8601 with a `T` separator AND an explicit timezone designator
// (trailing `Z` or `±HH:MM` offset). ECMAScript specifies this subset
// deterministically, so V8/JSC/SpiderMonkey/Node all parse it to the same
// instant — flagging it would be a false positive. Every other shape
// (date-only `2022-11-05`, space-separated `2023-08-04 13:00:00`,
// slash/word `01/02/2021`/`Jan 5 2021`, partial `2021-4-15`) is
// engine- and timezone-dependent, so it stays flagged.
const SPEC_DETERMINISTIC_ISO_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const NEW_DATE_MESSAGE =
  "Parsing a date string with `new Date(...)` gives engine- and timezone-dependent results that can silently be `Invalid Date` in some browsers; build the date from numeric parts (`new Date(year, monthIndex, day)`) or parse an explicit format with date-fns `parse`/`parseISO`.";

const DATE_PARSE_MESSAGE =
  "`Date.parse` reads a date string with engine- and timezone-dependent rules that can silently return `NaN` in some browsers; build the date from numeric parts (`new Date(year, monthIndex, day)`) or parse an explicit format with date-fns `parse`/`parseISO`.";

// Resolve an expression to a statically-known string value, following a
// single same-file identifier binding. Returns null for anything the
// linter can't prove is a string literal (numbers, Date instances,
// parameters, imports, member accesses, calls, interpolated templates) so
// the rule abstains rather than guessing.
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
    if (!initializer) return null;
    if (
      isNodeOfType(initializer, "Literal") &&
      typeof initializer.value === "string"
    ) {
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

export const noDateStringParsing = defineRule({
  id: "no-date-string-parsing",
  title: "Date parsed from a string",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Construct dates from explicit numeric parts (`new Date(year, monthIndex, day)`) or an epoch-ms number, or parse a known format with date-fns `parse`/`parseISO` instead of `new Date(str)` / `Date.parse(str)`.",
  create: (context: RuleContext) => ({
    NewExpression(node: EsTreeNodeOfType<"NewExpression">) {
      if (
        !isNodeOfType(node.callee, "Identifier") ||
        node.callee.name !== "Date"
      )
        return;
      const args = node.arguments ?? [];
      if (args.length !== 1) return;
      const value = resolveStaticStringValue(args[0] as EsTreeNode);
      if (value === null) return;
      if (SPEC_DETERMINISTIC_ISO_PATTERN.test(value)) return;
      context.report({ node, message: NEW_DATE_MESSAGE });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isDateParseMemberCallee(node.callee as EsTreeNode)) return;
      // A single argument that statically resolves to a spec-deterministic
      // full-ISO string (`T` separator plus a trailing `Z`/offset) parses to
      // the same instant in every engine, so it is safe — mirror the
      // `new Date(...)` handler and abstain. A runtime value (member access,
      // parameter, call result) can't be proven safe and an ambiguous literal
      // is the documented footgun, so both still fire.
      const args = node.arguments ?? [];
      if (args.length === 1) {
        const value = resolveStaticStringValue(args[0] as EsTreeNode);
        if (value !== null && SPEC_DETERMINISTIC_ISO_PATTERN.test(value))
          return;
      }
      context.report({ node, message: DATE_PARSE_MESSAGE });
    },
  }),
});
