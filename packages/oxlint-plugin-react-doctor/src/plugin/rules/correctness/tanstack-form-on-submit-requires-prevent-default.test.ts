import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { tanstackFormOnSubmitRequiresPreventDefault } from "./tanstack-form-on-submit-requires-prevent-default.js";

describe("tanstack-form-on-submit-requires-prevent-default", () => {
  it("reports the bare handleSubmit reference", () => {
    const result = runRule(
      tanstackFormOnSubmitRequiresPreventDefault,
      `import { useForm } from "@tanstack/react-form";
       const View = () => {
         const form = useForm({ defaultValues: { name: "" } });
         return <form onSubmit={form.handleSubmit}><button type="submit">Save</button></form>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("preventDefault");
  });

  it("reports inline handlers that call handleSubmit without preventDefault", () => {
    const result = runRule(
      tanstackFormOnSubmitRequiresPreventDefault,
      `import { useForm } from "@tanstack/react-form";
       const View = ({ form }) => (
         <>
           <form onSubmit={(e) => form.handleSubmit()}>A</form>
           <form
             onSubmit={function submit(e) {
               e.stopPropagation();
               form.handleSubmit();
             }}
           >
             B
           </form>
         </>
       );`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts the documented preventDefault wrapper", () => {
    const result = runRule(
      tanstackFormOnSubmitRequiresPreventDefault,
      `import { useForm } from "@tanstack/react-form";
       const View = ({ form }) => (
         <form
           onSubmit={(e) => {
             e.preventDefault();
             e.stopPropagation();
             form.handleSubmit();
           }}
         >
           <button type="submit">Save</button>
         </form>
       );`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("leaves unrelated handlers, delegated identifiers, and other elements alone", () => {
    const result = runRule(
      tanstackFormOnSubmitRequiresPreventDefault,
      `import { useForm } from "@tanstack/react-form";
       const View = ({ form, submitForm }) => (
         <>
           <form onSubmit={submitForm}>A</form>
           <form onSubmit={(e) => e.preventDefault()}>B</form>
           <Form onSubmit={form.handleSubmit}>C</Form>
         </>
       );
       const Form = ({ children }) => <section>{children}</section>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stays quiet in files that never import the form library", () => {
    const result = runRule(
      tanstackFormOnSubmitRequiresPreventDefault,
      `import { useForm } from "react-hook-form";
       const View = () => {
         const { handleSubmit } = useForm();
         const form = { handleSubmit: () => {} };
         return <form onSubmit={handleSubmit(() => {})}><form onSubmit={form.handleSubmit} /></form>;
       };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
