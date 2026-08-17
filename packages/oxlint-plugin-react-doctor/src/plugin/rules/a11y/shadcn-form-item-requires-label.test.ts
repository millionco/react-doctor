import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { shadcnFormItemRequiresLabel } from "./shadcn-form-item-requires-label.js";

describe("shadcn-form-item-requires-label", () => {
  it("reports a FormItem whose control has no label, including the canonical field spread", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormControl, FormItem, FormMessage } from "@/components/ui/form";
       import { Input } from "@/components/ui/input";
       const Field = ({ field }) => (
         <FormItem>
           <FormControl><Input type="email" {...field} /></FormControl>
           <FormMessage />
         </FormItem>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("FormLabel");
  });

  it("supports renamed and namespace imports", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormItem as Item, FormControl as Control } from "./form";
       import * as Form from "~/ui/form";
       const View = () => (
         <>
           <Item><Control><input /></Control></Item>
           <Form.FormItem><Form.FormControl><textarea /></Form.FormControl></Form.FormItem>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts FormLabel anywhere in the item, including after the control", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormControl, FormItem, FormLabel } from "@/components/ui/form";
       import { Checkbox } from "@/components/ui/checkbox";
       const View = () => (
         <>
           <FormItem>
             <FormLabel>Email</FormLabel>
             <FormControl><input type="email" /></FormControl>
           </FormItem>
           <FormItem>
             <FormControl><Checkbox /></FormControl>
             <FormLabel className="sr-only">Accept terms</FormLabel>
           </FormItem>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts aria naming, intrinsic labels, and conditional labels", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormControl, FormItem } from "@/components/ui/form";
       const View = ({ showLabel }) => (
         <>
           <FormItem><FormControl><input aria-label="Search" /></FormControl></FormItem>
           <FormItem><label>Name<FormControl><input /></FormControl></label></FormItem>
           <FormItem>{showLabel && <FormLabel>Notes</FormLabel>}<FormControl><textarea /></FormControl></FormItem>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not use aria naming from an unrelated sibling", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormControl, FormItem } from "@/components/ui/form";
       const View = () => (
         <FormItem>
           <div aria-label="Help">?</div>
           <FormControl><input /></FormControl>
         </FormItem>
       );`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays quiet without a provable control or with unprovable content", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormControl, FormItem, FormDescription } from "@/components/ui/form";
       const View = ({ children, field }) => (
         <>
           <FormItem><FormDescription>Read-only summary</FormDescription></FormItem>
           <FormItem>{children}<FormControl><input /></FormControl></FormItem>
           <FormItem><FieldHeader /><FormControl><input /></FormControl></FormItem>
           <FormItem><FormControl><input {...restProps} /></FormControl></FormItem>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips FormItem components from other libraries", () => {
    const result = runRule(
      shadcnFormItemRequiresLabel,
      `import { FormItem, FormControl } from "some-form-kit";
       import { FormItem as FeatureItem, FormControl as FeatureControl } from "@acme/form";
       const View = () => (
         <>
           <FormItem><FormControl><input /></FormControl></FormItem>
           <FeatureItem><FeatureControl><input /></FeatureControl></FeatureItem>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
