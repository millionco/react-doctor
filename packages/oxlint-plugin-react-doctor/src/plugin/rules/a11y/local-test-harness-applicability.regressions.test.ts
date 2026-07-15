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
    "$id stays silent for an inline dummy prop beneath an imported provider",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `import { ProductComponent } from "../product-component";
        import { ProductProvider } from "../product-provider";
        test("forwards the fixture", () => {
          render(<ProductProvider><ProductComponent fixture={${invalidElement}} /></ProductProvider>);
        });`,
        { filename: "/repo/src/__tests__/product-component.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id still reports direct JSX beneath an imported provider",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `import { ProductProvider } from "../product-provider";
        test("renders the subject", () => {
          render(<ProductProvider>${invalidElement}</ProductProvider>);
        });`,
        { filename: "/repo/src/__tests__/product-component.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id still reports direct JSX passed through an imported provider's children prop",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `import { ProductProvider } from "../product-provider";
        test("renders the subject", () => {
          render(<ProductProvider children={${invalidElement}} />);
        });`,
        { filename: "/repo/src/__tests__/product-component.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(ACCESSIBILITY_APPLICABILITY_CASES)(
    "$id still reports direct JSX passed through an imported component's children prop",
    ({ rule, invalidElement }) => {
      const result = runRule(
        rule,
        `import { ProductComponent } from "../product-component";
        test("renders the subject", () => {
          render(<ProductComponent children={${invalidElement}} />);
        });`,
        { filename: "/repo/src/__tests__/product-component.test.tsx" },
      );

      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
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

  it("stays silent for an aliased Vitest mock factory", () => {
    const result = runRule(
      altText,
      `import { vi as testRuntime } from "vitest";
      testRuntime.mock("image", (() => ({ default: () => <img src="/fixture.png" /> })) as () => object);`,
      { filename: "/repo/src/image.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for a Jest mock factory with a computed method", () => {
    const result = runRule(
      altText,
      `jest["mock"]("image", () => ({ default: () => <img src="/fixture.png" /> }));`,
      { filename: "/repo/src/image.spec.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an inline fixture in an aliased imported test callback", () => {
    const result = runRule(
      altText,
      `import { test as verify } from "vitest";
      import { ProductComponent as Subject } from "../product-component";
      verify.only("forwards media", () => {
        render(<Subject media={<img src="/fixture.png" />} />);
      });`,
      { filename: "/repo/src/fixture.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an inline fixture in a table-driven test callback", () => {
    const result = runRule(
      altText,
      `import { test as verify } from "vitest";
      import { ProductComponent } from "../product-component";
      verify.each([["portrait"], ["landscape"]])("forwards %s media", () => {
        render(<ProductComponent media={<img src="/fixture.png" />} />);
      });`,
      { filename: "/repo/src/fixture.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an inline fixture in a modified table-driven test callback", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      test.only.each([["portrait"]])("forwards %s media", () => {
        render(<ProductComponent media={<img src="/fixture.png" />} />);
      });`,
      { filename: "/repo/src/product-component.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for an inline fixture in a tagged table-driven test callback", () => {
    const result = runRule(
      altText,
      `import { test as verify } from "vitest";
      import { ProductComponent } from "../product-component";
      verify.each\`
        layout
        portrait
      \`("forwards $layout media", () => {
        render(<ProductComponent media={<img src="/fixture.png" />} />);
      });`,
      { filename: "/repo/src/fixture.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still reports an imported component's own mapped accessibility violation", () => {
    const result = runRule(
      interactiveSupportsFocus,
      `import { ProductComponent } from "../product-component";
      test("renders the subject", () => {
        render(<ProductComponent role="button" onClick={onActivate} />);
      });`,
      {
        filename: "/repo/src/product-component.test.tsx",
        settings: { "jsx-a11y": { components: { ProductComponent: "div" } } },
      },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a table callback reached through a shadowed userland function", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      const test = { each: () => (_name, callback) => callback() };
      test.each([["portrait"]])("forwards media", () => {
        render(<ProductComponent media={<img src="/subject.png" />} />);
      });`,
      { filename: "/repo/src/product-component.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a tagged table callback reached through a shadowed userland function", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      const test = { each: () => (_name, callback) => callback() };
      test.each\`
        layout
        portrait
      \`("forwards media", () => {
        render(<ProductComponent media={<img src="/subject.png" />} />);
      });`,
      { filename: "/repo/src/product-component.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when vi is a shadowed userland object", () => {
    const result = runRule(
      altText,
      `const vi = { mock: (_name, factory) => factory() };
      vi.mock("image", () => ({ default: () => <img src="/subject.png" /> }));`,
      { filename: "/repo/src/image.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a mock factory reached through an imported userland object", () => {
    const result = runRule(
      altText,
      `import { vi } from "./test-runtime";
      vi.mock("image", () => ({ default: () => <img src="/subject.png" /> }));`,
      { filename: "/repo/src/image.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a mock factory with a dynamic module specifier", () => {
    const result = runRule(
      altText,
      `const moduleName = "image";
      vi.mock(moduleName, () => ({ default: () => <img src="/subject.png" /> }));`,
      { filename: "/repo/src/image.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports when test is a shadowed userland function", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      const test = (_name, callback) => callback();
      test("renders product", () => {
        render(<ProductComponent media={<img src="/subject.png" />} />);
      });`,
      { filename: "/repo/src/product-component.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports direct component-under-test JSX inside a test callback", () => {
    const result = runRule(
      altText,
      `test("renders the subject", () => {
        render(<img src="/subject.png" />);
        expect(screen.getByRole("img")).toBeVisible();
      });`,
      { filename: "/repo/src/subject.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports direct fixture JSX nested under React Fragment", () => {
    const result = runRule(
      altText,
      `import { Fragment } from "react";
      test("renders the subject", () => {
        render(<Fragment><img src="/subject.png" /></Fragment>);
      });`,
      { filename: "/repo/src/subject.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports fixture JSX nested under a test-library import", () => {
    const result = runRule(
      altText,
      `import { RenderHarness } from "@testing-library/react";
      test("renders the subject", () => {
        render(<RenderHarness fixture={<img src="/subject.png" />} />);
      });`,
      { filename: "/repo/src/subject.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a local wrapper component under test", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      const Subject = () => <ProductComponent media={<img src="/subject.png" />} />;
      test("renders the subject", () => {
        render(<Subject />);
        expect(screen.getByRole("img")).toBeVisible();
      });`,
      { filename: "/repo/src/subject.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports an exported component declared in a test file", () => {
    const result = runRule(altText, `export const Subject = () => <img src="/subject.png" />;`, {
      filename: "/repo/src/subject.test.tsx",
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports a deferred JSX callback passed to an imported component", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      test("renders product", () => {
        render(<ProductComponent renderMedia={() => <img src="/subject.png" />} />);
      });`,
      { filename: "/repo/src/product-component.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still reports an inline fixture passed to a shadowed imported component", () => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      test("renders product", () => {
        const ProductComponent = ({ media }) => media;
        render(<ProductComponent media={<img src="/subject.png" />} />);
      });`,
      { filename: "/repo/src/product-component.test.tsx" },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "/repo/src/product-component.stories.tsx",
    "/repo/src/demo/product-component.tsx",
    "/repo/src/examples/product-component.tsx",
  ])("still reports a visual surface at %s", (filename) => {
    const result = runRule(
      altText,
      `import { ProductComponent } from "../product-component";
      export const Example = () => <ProductComponent media={<img src="/subject.png" />} />;`,
      { filename },
    );

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
