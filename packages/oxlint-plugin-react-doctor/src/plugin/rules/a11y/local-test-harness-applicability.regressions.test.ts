import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { altText } from "./alt-text.js";
import { iframeHasTitle } from "./iframe-has-title.js";
import { interactiveSupportsFocus } from "./interactive-supports-focus.js";
import { mediaHasCaption } from "./media-has-caption.js";
import { mouseEventsHaveKeyEvents } from "./mouse-events-have-key-events.js";
import { noRedundantRoles } from "./no-redundant-roles.js";
import { roleHasRequiredAriaProps } from "./role-has-required-aria-props.js";
import { roleSupportsAriaProps } from "./role-supports-aria-props.js";

interface AccessibilityApplicabilityCase {
  id: string;
  rule: Rule;
  invalidElement: string;
}

const ACCESSIBILITY_APPLICABILITY_CASES: ReadonlyArray<AccessibilityApplicabilityCase> = [
  {
    id: "alt-text",
    rule: altText,
    invalidElement: '<img src="/fixture.png" />',
  },
  {
    id: "iframe-has-title",
    rule: iframeHasTitle,
    invalidElement: '<iframe src="about:blank" />',
  },
  {
    id: "interactive-supports-focus",
    rule: interactiveSupportsFocus,
    invalidElement: '<div role="button" onClick={onActivate} />',
  },
  {
    id: "media-has-caption",
    rule: mediaHasCaption,
    invalidElement: '<video src="/fixture.mp4" />',
  },
  {
    id: "mouse-events-have-key-events",
    rule: mouseEventsHaveKeyEvents,
    invalidElement: "<div onMouseOver={onHover} />",
  },
  {
    id: "no-redundant-roles",
    rule: noRedundantRoles,
    invalidElement: '<button role="button">Open</button>',
  },
  {
    id: "role-has-required-aria-props",
    rule: roleHasRequiredAriaProps,
    invalidElement: '<div role="checkbox" />',
  },
  {
    id: "role-supports-aria-props",
    rule: roleSupportsAriaProps,
    invalidElement: '<button aria-checked="true">Toggle</button>',
  },
];

describe("local unit-test harness accessibility applicability", () => {
  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id stays silent for an inline dummy passed to the product component",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `import { ProductComponent } from "../product-component";
        test("forwards the fixture", () => {
          render(<ProductComponent fixture={${invalidElement}} />);
        });`,
        { filename: "/repo/src/__tests__/product-component.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id stays silent for a dependency mock factory",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `vi.mock("dependency", () => ({
          default: () => ${invalidElement},
        }));`,
        { filename: "/repo/src/product-component.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id still reports byte-equivalent product markup",
    ({ rule, invalidElement }) => {
      const result = runRule(rule, `export const ProductComponent = () => ${invalidElement};`, {
        filename: "/repo/src/product-component.tsx",
      });

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id still reports a component-under-test declaration",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `const Subject = () => ${invalidElement};
        test("renders the subject", () => {
          render(<Subject />);
          expect(screen.getByTestId("subject")).toBeInTheDocument();
        });`,
        { filename: "/repo/src/subject.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
