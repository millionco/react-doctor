import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { formControlRequiresName } from "./form-control-requires-name.js";

describe("form-control-requires-name", () => {
  it("reports unnamed data controls inside a static form", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input /><select /><textarea /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows named controls and button-like inputs", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input name="email" /><select name="country" /><textarea name="bio" /><input type="submit" /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips inputs whose dynamic type could be button-like", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ inputType }) => <form><input type={inputType} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips controls outside forms, custom controls, and spreads", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ props }) => <><input /><form><Input /><input {...props} /></form></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
