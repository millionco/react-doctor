import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { isCreateElementCall } from "../../utils/is-create-element-call.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const buildMessage = (componentName: string): string =>
  `React can't render namespaced names like \`${componentName}\`.`;

// Port of `oxc_linter::rules::react::no_namespace`. Flags JSX namespaced
// names (`<ns:Foo />`) and string-literal element types passed to
// `React.createElement` that contain a colon.
export const noNamespace = defineRule<Rule>({
  id: "no-namespace",
  title: "Namespaced JSX element",
  severity: "warn",
  recommendation:
    "Use a plain component or DOM tag because React cannot render JSX namespaced names like `ns:Foo`.",
  create: (context) => ({
    JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
      if (!isNodeOfType(node.name, "JSXNamespacedName")) return;
      const namespaced = node.name;
      const fullName = `${namespaced.namespace.name}:${namespaced.name.name}`;
      context.report({ node: namespaced, message: buildMessage(fullName) });
    },
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      if (!isCreateElementCall(node)) return;
      const firstArgument = node.arguments[0];
      if (!firstArgument) return;
      if (!isNodeOfType(firstArgument, "Literal") || typeof firstArgument.value !== "string")
        return;
      if (!firstArgument.value.includes(":")) return;
      context.report({ node: firstArgument, message: buildMessage(firstArgument.value) });
    },
  }),
});
