import { describe, expect, it } from "vite-plus/test";
import ts from "typescript";
import { runRule } from "../../test-utils/run-rule.js";
import { runScanRule } from "../../test-utils/run-scan-rule.js";
import { ruleRegistry } from "../rule-registry.js";
import { KNOWN_UNCOVERED } from "./known-uncovered.js";
import { livenessFixtures } from "./liveness-fixtures.js";
import type { LivenessFixture } from "./liveness-fixtures.js";
import type { Rule } from "../utils/rule.js";

const INTRINSIC_STRING_ALIAS_RULE_IDS: ReadonlyArray<string> = [
  "anchor-ambiguous-text",
  "anchor-has-content",
  "anchor-is-valid",
  "aria-activedescendant-has-tabindex",
  "aria-role",
  "aria-unsupported-elements",
  "autocomplete-valid",
  "button-has-type",
  "checked-requires-onchange-or-readonly",
  "click-events-have-key-events",
  "design-no-vague-button-label",
  "dialog-has-accessible-name",
  "forbid-dom-props",
  "forbid-elements",
  "heading-has-content",
  "html-has-lang",
  "html-no-invalid-paragraph-child",
  "html-no-invalid-table-nesting",
  "html-no-nested-interactive",
  "iframe-has-title",
  "iframe-missing-sandbox",
  "img-redundant-alt",
  "interactive-supports-focus",
  "jsx-no-script-url",
  "jsx-no-target-blank",
  "lang",
  "media-has-caption",
  "mouse-events-have-key-events",
  "nextjs-no-a-element",
  "nextjs-no-css-link",
  "nextjs-no-font-link",
  "nextjs-no-img-element",
  "nextjs-no-polyfill-script",
  "no-aria-hidden-on-focusable",
  "no-disabled-zoom",
  "no-distracting-elements",
  "no-img-lazy-with-high-fetchpriority",
  "no-indeterminate-attribute",
  "no-interactive-element-to-noninteractive-role",
  "no-noninteractive-element-interactions",
  "no-noninteractive-element-to-interactive-role",
  "no-noninteractive-tabindex",
  "no-prevent-default",
  "no-redundant-roles",
  "no-static-element-interactions",
  "no-string-false-on-boolean-attribute",
  "no-uncontrolled-input",
  "no-undeferred-third-party",
  "no-unknown-property",
  "preact-prefer-ondblclick",
  "preact-prefer-oninput",
  "prefer-html-dialog",
  "prefer-tag-over-role",
  "rendering-animate-svg-wrapper",
  "role-has-required-aria-props",
  "role-supports-aria-props",
  "scope",
  "style-prop-object",
  "tanstack-start-no-anchor-element",
  "void-dom-elements-no-children",
];

const transformFirstIntrinsicToConstantAlias = (code: string): string | null => {
  const sourceFile = ts.createSourceFile(
    "fixture.tsx",
    code,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let openingElement: ts.JsxOpeningLikeElement | undefined;
  const visit = (node: ts.Node): void => {
    if (openingElement) return;
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      /^[a-z]/.test(node.tagName.text)
    ) {
      openingElement = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!openingElement || !ts.isIdentifier(openingElement.tagName)) return null;

  const intrinsicName = openingElement.tagName.text;
  const replacements = [
    { start: openingElement.tagName.getStart(sourceFile), end: openingElement.tagName.getEnd() },
  ];
  if (ts.isJsxOpeningElement(openingElement) && ts.isJsxElement(openingElement.parent)) {
    replacements.push({
      start: openingElement.parent.closingElement.tagName.getStart(sourceFile),
      end: openingElement.parent.closingElement.tagName.getEnd(),
    });
  }

  let transformedCode = code;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    transformedCode = `${transformedCode.slice(0, replacement.start)}MetamorphicIntrinsic${transformedCode.slice(replacement.end)}`;
  }
  return `const MetamorphicIntrinsic = ${JSON.stringify(intrinsicName)} as const;\n${transformedCode}`;
};

