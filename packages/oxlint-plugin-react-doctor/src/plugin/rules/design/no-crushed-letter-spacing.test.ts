import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noCrushedLetterSpacing } from "./no-crushed-letter-spacing.js";

describe("no-crushed-letter-spacing", () => {
  it("flags extreme negative em tracking", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = () => <h1 style={{ letterSpacing: "-0.12em" }}>Readable heading</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags extreme arbitrary Tailwind tracking", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = () => <h1 className="tracking-[-0.1em]">Readable heading</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag moderate negative tracking", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = () => <h1 style={{ letterSpacing: "-0.04em" }}>Readable heading</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag dynamic tracking or childless icons", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = ({ spacing }) => <><h1 style={{ letterSpacing: spacing }}>Heading</h1><Icon style={{ letterSpacing: "-0.2em" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses the last duplicate inline letter spacing", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = () => <><h1 style={{ letterSpacing: "-0.12em", letterSpacing: "0" }}>Readable heading</h1><h2 style={{ letterSpacing: "0", letterSpacing: "-0.12em" }}>Readable heading</h2></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not look through later unknown inline style overrides", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = ({ key, styles }) => <><h1 style={{ letterSpacing: "-0.12em", ...styles }}>Spread override</h1><h2 style={{ letterSpacing: "-0.12em", [key]: "normal" }}>Computed override</h2></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses an explicit inline style after unknown entries", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = ({ key, styles }) => <><h1 style={{ ...styles, letterSpacing: "-0.12em" }}>Spread first</h1><h2 style={{ [key]: "normal", letterSpacing: "-0.12em" }}>Computed first</h2></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("recognizes a static computed inline style key", () => {
    const result = runRule(
      noCrushedLetterSpacing,
      `const Example = () => <h1 style={{ ["letterSpacing"]: "-0.12em" }}>Static key</h1>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
});
