import { TRIVIAL_INITIALIZER_NAMES } from "../../constants/react.js";
import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isReactHookCall } from "../../utils/is-react-hook-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import { isReactHookName } from "../../utils/is-react-hook-name.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { stripParenExpression } from "../../utils/strip-paren-expression.js";

export const rerenderLazyRefInit = defineRule({
  id: "rerender-lazy-ref-init",
  title: "Ref initializer runs on every render",
  tags: ["test-noise"],
  severity: "warn",
  category: "Performance",
  recommendation:
    "Initialize the ref lazily so expensive values are not rebuilt and discarded on every render.",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isReactHookCall(node, "useRef", context.scopes) || !node.arguments?.length) return;
      const initializer = stripParenExpression(node.arguments[0]);

      const isPlainCall = isNodeOfType(initializer, "CallExpression");
      const isNewCall = isNodeOfType(initializer, "NewExpression");
      if (!isPlainCall && !isNewCall) return;

      const callee = initializer.callee;
      const memberPropertyName =
        isNodeOfType(callee, "MemberExpression") &&
        (isNodeOfType(callee.property, "Identifier") ||
          isNodeOfType(callee.property, "PrivateIdentifier"))
          ? callee.property.name
          : null;
      const calleeName = isNodeOfType(callee, "Identifier")
        ? callee.name
        : (memberPropertyName ?? "fn");

      if (TRIVIAL_INITIALIZER_NAMES.has(calleeName)) return;

      if (isPlainCall && isReactHookName(calleeName)) return;

      const callShape = isNewCall ? `new ${calleeName}()` : `${calleeName}()`;

      context.report({
        node: initializer,
        message: `useRef(${callShape}) rebuilds this value on every render & throws it away.`,
      });
    },
  }),
});