const diagnosticIdentity = (rule: Rule, fixture: LivenessFixture): ReadonlyArray<string> => {
  const result = runRule(rule, fixture.code, {
    ...(fixture.filePath !== undefined ? { filename: fixture.filePath } : {}),
    ...(fixture.settings !== undefined ? { settings: fixture.settings } : {}),
    forceJsx: fixture.forceJsx ?? true,
  });
  expect(result.parseErrors).toEqual([]);
  return result.diagnostics
    .map((diagnostic) => `${diagnostic.message}\0${diagnostic.nodeType}`)
    .sort();
};

const countFindings = (rule: Rule, fixture: LivenessFixture): number => {
  if (typeof rule.scan === "function") {
    return runScanRule(rule, {
      relativePath: fixture.filePath ?? "src/fixture.tsx",
      content: fixture.code,
      isGeneratedBundle: fixture.isGeneratedBundle,
    }).length;
  }
  const result = runRule(rule, fixture.code, {
    ...(fixture.filePath !== undefined ? { filename: fixture.filePath } : {}),
    ...(fixture.settings !== undefined ? { settings: fixture.settings } : {}),
    ...(fixture.forceJsx !== undefined ? { forceJsx: fixture.forceJsx } : {}),
  });
  return result.diagnostics.length;
};

describe("rule liveness", () => {
  const registeredRuleIds = new Set(Object.keys(ruleRegistry));

  it("has no fixture for an unregistered rule id", () => {
    const staleFixtureIds = Object.keys(livenessFixtures).filter(
      (ruleId) => !registeredRuleIds.has(ruleId),
    );
    expect(staleFixtureIds).toEqual([]);
  });

  it("has no KNOWN_UNCOVERED entry for an unregistered rule id", () => {
    const staleUncoveredIds = Object.keys(KNOWN_UNCOVERED).filter(
      (ruleId) => !registeredRuleIds.has(ruleId),
    );
    expect(staleUncoveredIds).toEqual([]);
  });

  it("has no KNOWN_UNCOVERED entry for a rule that already has a fixture", () => {
    const redundantUncoveredIds = Object.keys(KNOWN_UNCOVERED).filter(
      (ruleId) => ruleId in livenessFixtures,
    );
    expect(redundantUncoveredIds).toEqual([]);
  });

  for (const ruleId of INTRINSIC_STRING_ALIAS_RULE_IDS) {
    it(`${ruleId} preserves diagnostics for an exact intrinsic string alias`, () => {
      const rule = ruleRegistry[ruleId];
      const fixture = livenessFixtures[ruleId];
      const transformedCode = transformFirstIntrinsicToConstantAlias(fixture.code);
      if (!transformedCode) throw new Error(`Expected an intrinsic JSX tag for ${ruleId}`);
      expect(diagnosticIdentity(rule, { ...fixture, code: transformedCode })).toEqual(
        diagnosticIdentity(rule, fixture),
      );
    });
  }

  for (const [ruleId, rule] of Object.entries(ruleRegistry)) {
    const fixture = livenessFixtures[ruleId];

    if (!fixture) {
      it(`${ruleId} without a fixture is explicitly allowlisted in KNOWN_UNCOVERED`, () => {
        expect(
          KNOWN_UNCOVERED[ruleId],
          `Rule "${ruleId}" has no positive-control fixture. Add one to ` +
            `liveness-fixtures.ts (a minimal snippet the rule MUST fire on), or — only if the ` +
            `rule genuinely cannot run in the in-memory harness — add it to KNOWN_UNCOVERED ` +
            `with a reason.`,
        ).toBeDefined();
      });
      continue;
    }

    it(`${ruleId} fires on its canonical bad example`, () => {
      expect(
        countFindings(rule, fixture),
        `Rule "${ruleId}" reported nothing on its liveness fixture — the rule is dead ` +
          `or the fixture no longer matches its detection logic.`,
      ).toBeGreaterThanOrEqual(1);
    });
  }
});
