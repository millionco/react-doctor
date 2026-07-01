import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isObjectOfMemberAccess } from "../../utils/is-object-of-member-access.js";
import { isTestlikeFilename } from "../../utils/is-testlike-filename.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { RuleContext } from "../../utils/rule-context.js";

const MESSAGE =
  'This `!` erases `| undefined` from an optional object field (common on deserialized payloads), so the following access crashes with "Cannot read properties of undefined" when the field is missing at runtime; use optional chaining (`?.`) instead.';

// snake_case field names (`cart_items`, `retailer_milestone`) are the
// signature of a generated / deserialized API response type, where the
// field is genuinely optional. SCREAMING_SNAKE constants and plain
// camelCase names do not match.
const SNAKE_CASE_PROPERTY_PATTERN = /^[a-z][a-z0-9]*(_[a-z0-9]+)+$/;

// A SCREAMING_SNAKE_CASE root (`INFO_PAGE_COPY.zh!.agentGuides!`) is a
// module-level constant / static data table the author populated, not a
// deserialized network payload, so a chained assertion on it is safe by
// construction rather than the runtime-crash shape this rule targets.
const SCREAMING_SNAKE_ROOT_PATTERN = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/;

// Walk a member/assertion chain down to its root identifier name, peeling
// parens, non-null assertions, and (computed or not) member accesses.
// Returns null when the root is not a plain identifier (e.g. `this`).
const chainRootName = (node: EsTreeNode): string | null => {
  let current = stripParenExpression(node);
  while (isNodeOfType(current, "MemberExpression")) {
    current = stripParenExpression(current.object as EsTreeNode);
  }
  return isNodeOfType(current, "Identifier") ? current.name : null;
};

// A ref-like base is excluded: `ref.current!`, `inputRef.current!.focus()`.
// The `current` property and any identifier ending in `Ref` are the React
// ref idiom the author knows is populated.
const isRefLikeBase = (base: EsTreeNodeOfType<"MemberExpression">): boolean => {
  if (isNodeOfType(base.property, "Identifier") && base.property.name === "current") return true;
  const object = stripParenExpression(base.object);
  return Boolean(isNodeOfType(object, "Identifier") && object.name.endsWith("Ref"));
};

export const noNonNullAssertionOnMemberAccess = defineRule({
  id: "no-non-null-assertion-on-member-access",
  title: "Non-null assertion on an optional field",
  severity: "warn",
  category: "Correctness",
  recommendation:
    "Replace `obj.field!` with optional chaining (`obj.field?.`) or a guard; asserting non-null on an optional deserialized field crashes when it is actually undefined.",
  create: (context: RuleContext) => {
    const skipTestlikeFile = isTestlikeFilename(context.filename);
    return {
      TSNonNullExpression(node: EsTreeNodeOfType<"TSNonNullExpression">) {
        if (skipTestlikeFile) return;
        const base = stripParenExpression(node.expression as EsTreeNode);
        if (!isNodeOfType(base, "MemberExpression") || base.computed) return;
        if (!isObjectOfMemberAccess(node as EsTreeNode)) return;
        if (isRefLikeBase(base)) return;

        // Read `base.object` raw — `stripParenExpression` peels
        // `TSNonNullExpression` too, which would hide the very chained
        // assertion (`a!.b!`) this arm is looking for.
        const isChainedAssertion = isNodeOfType(base.object, "TSNonNullExpression");
        const isSnakeCaseField =
          isNodeOfType(base.property, "Identifier") &&
          SNAKE_CASE_PROPERTY_PATTERN.test(base.property.name);
        if (!isChainedAssertion && !isSnakeCaseField) return;

        // A pure-chaining hit (no snake_case field) rooted at a
        // SCREAMING_SNAKE constant or a `*Ref` is a known-populated
        // constant / ref idiom, not the deserialized-payload crash shape.
        if (isChainedAssertion && !isSnakeCaseField) {
          const rootName = chainRootName(base);
          if (
            rootName &&
            (SCREAMING_SNAKE_ROOT_PATTERN.test(rootName) || rootName.endsWith("Ref"))
          ) {
            return;
          }
        }

        context.report({ node, message: MESSAGE });
      },
    };
  },
});
