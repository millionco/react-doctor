import { NAVIGATION_RECEIVER_NAMES } from "../../constants/react.js";
import { collectPatternNames } from "../../utils/collect-pattern-names.js";
import { defineRule } from "../../utils/define-rule.js";
import { findJsxAttribute } from "../../utils/find-jsx-attribute.js";
import { findProgramRoot } from "../../utils/find-program-root.js";
import { hasCapability } from "../../utils/get-react-doctor-setting.js";
import { getReactDoctorStringSetting } from "../../utils/get-react-doctor-setting.js";
import { hasDirective } from "../../utils/has-directive.js";
import { hasJsxSpreadAttribute } from "../../utils/has-jsx-spread-attribute.js";
import { isFunctionLike } from "../../utils/is-function-like.js";
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

const FORM_MESSAGE_SERVER_CAPABLE =
  "Your users can't submit this <form> without JavaScript because onSubmit calls preventDefault(), so use a server action like `<form action={serverAction}>` to make it work either way.";

const FORM_MESSAGE_GENERIC =
  "Your users can't submit this <form> because onSubmit calls preventDefault().";

const ANCHOR_MESSAGE =
  "Your users click this <a> & nothing navigates because onClick calls preventDefault(), so use a <button> or a routing component instead.";

const collectPreventDefaultCalls = (node: EsTreeNode): EsTreeNode[] => {
  const preventDefaultCalls: EsTreeNode[] = [];
  walkAst(node, (child) => {
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "preventDefault"
    ) {
      preventDefaultCalls.push(child);
    }
  });
  return preventDefaultCalls;
};

// A preventDefault() guarded by a condition (`if (!ready)
// e.preventDefault()`) is a disabled-link state: in the other branch the
// anchor navigates normally, so "nothing navigates" doesn't hold.
const CONDITIONAL_CONSTRUCT_TYPES = new Set<string>([
  "IfStatement",
  "ConditionalExpression",
  "LogicalExpression",
  "SwitchCase",
]);

const isCallInsideConditional = (callNode: EsTreeNode, handlerRoot: EsTreeNode): boolean => {
  let ancestor: EsTreeNode | null | undefined = callNode.parent;
  while (ancestor && ancestor !== handlerRoot) {
    if (CONDITIONAL_CONSTRUCT_TYPES.has(ancestor.type)) return true;
    ancestor = ancestor.parent ?? null;
  }
  return false;
};

// A dead-link anchor stays flagged unless the handler carries POSITIVE
// navigation evidence: a navigation verb called on a navigation-shaped
// receiver (`router.push`, `history.replace`, `window.open`,
// `location.assign`), an unambiguous navigation callee regardless of
// receiver (`platform.openLink`, `Linking.openURL`, `redirectTo(...)`,
// `navigate(...)`), a `location` assignment (`location.href = ...`), or
// delegation to an enclosing parameter (`onNavigate()`). Ambiguous verbs
// on other receivers (`items.push`, `text.replace`, `Object.assign`) and
// non-navigating side effects (`analytics.track`, `console.log`) do NOT
// count — the link is still dead for the user.
const NAVIGATION_METHOD_NAME_PATTERN = /^(?:push|replace|assign|open|go|back|forward|reload)$/;

const UNAMBIGUOUS_NAVIGATION_CALLEE_NAME_PATTERN = /^(?:navigate|redirect|openLink|openURL)/i;

const NAVIGATION_FUNCTION_NAME_PATTERN = /^(?:navigate|redirect|open)/i;

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
    target.object.property.name === "location" &&
    isNodeOfType(target.object.object, "Identifier") &&
    GLOBAL_LOCATION_RECEIVER_NAMES.has(target.object.object.name)
  );
};

const isNavigationReceiverName = (receiverName: string): boolean =>
  NAVIGATION_RECEIVER_NAMES.has(receiverName) || receiverName === "window";

const isNavigationReceiver = (receiverNode: EsTreeNode): boolean => {
  if (isNodeOfType(receiverNode, "Identifier")) {
    return isNavigationReceiverName(receiverNode.name);
  }
  if (
    isNodeOfType(receiverNode, "MemberExpression") &&
    isNodeOfType(receiverNode.property, "Identifier")
  ) {
    return isNavigationReceiverName(receiverNode.property.name);
  }
  return false;
};

const collectEnclosingParameterNames = (handlerExpression: EsTreeNode): Set<string> => {
  const parameterNames = new Set<string>();
  let ancestor: EsTreeNode | null | undefined = handlerExpression;
  while (ancestor) {
    if (isFunctionLike(ancestor)) {
      for (const parameter of ancestor.params ?? []) {
        collectPatternNames(parameter, parameterNames);
      }
    }
    ancestor = ancestor.parent ?? null;
  }
  return parameterNames;
};

