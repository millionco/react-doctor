import { describe, expect, it } from "vite-plus/test";
import { noDynamicTailwindClassFragment } from "./no-dynamic-tailwind-class-fragment.js";
import { noEmojiHeadingDecoration } from "./no-emoji-heading-decoration.js";
import { noGenericPurpleBlueIconGradient } from "./no-generic-purple-blue-icon-gradient.js";
import { noInertPointerAffordance } from "./no-inert-pointer-affordance.js";
import { noInvisibleFocusControl } from "./no-invisible-focus-control.js";
import { noRepeatedPlaceholderNavigation } from "./no-repeated-placeholder-navigation.js";
import { noTinyUppercaseTrackedLabel } from "./no-tiny-uppercase-tracked-label.js";

const REACT_JSX_RULES = [
  noDynamicTailwindClassFragment,
  noEmojiHeadingDecoration,
  noGenericPurpleBlueIconGradient,
  noInertPointerAffordance,
  noInvisibleFocusControl,
  noRepeatedPlaceholderNavigation,
  noTinyUppercaseTrackedLabel,
];

const TAILWIND_RULES = [
  noDynamicTailwindClassFragment,
  noGenericPurpleBlueIconGradient,
  noInertPointerAffordance,
  noInvisibleFocusControl,
  noTinyUppercaseTrackedLabel,
];

describe("design capability gates", () => {
  it("gates JSX-specific rules behind React", () => {
    for (const rule of REACT_JSX_RULES) {
      expect(rule.tags).toContain("react-jsx-only");
    }
  });

  it("gates Tailwind utility rules behind Tailwind", () => {
    for (const rule of TAILWIND_RULES) {
      expect(rule.requires).toContain("tailwind");
    }
  });
});
