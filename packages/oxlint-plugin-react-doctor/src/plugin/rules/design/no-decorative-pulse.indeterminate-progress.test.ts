import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDecorativePulse } from "./no-decorative-pulse.js";

const progressCases = [
  {
    name: "native-omitted",
    source:
      '<progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "native-null",
    source:
      '<progress value={null} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "html-section",
    source:
      '<section><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 0,
  },
  {
    name: "fragment",
    source:
      '<><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></>',
    expectedCount: 0,
  },
  {
    name: "html-fragment-nested",
    source:
      '<main><><div><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></div></></main>',
    expectedCount: 0,
  },
  {
    name: "expression-literal-label",
    source:
      '<progress value={null} aria-label={"Snapshot export"} className="animate-pulse">Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "determinate",
    source:
      '<progress value={0.3} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "completed",
    source:
      '<progress value={1} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "dynamic",
    source:
      '<progress value={amount} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "undefined",
    source:
      '<progress value={undefined} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "void",
    source:
      '<progress value={void 0} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "conditional-null",
    source:
      '<progress value={active ? null : 1} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "string-null",
    source:
      '<progress value="null" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "boolean-false",
    source:
      '<progress value={false} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "bare-value",
    source:
      '<progress value aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "asserted-null",
    source:
      '<progress value={null as null} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "uppercase-value-number",
    source:
      '<progress VALUE={1} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixedcase-value-number",
    source:
      '<progress VaLuE={1} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "uppercase-value-null",
    source:
      '<progress VALUE={null} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixed-duplicate-number-null",
    source:
      '<progress VALUE={1} value={null} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixed-duplicate-null-number",
    source:
      '<progress value={null} VALUE={1} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "duplicate-null-number",
    source:
      '<progress value={null} value={1} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "duplicate-number-null",
    source:
      '<progress value={1} value={null} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "duplicate-null-null",
    source:
      '<progress value={null} value={null} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "missing-label",
    source: '<progress  className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "empty-label",
    source: '<progress aria-label="" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "space-label",
    source: '<progress aria-label="   " className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "dynamic-label",
    source: '<progress aria-label={caption} className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "template-label",
    source:
      '<progress aria-label={`Snapshot export`} className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "uppercase-label",
    source:
      '<progress ARIA-LABEL="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixed-duplicate-label",
    source:
      '<progress aria-label="Snapshot export" ARIA-LABEL="" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "duplicate-label",
    source:
      '<progress aria-label="Snapshot export" aria-label="Other" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "external-label",
    source:
      '<progress aria-labelledby="external-caption" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "hidden",
    source:
      '<progress hidden aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "hidden-false",
    source:
      '<progress hidden={false} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "uppercase-hidden",
    source:
      '<progress HIDDEN aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "aria-hidden",
    source:
      '<progress aria-hidden="true" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixed-aria-hidden",
    source:
      '<progress ARIA-HIDDEN="true" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "aria-hidden-false",
    source:
      '<progress aria-hidden={false} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "inert",
    source:
      '<progress inert aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "inert-false",
    source:
      '<progress inert={false} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixed-inert",
    source:
      '<progress InErT aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "customized-built-in",
    source:
      '<progress is="enhanced-progress" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "uppercase-is",
    source:
      '<progress IS="enhanced-progress" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "namespace",
    source:
      '<progress xmlns="urn:example" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixed-namespace",
    source:
      '<progress XMLNS="urn:example" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "namespace-camel",
    source:
      '<progress xmlnsXlink="urn:example" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "namespaced-attribute",
    source:
      '<progress xml:lang="en" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "role-presentation",
    source:
      '<progress role="presentation" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "role-unknown",
    source:
      '<progress role={indicatorRole} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "mixedcase-role",
    source:
      '<progress ROLE="presentation" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "ancestor-svg",
    source:
      '<svg><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></svg>',
    expectedCount: 1,
  },
  {
    name: "ancestor-svg-group",
    source:
      '<svg><g><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></g></svg>',
    expectedCount: 1,
  },
  {
    name: "ancestor-math",
    source:
      '<math><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></math>',
    expectedCount: 1,
  },
  {
    name: "ancestor-foreign-object",
    source:
      '<svg><foreignObject><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></foreignObject></svg>',
    expectedCount: 1,
  },
  {
    name: "ancestor-component",
    source:
      '<Wrapper><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></Wrapper>',
    expectedCount: 1,
  },
  {
    name: "ancestor-member-component",
    source:
      '<Layout.Body><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></Layout.Body>',
    expectedCount: 1,
  },
  {
    name: "ancestor-custom-element",
    source:
      '<progress-shell><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></progress-shell>',
    expectedCount: 1,
  },
  {
    name: "ancestor-unknown-lowercase",
    source:
      '<unregistered><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></unregistered>',
    expectedCount: 1,
  },
  {
    name: "ancestor-namespaced-ancestor",
    source:
      '<view:body><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></view:body>',
    expectedCount: 1,
  },
  {
    name: "ancestor-hidden",
    source:
      '<section hidden><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-mixedcase-hidden",
    source:
      '<section HiDdEn><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-aria-hidden",
    source:
      '<section aria-hidden="true"><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-inert",
    source:
      '<section inert><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-role",
    source:
      '<section role="group"><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-spread",
    source:
      '<section {...containerProps}><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-empty-spread",
    source:
      '<section {...{}}><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-xmlns",
    source:
      '<section xmlns="urn:example"><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-namespaced-attribute",
    source:
      '<section xml:lang="en"><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-customized",
    source:
      '<section is="enhanced-section"><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "ancestor-duplicatecase",
    source:
      '<section id="primary" ID="secondary"><progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress></section>',
    expectedCount: 1,
  },
  {
    name: "own-spread-before-class",
    source:
      '<progress {...indicatorProps} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "own-spread-after-class",
    source:
      '<progress aria-label="Snapshot export" className="animate-pulse" {...indicatorProps}>Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "own-empty-spread",
    source:
      '<progress {...{}} aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 1,
  },
  {
    name: "direct-role-progress",
    source:
      '<div role="progressbar" aria-label="Snapshot export" className="animate-pulse">Snapshot export</div>',
    expectedCount: 0,
  },
  {
    name: "native-direct-role-progress",
    source:
      '<progress role="progressbar" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "role-duplicate-bypass",
    source:
      '<div role="progressbar" role="presentation" className="animate-pulse">Annual feature</div>',
    expectedCount: 0,
  },
  {
    name: "role-spread-bypass",
    source:
      '<div role="progressbar" {...{role: "presentation"}} className="animate-pulse">Annual feature</div>',
    expectedCount: 0,
  },
  {
    name: "role-mixedcase-duplicate-bypass",
    source:
      '<div role="progressbar" ROLE="presentation" className="animate-pulse">Annual feature</div>',
    expectedCount: 0,
  },
  {
    name: "aria-busy-bypass",
    source:
      '<progress value={1} aria-busy="true" aria-label="Snapshot export" className="animate-pulse">Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "custom-progress",
    source:
      '<Progress aria-label="Snapshot export" className="animate-pulse">Snapshot export</Progress>',
    expectedCount: 1,
  },
  {
    name: "plain-decoration",
    source: '<div className="animate-pulse">Annual feature</div>',
    expectedCount: 1,
  },
  {
    name: "no-pulse",
    source: '<progress aria-label="Snapshot export">Snapshot export</progress>',
    expectedCount: 0,
  },
  {
    name: "empty-fallback",
    source: '<progress aria-label="Snapshot export" className="animate-pulse" />',
    expectedCount: 0,
  },
];

describe("no-decorative-pulse indeterminate progress", () => {
  it.each(progressCases)("$name", ({ source, expectedCount }) => {
    const code = `const Indicator = () => (${source});`;
    const result = runRule(noDecorativePulse, code, { includeLocations: true });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expectedCount);
    if (expectedCount === 0) return;
    const openingTag = source.match(
      /<(?:progress|Progress|div)\b[^>]*className="animate-pulse"[^>]*>/,
    )?.[0];
    expect(openingTag).toBeDefined();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        line: 1,
        column: code.indexOf(openingTag ?? ""),
        nodeType: "JSXOpeningElement",
        message:
          "This stable copy pulses continuously for attention. Remove the loop and use static hierarchy unless the element represents work in progress.",
      }),
    ]);
  });
});