const containsNavigationEffect = (handlerExpression: EsTreeNode): boolean => {
  const enclosingParameterNames = collectEnclosingParameterNames(handlerExpression);
  let didFindNavigation = false;
  walkAst(handlerExpression, (child) => {
    if (didFindNavigation) return;
    if (isNodeOfType(child, "AssignmentExpression") && isLocationAssignmentTarget(child.left)) {
      didFindNavigation = true;
      return;
    }
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    if (isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")) {
      if (
        UNAMBIGUOUS_NAVIGATION_CALLEE_NAME_PATTERN.test(callee.property.name) ||
        (NAVIGATION_METHOD_NAME_PATTERN.test(callee.property.name) &&
          isNavigationReceiver(callee.object))
      ) {
        didFindNavigation = true;
      }
      return;
    }
    if (isNodeOfType(callee, "Identifier")) {
      if (
        NAVIGATION_FUNCTION_NAME_PATTERN.test(callee.name) ||
        enclosingParameterNames.has(callee.name)
      ) {
        didFindNavigation = true;
      }
    }
  });
  return didFindNavigation;
};

// Skip links and smooth-scroll TOC anchors: a fragment href
// (`#section-id`) plus a scroll/focus call in the handler is in-page
// navigation replaced by an equivalent behavior — and the href still
// works without JS. A bare `href="#"` targets nothing, so it doesn't
// qualify.
const isFragmentHref = (hrefAttribute: EsTreeNodeOfType<"JSXAttribute">): boolean => {
  const value = hrefAttribute.value;
  if (!value) return false;
  if (isNodeOfType(value, "Literal")) {
    return typeof value.value === "string" && value.value.startsWith("#") && value.value.length > 1;
  }
  if (
    isNodeOfType(value, "JSXExpressionContainer") &&
    value.expression &&
    isNodeOfType(value.expression, "TemplateLiteral")
  ) {
    const firstQuasi = value.expression.quasis?.[0];
    return Boolean(firstQuasi?.value?.raw?.startsWith("#"));
  }
  return false;
};

const SCROLL_OR_FOCUS_CALLEE_NAME_PATTERN = /^(?:scroll|focus$)/i;

const containsScrollOrFocusCall = (handlerExpression: EsTreeNode): boolean => {
  let didFindScrollOrFocus = false;
  walkAst(handlerExpression, (child) => {
    if (didFindScrollOrFocus) return;
    if (!isNodeOfType(child, "CallExpression")) return;
    const callee = child.callee;
    const calleeName = isNodeOfType(callee, "Identifier")
      ? callee.name
      : isNodeOfType(callee, "MemberExpression") && isNodeOfType(callee.property, "Identifier")
        ? callee.property.name
        : null;
    if (calleeName !== null && SCROLL_OR_FOCUS_CALLEE_NAME_PATTERN.test(calleeName)) {
      didFindScrollOrFocus = true;
    }
  });
  return didFindScrollOrFocus;
};

// A controlled form — a native <input>/<textarea>/<select> with both
// `value` and `onChange` inside the same <form> — keeps every field in
// React state; that is react.dev's own documented client-form pattern,
// and rewriting it as `<form action={serverAction}>` means abandoning
// controlled inputs entirely, not just moving the handler. When the
// inline onSubmit is additionally SYNCHRONOUS (no async/await/.then),
// there is no network mutation in the handler to move into a server
// action — the submit only forwards client state — so the advice
// cannot apply. Async submit handlers on controlled forms (a real
// mutation awaited inline) keep firing.
// Controlled means "carries both value and onChange" — the attribute
// pair defines the pattern whether the field is a native <input> or a
// design-system wrapper (<Input>, <TextField>). Form-library fields
// (TanStack's <form.AppField name=...>) carry neither, so library-driven
// forms are NOT exempted by this check.
const containsControlledInput = (formOpeningElement: EsTreeNode): boolean => {
  const formElement = formOpeningElement.parent;
  if (!formElement || !isNodeOfType(formElement, "JSXElement")) return false;
  let didFindControlledInput = false;
  walkAst(formElement, (child) => {
    if (didFindControlledInput) return;
    if (!isNodeOfType(child, "JSXOpeningElement")) return;
    if ((child as unknown) === (formOpeningElement as unknown)) return;
    const attributes = child.attributes ?? [];
    if (findJsxAttribute(attributes, "value") && findJsxAttribute(attributes, "onChange")) {
      didFindControlledInput = true;
    }
  });
  return didFindControlledInput;
};

const containsAsynchronousWork = (handlerExpression: EsTreeNode): boolean => {
  if (isFunctionLike(handlerExpression) && handlerExpression.async === true) return true;
  let didFindAsynchronousWork = false;
  walkAst(handlerExpression, (child) => {
    if (didFindAsynchronousWork) return;
    if (isNodeOfType(child, "AwaitExpression")) {
      didFindAsynchronousWork = true;
      return;
    }
    if (
      isNodeOfType(child, "CallExpression") &&
      isNodeOfType(child.callee, "MemberExpression") &&
      isNodeOfType(child.callee.property, "Identifier") &&
      child.callee.property.name === "then"
    ) {
      didFindAsynchronousWork = true;
    }
  });
  return didFindAsynchronousWork;
};

