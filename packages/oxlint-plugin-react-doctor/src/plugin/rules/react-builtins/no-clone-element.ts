import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isImportedFromModule } from "../../utils/find-import-source-for-name.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";
import type { Rule } from "../../utils/rule.js";

const MESSAGE =
  "`React.cloneElement` couples the parent to the child's prop shape, so child prop changes can silently break injected behavior.";

// Port of `oxc_linter::rules::react::no_clone_element`. Flags
// `cloneElement(...)` and `<NS>.cloneElement(...)` when `cloneElement`
// (or `<NS>` for the namespace form) was imported from `"react"`.
// Helpers like `import { cloneElement } from 'something-else'` or local
// `const cloneElement = ...` aren't flagged.
export const noCloneElement = defineRule<Rule>({
  id: "no-clone-element",
  title: "cloneElement makes child props fragile",
  severity: "warn",
  // `React.cloneElement` is a valid React API still used in HOCs,
  // headless-UI libraries (Radix, Headless UI), and child-prop
  // injection patterns. Discouraging it is an opinion, not a bug
  // class. Default off.
  defaultEnabled: false,
  recommendation:
    "Pass children or render props instead so parent code does not depend on fragile cloned child props.",
  category: "Architecture",
  create: (context) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const callee = stripParenExpression(node.callee);

      if (isNodeOfType(callee, "Identifier") && callee.name === "cloneElement") {
        if (isImportedFromModule(node, "cloneElement", "react")) {
          context.report({ node: callee, message: MESSAGE });
        }
        return;
      }

      if (isNodeOfType(callee, "MemberExpression")) {
        let propertyName: string | null = null;
        if (isNodeOfType(callee.property, "Identifier")) propertyName = callee.property.name;
        else if (
          isNodeOfType(callee.property, "Literal") &&
          typeof callee.property.value === "string"
        ) {
          propertyName = callee.property.value;
        }
        if (propertyName !== "cloneElement") return;

        if (!isNodeOfType(callee.object, "Identifier")) return;
        if (!isImportedFromModule(node, callee.object.name, "react")) return;
        context.report({ node: callee, message: MESSAGE });
      }
    },
  }),
});
