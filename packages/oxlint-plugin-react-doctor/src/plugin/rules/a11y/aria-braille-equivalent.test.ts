import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { ariaBrailleEquivalent } from "./aria-braille-equivalent.js";

describe("aria-braille-equivalent", () => {
  it("reports braille-only labels and role descriptions", () => {
    const result = runRule(
      ariaBrailleEquivalent,
      `const View = () => <><button aria-braillelabel="sv"> </button><div aria-brailleroledescription="ctl" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts non-braille equivalents", () => {
    const result = runRule(
      ariaBrailleEquivalent,
      `const View = () => <><button aria-braillelabel="sv">Save</button><div aria-brailleroledescription="ctl" aria-roledescription="control" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamic accessible names", () => {
    const result = runRule(
      ariaBrailleEquivalent,
      `const View = ({ label, props }) => <button {...props} aria-braillelabel="sv" aria-label={label} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips spread-owned equivalents", () => {
    const result = runRule(
      ariaBrailleEquivalent,
      `const View = ({ props }) => <div aria-roledescription="control" {...props} aria-brailleroledescription="ctl" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