// An `<a role="button">` declares itself an anchor-as-button: the
// preventDefault is part of emulating button semantics (with keyboard
// handling), so "your users click this <a> & nothing navigates" is the
// intended behavior, not a dead link. Semantics belong to the a11y
// rules (prefer-tag-over-role), not this one.
const hasLiteralRoleButton = (node: EsTreeNodeOfType<"JSXOpeningElement">): boolean => {
  const roleAttribute = findJsxAttribute(node.attributes ?? [], "role");
  if (!roleAttribute?.value) return false;
  return isNodeOfType(roleAttribute.value, "Literal") && roleAttribute.value.value === "button";
};

export const noPreventDefault = defineRule({
  id: "no-prevent-default",
  title: "preventDefault on a form or link",
  severity: "warn",
  tags: ["test-noise"],
  recommendation:
    "Use `<form action>` where your framework supports it (it works without JS), or use a `<button>` instead of an `<a>` with preventDefault.",
  create: (context: RuleContext) => {
    const framework = getReactDoctorStringSetting(context.settings, "framework");
    const isClientOnlyFramework = hasCapability(context.settings, "client-only");
    const isServerActionsFramework = hasCapability(context.settings, "server-actions");
    const formMessage = isServerActionsFramework
      ? FORM_MESSAGE_SERVER_CAPABLE
      : FORM_MESSAGE_GENERIC;
    return {
      JSXOpeningElement(node: EsTreeNodeOfType<"JSXOpeningElement">) {
        const elementName = isNodeOfType(node.name, "JSXIdentifier") ? node.name.name : null;
        if (!elementName) return;

        const targetEventProps = PREVENT_DEFAULT_ELEMENTS.get(elementName);
        if (!targetEventProps) return;

        if (elementName === "form") {
          if (isClientOnlyFramework) return;
          if (framework === undefined || framework === "unknown") return;
          // Next.js classification can't tell App Router from Pages
          // Router, and server actions only exist in the App Router. An
          // inline onSubmit handler only runs in a client module, so a
          // file that doesn't declare `"use client"` itself is either
          // Pages Router (no server actions) or transitively
          // client-rendered — either way the advice is unconfirmed.
          if (framework === "nextjs" && isServerActionsFramework) {
            const programRoot = findProgramRoot(node);
            if (!programRoot || !hasDirective(programRoot, "use client")) return;
          }
        }

        // An `<a>` without href never navigates on click (anchor-as-button,
        // e.g. an ant-design Dropdown trigger), so "nothing navigates
        // because onClick calls preventDefault()" would be false — the
        // preventDefault() is defensive, not a dead link. A spread
        // (`{...props}`) can forward a real href at runtime, so the
        // href-less bailout only applies when absence is provable.
        if (
          elementName === "a" &&
          !findJsxAttribute(node.attributes ?? [], "href") &&
          !hasJsxSpreadAttribute(node.attributes ?? [])
        )
          return;

        // A `<form action=…>` already has a native no-JS submit path: with
        // JS off the onSubmit handler never runs, so preventDefault() never
        // fires and the browser performs the native action. The "won't work
        // without JS" advice is false here — only flag action-less forms.
        if (elementName === "form" && findJsxAttribute(node.attributes ?? [], "action")) return;

        if (elementName === "a" && hasLiteralRoleButton(node)) return;

        for (const targetEventProp of targetEventProps) {
          const eventAttribute = findJsxAttribute(node.attributes ?? [], targetEventProp);
          if (
            !eventAttribute?.value ||
            !isNodeOfType(eventAttribute.value, "JSXExpressionContainer")
          )
            continue;

          const expression = eventAttribute.value.expression;
          if (!isInlineFunctionExpression(expression)) continue;

          const preventDefaultCalls = collectPreventDefaultCalls(expression);
          if (preventDefaultCalls.length === 0) continue;

          if (
            elementName === "form" &&
            !containsAsynchronousWork(expression) &&
            containsControlledInput(node)
          ) {
            continue;
          }

          if (elementName === "a") {
            // Every preventDefault() sits behind a condition — a
            // disabled-link guard, not a dead link: the enabled branch
            // navigates normally.
            if (
              preventDefaultCalls.every((preventDefaultCall) =>
                isCallInsideConditional(preventDefaultCall, expression),
              )
            )
              continue;

            // An anchor whose handler performs its own navigation after
            // preventDefault() (router push, `platform.openLink(href)`,
            // a `location.href` assignment) is custom SPA / desktop
            // navigation, not a dead link.
            if (containsNavigationEffect(expression)) continue;

            const hrefAttribute = findJsxAttribute(node.attributes ?? [], "href");
            if (
              hrefAttribute &&
              isFragmentHref(hrefAttribute) &&
              containsScrollOrFocusCall(expression)
            )
              continue;
          }

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
