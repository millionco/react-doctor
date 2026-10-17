import { defineRule } from "../../utils/define-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { resolveJsxElementName } from "../../utils/resolve-jsx-element-name.js";

interface ScopedTranslatorBinding {
  readonly bindingName: string;
  readonly declarationNode: EsTreeNodeOfType<"VariableDeclarator">;
}

const FBTEE_SCOPED_HOOKS = new Set(["useFbt", "useFbs"]);
const FBTEE_BINDING_NAMES = new Set(["fbt", "fbs"]);

export const fbteeScopedJsxCompilerBailout = defineRule({
  id: "fbtee-scoped-jsx-compiler-bailout",
  title: "fbtee scoped JSX will bail out React Compiler",
  requires: ["react-compiler"],
  severity: "error",
  tags: ["i18n"],
  recommendation:
    "fbtee's scoped `useFbt()` / `useFbs()` bindings cause React Compiler to bail out when used in JSX. After fbtee's transform converts `<fbt>` to `fbt._()`, the compiler sees a local variable named `fbt` and cannot optimize. Either use fbtee's global import (`import fbt from 'fbtee'`) instead of the scoped hook, or suppress this diagnostic if the bailout is acceptable.",
  create: (context: RuleContext) => {
    const scopedBindings = new Map<string, ScopedTranslatorBinding>();

    return {
      VariableDeclarator(node: EsTreeNodeOfType<"VariableDeclarator">) {
        if (!isNodeOfType(node.init, "CallExpression")) return;
        if (!isNodeOfType(node.init.callee, "Identifier")) return;

        const hookName = node.init.callee.name;
        if (!FBTEE_SCOPED_HOOKS.has(hookName)) return;

        if (!isNodeOfType(node.id, "ObjectPattern")) return;

        for (const property of node.id.properties) {
          if (!isNodeOfType(property, "Property")) continue;
          if (!isNodeOfType(property.key, "Identifier")) continue;
          if (!isNodeOfType(property.value, "Identifier")) continue;

          const bindingName = property.value.name;
          if (!FBTEE_BINDING_NAMES.has(property.key.name)) continue;

          scopedBindings.set(bindingName, {
            bindingName,
            declarationNode: node,
          });
        }
      },

      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = resolveJsxElementName(node);
        if (!elementName) return;

        const binding = scopedBindings.get(elementName);
        if (!binding) return;

        context.report({
          node,
          message: `<${elementName}> uses a scoped fbtee binding. React Compiler will bail out after fbtee transforms this to ${elementName}._(), seeing a local variable named \`${elementName}\`.`,
        });
      },
    };
  },
});
