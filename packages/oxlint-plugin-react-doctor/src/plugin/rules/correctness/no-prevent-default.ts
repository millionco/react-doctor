import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
import type { Rule } from "../../utils/rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";

// HACK: <button> is intentionally omitted. <button type="submit"> (the
// HTML default inside a form) has a real default action, so calling
// preventDefault() on it is legitimate. The narrow case of
// <button type="button"> would need attribute inspection plus form-scope
// detection to be reliable; out of scope until we have evidence of real
// false-negatives.
// HACK: Map (not plain object) so a JSX tag named after an
// Object.prototype property (`<constructor>`, `<toString>`) doesn't
// fall through to a truthy `Object.prototype.X` value and crash on
// `targetEventProps.includes(...)` later in the rule body.
const PREVENT_DEFAULT_ELEMENTS = new Map<string, string[]>([
  ["form", ["onSubmit"]],
  ["a", ["onClick"]],
]);

// Frameworks that ship a first-class server-mutation story tied to
// plain `<form>` elements — Next.js Server Actions, TanStack Server
// Functions, Remix loader/action handlers. Recommending
// `<form action={serverAction}>` is honest progressive-enhancement
// advice in these projects.
const SERVER_CAPABLE_FRAMEWORKS = new Set<string>(["nextjs", "tanstack-start", "remix"]);

// SPA / mobile frameworks where calling `preventDefault()` inside an
// onSubmit IS the canonical pattern. The framework has no server-side
// form handler to fall back to, so the "use a server action" advice
// would be actively misleading. Suppress the form variant entirely.
const CLIENT_ONLY_FRAMEWORKS = new Set<string>(["vite", "cra", "gatsby", "react-native", "expo"]);

const FORM_MESSAGE_SERVER_CAPABLE =
  "preventDefault() on <form> onSubmit — form won't work without JavaScript. Use a server action (`<form action={serverAction}>`) for progressive enhancement";

// Used for `framework === "unknown"` (project classification failed or
// not yet wired). Keeps the diagnostic but drops the framework-specific
// "server action" jargon so the advice stays honest.
const FORM_MESSAGE_GENERIC =
  "preventDefault() on <form> onSubmit — form won't work without JavaScript. Consider a form action for progressive enhancement";

const ANCHOR_MESSAGE =
  "preventDefault() on <a> onClick — use a <button> or routing component instead";

const containsPreventDefaultCall = (node: EsTreeNode): boolean => {
  let didFindPreventDefault = false;
  walkAst(node, (child) => {
    if (didFindPreventDefault) return;
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "preventDefault"
    ) {
      didFindPreventDefault = true;
    }
  });
  return didFindPreventDefault;
};

const selectFormMessage = (framework: string | undefined): string =>
  framework !== undefined && SERVER_CAPABLE_FRAMEWORKS.has(framework)
    ? FORM_MESSAGE_SERVER_CAPABLE
    : FORM_MESSAGE_GENERIC;

export const noPreventDefault = defineRule<Rule>({
  id: "no-prevent-default",
  severity: "warn",
  recommendation:
    "Use `<form action>` (works without JS) where your framework supports it, or use a `<button>` instead of `<a>` with preventDefault",
  create: (context: RuleContext) => {
    const framework = getReactDoctorStringSetting(context.settings, "framework");
    const isClientOnlyFramework = framework !== undefined && CLIENT_ONLY_FRAMEWORKS.has(framework);
    const formMessage = selectFormMessage(framework);

    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
        if (!elementName) return;

        const targetEventProps = PREVENT_DEFAULT_ELEMENTS.get(elementName);
        if (!targetEventProps) return;

        // SPA / mobile frameworks: `preventDefault()` on a real `<form>`
        // is the canonical pattern. Skip the form variant entirely so
        // we don't recommend a server-action story the project can't use.
        if (elementName === "form" && isClientOnlyFramework) return;

        for (const targetEventProp of targetEventProps) {
          const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
          if (
            !eventAttribute?.value ||
            !isNodeOfType(eventAttribute.value, "JSXExpressionContainer")
          )
            continue;

          const expression = eventAttribute.value.expression;
          if (
            !isNodeOfType(expression, "ArrowFunctionExpression") &&
            !isNodeOfType(expression, "FunctionExpression")
          )
            continue;

          if (!containsPreventDefaultCall(expression)) continue;

          context.report({
            node,
            message: elementName === "form" ? formMessage : ANCHOR_MESSAGE,
          });
          return;
        }
      },
    };
  },
});
