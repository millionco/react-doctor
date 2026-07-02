import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { getCalleeName } from "../../utils/get-callee-name.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { isInlineFunctionExpression } from "../../utils/is-inline-function-expression.js";
import { walkAst } from "../../utils/walk-ast.js";
import type { EsTreeNode } from "../../utils/es-tree-node.js";
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
  "Your users can't submit this <form> without JavaScript because onSubmit calls preventDefault(), so use a server action like `<form action={serverAction}>` to make it work either way.";

// Used for `framework === "unknown"` (project classification failed or
// not yet wired). Keeps the diagnostic but drops the framework-specific
// "server action" jargon so the advice stays honest.
const FORM_MESSAGE_GENERIC =
  "Your users can't submit this <form> when JavaScript is off, so the form won't work without JavaScript. Consider a form action so it still works.";

const ANCHOR_MESSAGE =
  "Your users click this <a> & nothing navigates because onClick calls preventDefault(), so use a <button> or a routing component instead.";

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

// Terminal callee names that read as navigation: router / history APIs
// (`navigate`, `router.push`, `history.replace`, `history.go/back/forward`),
// location APIs (`location.assign`, `location.replace`, `window.open`),
// framework redirects (`redirect`), and desktop / native link openers
// (`platform.openLink`, `Linking.openURL`). Deliberately NOT "any other
// call": a handler that only logs or tracks (`analytics.track(...)`,
// `console.log(...)`) after preventDefault() still leaves the link dead.
const NAVIGATION_CALLEE_NAMES: ReadonlySet<string> = new Set([
  "navigate",
  "push",
  "replace",
  "assign",
  "redirect",
  "open",
  "openLink",
  "openURL",
  "go",
  "back",
  "forward",
]);

const GLOBAL_LOCATION_RECEIVER_NAMES: ReadonlySet<string> = new Set([
  "window",
  "document",
  "globalThis",
  "self",
  "top",
]);

const isLocationAssignmentTarget = (target: EsTreeNode): boolean => {
  if (!isNodeOfType(target, "MemberExpression") || !isNodeOfType(target.property, "Identifier"))
    return false;
  if (target.property.name === "location") {
    return (
      isNodeOfType(target.object, "Identifier") &&
      GLOBAL_LOCATION_RECEIVER_NAMES.has(target.object.name)
    );
  }
  if (target.property.name !== "href") return false;
  if (isNodeOfType(target.object, "Identifier")) return target.object.name === "location";
  return (
    isNodeOfType(target.object, "MemberExpression") &&
    isNodeOfType(target.object.property, "Identifier") &&
    target.object.property.name === "location"
  );
};

const containsNavigationEffect = (node: EsTreeNode): boolean => {
  let didFindNavigation = false;
  walkAst(node, (child) => {
    if (didFindNavigation) return;
    if (isNodeOfType(child, "AssignmentExpression") && isLocationAssignmentTarget(child.left)) {
      didFindNavigation = true;
      return;
    }
    const calleeName = getCalleeName(child);
    if (calleeName !== null && NAVIGATION_CALLEE_NAMES.has(calleeName)) {
      didFindNavigation = true;
    }
  });
  return didFindNavigation;
};

const selectFormMessage = (framework: string | undefined): string =>
  framework !== undefined && SERVER_CAPABLE_FRAMEWORKS.has(framework)
    ? FORM_MESSAGE_SERVER_CAPABLE
    : FORM_MESSAGE_GENERIC;

export const noPreventDefault = defineRule({
  id: "no-prevent-default",
  title: "preventDefault on a form or link",
  severity: "warn",
  recommendation:
    "Use `<form action>` where your framework supports it (it works without JS), or use a `<button>` instead of an `<a>` with preventDefault.",
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

        // An `<a>` without href never navigates on click (anchor-as-button,
        // e.g. an ant-design Dropdown trigger), so "nothing navigates
        // because onClick calls preventDefault()" would be false — the
        // preventDefault() is defensive, not a dead link.
        if (elementName === "a" && !findJsxAttribute(node.attributes ?? [], "href")) return;

        for (const targetEventProp of targetEventProps) {
          const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
          if (
            !eventAttribute?.value ||
            !isNodeOfType(eventAttribute.value, "JSXExpressionContainer")
          )
            continue;

          const expression = eventAttribute.value.expression;
          if (!isInlineFunctionExpression(expression)) continue;

          if (!containsPreventDefaultCall(expression)) continue;

          // An anchor whose handler performs its own navigation after
          // preventDefault() (router push, `platform.openLink(href)`,
          // a `location.href` assignment) is custom SPA / desktop
          // navigation, not a dead link. The <form> variant keeps its
          // existing behavior.
          if (elementName === "a" && containsNavigationEffect(expression)) continue;

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
