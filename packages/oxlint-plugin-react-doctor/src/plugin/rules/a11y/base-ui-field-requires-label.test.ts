import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { baseUiFieldRequiresLabel } from "./base-ui-field-requires-label.js";

describe("base-ui-field-requires-label", () => {
  it("reports a field whose control has no label", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field } from "@base-ui/react/field";
       const View = () => (
         <Field.Root name="email">
           <Field.Control type="email" />
           <Field.Error />
         </Field.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("Field.Label");
  });

  it("reports the pre-1.0 package name and renamed namespaces", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field as BaseField } from "@base-ui-components/react/field";
       const View = () => (
         <BaseField.Root><div><BaseField.Control /></div></BaseField.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts Field.Label anywhere in the field", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field } from "@base-ui/react/field";
       const View = () => (
         <>
           <Field.Root>
             <Field.Label>Email</Field.Label>
             <Field.Control type="email" />
           </Field.Root>
           <Field.Root>
             <Field.Control type="checkbox" />
             <Field.Label>Accept terms</Field.Label>
           </Field.Root>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts aria naming on the control, in a render prop, or via intrinsic labels", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field } from "@base-ui/react/field";
       import { Textarea } from "./textarea";
       const View = () => (
         <>
           <Field.Root><Field.Control aria-label="Search" /></Field.Root>
           <Field.Root><Field.Control render={<Textarea aria-label="Notes" />} /></Field.Root>
           <Field.Root><label>Name<Field.Control /></label></Field.Root>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not use aria naming from an unrelated sibling", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field } from "@base-ui/react/field";
       const View = () => (
         <Field.Root>
           <div aria-label="Group">Help</div>
           <Field.Control />
         </Field.Root>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet without a provable control or with unprovable content", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field } from "@base-ui/react/field";
       const View = ({ children, controlProps }) => (
         <>
           <Field.Root><Field.Description>Read-only summary</Field.Description></Field.Root>
           <Field.Root>{children}<Field.Control /></Field.Root>
           <Field.Root><FieldHeader /><Field.Control /></Field.Root>
           <Field.Root><Field.Control {...controlProps} /></Field.Root>
         </>
       );
       const FieldHeader = () => null;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips fields from other libraries", () => {
    const result = runRule(
      baseUiFieldRequiresLabel,
      `import { Field } from "another-form-kit";
       const View = () => <Field.Root><Field.Control /></Field.Root>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
