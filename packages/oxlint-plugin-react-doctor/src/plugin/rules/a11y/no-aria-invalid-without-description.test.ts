import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAriaInvalidWithoutDescription } from "./no-aria-invalid-without-description.js";

describe("no-aria-invalid-without-description", () => {
  it("reports statically invalid native controls without an error reference", () => {
    const result = runRule(
      noAriaInvalidWithoutDescription,
      `const Form = () => <><input aria-invalid /><select aria-invalid="true" /><textarea aria-invalid={true} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows described invalid controls", () => {
    const result = runRule(
      noAriaInvalidWithoutDescription,
      `const Form = () => <><input aria-invalid aria-describedby="email-error" /><select aria-invalid aria-errormessage="country-error" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips valid, dynamic, spread-owned, and custom controls", () => {
    const result = runRule(
      noAriaInvalidWithoutDescription,
      `const Form = ({ invalid, props }) => <><input aria-invalid="false" /><input aria-invalid={invalid} /><input aria-invalid {...props} /><Input aria-invalid /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
