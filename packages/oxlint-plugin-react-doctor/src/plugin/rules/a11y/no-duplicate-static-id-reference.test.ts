import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDuplicateStaticIdReference } from "./no-duplicate-static-id-reference.js";

describe("no-duplicate-static-id-reference", () => {
  it("reports duplicated IDs used by labels or ARIA", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const Form = () => <><label htmlFor="email">Email</label><input id="email" /><input id="email" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("ignores unreferenced duplicate IDs", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const View = () => <div><span id="item" /><span id="item" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not compare conditional branches or dynamic IDs", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const View = ({ active, id }) => <div aria-labelledby="item">{active ? <span id="item" /> : <span id="item" />}<span id={id} /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer DOM references from custom-component props", () => {
    const result = runRule(
      noDuplicateStaticIdReference,
      `const View = () => <><Custom aria-labelledby="item" /><span id="item" /><span id="item" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each(["\u00a0", "\ufeff", "\u3000"])(
    "keeps Unicode whitespace in distinct ID values (%j)",
    (unicodeWhitespace) => {
      for (const distinctId of [`${unicodeWhitespace}field`, `field${unicodeWhitespace}`]) {
        const result = runRule(
          noDuplicateStaticIdReference,
          `const View = () => <div aria-describedby="field"><span id="field" /><span id={${JSON.stringify(distinctId)}} /></div>;`,
        );
        expect(result.parseErrors).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(0);
      }
    },
  );

  it.each(["\u00a0", "\ufeff", "\u3000", "\u000b"])(
    "does not split ID references at non-ASCII whitespace (%j)",
    (unicodeWhitespace) => {
      const reference = `field${unicodeWhitespace}description`;
      const result = runRule(
        noDuplicateStaticIdReference,
        `const View = () => <div aria-describedby={${JSON.stringify(reference)}}><span id="field" /><span id="field" /></div>;`,
      );
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each(["\u00a0", "\ufeff", "\u3000"])(
    "reports references to duplicate IDs containing Unicode whitespace (%j)",
    (unicodeWhitespace) => {
      for (const referencedId of [
        `${unicodeWhitespace}field`,
        `field${unicodeWhitespace}`,
        `field${unicodeWhitespace}description`,
      ]) {
        const literalId = JSON.stringify(referencedId);
        const result = runRule(
          noDuplicateStaticIdReference,
          `const View = () => <div aria-describedby={${literalId}}><span id={${literalId}} /><span id={${literalId}} /></div>;`,
        );
        expect(result.parseErrors).toHaveLength(0);
        expect(result.diagnostics).toHaveLength(1);
        expect(result.diagnostics[0]?.message).toContain(`"${referencedId}"`);
      }
    },
  );

  it.each([" ", "\t", "\n", "\r", "\f"])(
    "splits ID reference lists at ASCII whitespace (%j)",
    (asciiWhitespace) => {
      const reference = `${asciiWhitespace}other${asciiWhitespace}field${asciiWhitespace}`;
      const result = runRule(
        noDuplicateStaticIdReference,
        `const View = () => <div aria-describedby={${JSON.stringify(reference)}}><span id="field" /><span id="field" /></div>;`,
      );
      expect(result.parseErrors).toHaveLength(0);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
