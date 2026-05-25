// GENERATED FILE — do not edit by hand. Run `pnpm gen` to regenerate.

import { altText } from "./../rules/a11y/alt-text.js";
import { anchorAmbiguousText } from "./../rules/a11y/anchor-ambiguous-text.js";
import { anchorHasContent } from "./../rules/a11y/anchor-has-content.js";
import { anchorIsValid } from "./../rules/a11y/anchor-is-valid.js";
import { ariaActivedescendantHasTabindex } from "./../rules/a11y/aria-activedescendant-has-tabindex.js";
import { ariaProps } from "./../rules/a11y/aria-props.js";
import { ariaProptypes } from "./../rules/a11y/aria-proptypes.js";
import { ariaRole } from "./../rules/a11y/aria-role.js";
import { ariaUnsupportedElements } from "./../rules/a11y/aria-unsupported-elements.js";
import { autocompleteValid } from "./../rules/a11y/autocomplete-valid.js";
import { clickEventsHaveKeyEvents } from "./../rules/a11y/click-events-have-key-events.js";
import { controlHasAssociatedLabel } from "./../rules/a11y/control-has-associated-label.js";
import { headingHasContent } from "./../rules/a11y/heading-has-content.js";
import { htmlHasLang } from "./../rules/a11y/html-has-lang.js";
import { iframeHasTitle } from "./../rules/a11y/iframe-has-title.js";
import { imgRedundantAlt } from "./../rules/a11y/img-redundant-alt.js";
import { interactiveSupportsFocus } from "./../rules/a11y/interactive-supports-focus.js";
import { labelHasAssociatedControl } from "./../rules/a11y/label-has-associated-control.js";
import { lang } from "./../rules/a11y/lang.js";
import { mediaHasCaption } from "./../rules/a11y/media-has-caption.js";
import { mouseEventsHaveKeyEvents } from "./../rules/a11y/mouse-events-have-key-events.js";
import { noAccessKey } from "./../rules/a11y/no-access-key.js";
import { noAriaHiddenOnFocusable } from "./../rules/a11y/no-aria-hidden-on-focusable.js";
import { noAutofocus } from "./../rules/a11y/no-autofocus.js";
import { noDistractingElements } from "./../rules/a11y/no-distracting-elements.js";
import { noInteractiveElementToNoninteractiveRole } from "./../rules/a11y/no-interactive-element-to-noninteractive-role.js";
import { noNoninteractiveElementInteractions } from "./../rules/a11y/no-noninteractive-element-interactions.js";
import { noNoninteractiveElementToInteractiveRole } from "./../rules/a11y/no-noninteractive-element-to-interactive-role.js";
import { noNoninteractiveTabindex } from "./../rules/a11y/no-noninteractive-tabindex.js";
import { noRedundantRoles } from "./../rules/a11y/no-redundant-roles.js";
import { noStaticElementInteractions } from "./../rules/a11y/no-static-element-interactions.js";
import { preferTagOverRole } from "./../rules/a11y/prefer-tag-over-role.js";
import { roleHasRequiredAriaProps } from "./../rules/a11y/role-has-required-aria-props.js";
import { roleSupportsAriaProps } from "./../rules/a11y/role-supports-aria-props.js";
import { scope } from "./../rules/a11y/scope.js";
import { tabindexNoPositive } from "./../rules/a11y/tabindex-no-positive.js";

export const A11yRuleEntries = [
  {
    key: "react-doctor/alt-text",
    id: "alt-text",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...altText,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/anchor-ambiguous-text",
    id: "anchor-ambiguous-text",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...anchorAmbiguousText,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/anchor-has-content",
    id: "anchor-has-content",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...anchorHasContent,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/anchor-is-valid",
    id: "anchor-is-valid",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...anchorIsValid,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-activedescendant-has-tabindex",
    id: "aria-activedescendant-has-tabindex",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...ariaActivedescendantHasTabindex,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-props",
    id: "aria-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaProps,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-proptypes",
    id: "aria-proptypes",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaProptypes,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-role",
    id: "aria-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/aria-unsupported-elements",
    id: "aria-unsupported-elements",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...ariaUnsupportedElements,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/autocomplete-valid",
    id: "autocomplete-valid",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...autocompleteValid,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/click-events-have-key-events",
    id: "click-events-have-key-events",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...clickEventsHaveKeyEvents,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/control-has-associated-label",
    id: "control-has-associated-label",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...controlHasAssociatedLabel,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/heading-has-content",
    id: "heading-has-content",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...headingHasContent,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/html-has-lang",
    id: "html-has-lang",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...htmlHasLang,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/iframe-has-title",
    id: "iframe-has-title",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...iframeHasTitle,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/img-redundant-alt",
    id: "img-redundant-alt",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...imgRedundantAlt,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/interactive-supports-focus",
    id: "interactive-supports-focus",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...interactiveSupportsFocus,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/label-has-associated-control",
    id: "label-has-associated-control",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...labelHasAssociatedControl,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/lang",
    id: "lang",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...lang,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/media-has-caption",
    id: "media-has-caption",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...mediaHasCaption,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/mouse-events-have-key-events",
    id: "mouse-events-have-key-events",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...mouseEventsHaveKeyEvents,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-access-key",
    id: "no-access-key",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noAccessKey,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-aria-hidden-on-focusable",
    id: "no-aria-hidden-on-focusable",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noAriaHiddenOnFocusable,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-autofocus",
    id: "no-autofocus",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noAutofocus,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-distracting-elements",
    id: "no-distracting-elements",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...noDistractingElements,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-interactive-element-to-noninteractive-role",
    id: "no-interactive-element-to-noninteractive-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noInteractiveElementToNoninteractiveRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-noninteractive-element-interactions",
    id: "no-noninteractive-element-interactions",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noNoninteractiveElementInteractions,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-noninteractive-element-to-interactive-role",
    id: "no-noninteractive-element-to-interactive-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noNoninteractiveElementToInteractiveRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-noninteractive-tabindex",
    id: "no-noninteractive-tabindex",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noNoninteractiveTabindex,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-redundant-roles",
    id: "no-redundant-roles",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noRedundantRoles,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/no-static-element-interactions",
    id: "no-static-element-interactions",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...noStaticElementInteractions,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/prefer-tag-over-role",
    id: "prefer-tag-over-role",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...preferTagOverRole,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/role-has-required-aria-props",
    id: "role-has-required-aria-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "error",
    rule: {
      ...roleHasRequiredAriaProps,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/role-supports-aria-props",
    id: "role-supports-aria-props",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...roleSupportsAriaProps,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/scope",
    id: "scope",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...scope,
      framework: "global",
      category: "Accessibility",
    },
  },
  {
    key: "react-doctor/tabindex-no-positive",
    id: "tabindex-no-positive",
    source: "react-doctor",
    originallyExternal: true,
    framework: "global",
    category: "Accessibility",
    severity: "warn",
    rule: {
      ...tabindexNoPositive,
      framework: "global",
      category: "Accessibility",
    },
  },
] as const;
