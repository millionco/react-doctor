import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { htmlNoNestedForm } from "./html-no-nested-form.js";

describe("html-no-nested-form", () => {
  it("reports a direct nested form", () => {
    const result = runRule(
      htmlNoNestedForm,
      `const Checkout = () => <form><input name="email" /><form><button>Apply</button></form></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports a deeply nested form", () => {
    const result = runRule(
      htmlNoNestedForm,
      `const Checkout = () => <form><section><div><form /></div></section></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports intrinsic aliases", () => {
    const result = runRule(
      htmlNoNestedForm,
      `const FormTag = "form"; const Checkout = () => <FormTag><FormTag /></FormTag>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows sibling forms", () => {
    const result = runRule(
      htmlNoNestedForm,
      `const Page = () => <><form action="/search" /><form action="/subscribe" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows unresolved custom form components", () => {
    const result = runRule(htmlNoNestedForm, `const Page = () => <Form><form /></Form>;`);
    expect(result.diagnostics).toHaveLength(0);
  });
});
