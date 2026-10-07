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

  it("reports controls whose name is statically empty or omitted by React", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input name="" /><select name={null} /><textarea name={undefined} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("allows controls whose dynamic name may submit data", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ fieldName }) => <form><input name={fieldName} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips statically disabled controls because they are not submitted", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input disabled /><select disabled={true} /><textarea disabled="false" /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips dynamically disabled controls because they may not be submitted", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ disabled }) => <form><input disabled={disabled} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports controls whose disabled value is statically false", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input disabled={false} /><select disabled={null} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports controls whose disabled prop is statically omitted by React", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input disabled={undefined} /><select disabled={void 0} /><textarea disabled="" /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("skips controls disabled by a fieldset except inside its first legend", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><fieldset disabled><legend><input /></legend><input /><legend><textarea /></legend></fieldset></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("recognizes a first legend rendered through an expression", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ show }) => <form><fieldset disabled>{show && <legend><input /></legend>}<textarea /></fieldset></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips controls inside an unresolved fieldset spread", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ props }) => <form><fieldset {...props}><input /></fieldset><fieldset {...props} disabled={false}><input /></fieldset></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips inputs whose dynamic type could be button-like", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ inputType }) => <form><input type={inputType} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports inputs whose omitted static type defaults to text", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input type={null} /><input type={undefined} /><input type={void 0} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(3);
  });

  it("skips controls outside forms, custom controls, and spreads", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ props }) => <><input /><form><Input /><input {...props} /></form></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports controls with a statically matched explicit form owner", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = () => <><form id="primary"><input form="" /><input form="primary" /></form><input form="primary" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("belongs to a form");
  });

  it("matches numeric form ids after React stringification", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = () => <><form id={1} /><input form={1} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips explicit form owners that cannot be matched statically", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = ({ formId }) => <><form id={formId} /><input form={formId} /><input form="missing" /><form id="primary" {...props} /><input form="primary" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not associate matching ids declared by a separate component", () => {
    const result = runRule(
      formControlRequiresName,
      `const ProfileForm = () => <form id="profile" />; const DetachedField = () => <input form="profile" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not associate matching ids across separate top-level JSX values", () => {
    const result = runRule(
      formControlRequiresName,
      `const form = <form id="profile" />; const field = <input form="profile" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not associate matching ids across nested sibling components", () => {
    const result = runRule(
      formControlRequiresName,
      `const Outer = () => { const Form = () => <form id="profile" />; const Field = () => <input form="profile" />; return <Field />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not associate an explicit owner whose JSX initializer is never rendered", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = () => { const unusedForm = <form id="profile" />; return <input form="profile" />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat a JSX value used only as a logical condition as rendered", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = () => { const unusedForm = <form id="profile" />; return unusedForm && <input form="profile" />; };`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches explicit owners returned through stable aliases and conditional branches", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = ({ show }) => { const profileForm = <form id="profile" />; const content = show ? <>{profileForm}<input form="profile" /></> : null; return content; };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips ambiguous duplicate owner ids", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = () => <><div id="profile" /><form id="profile" /><input form="profile" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips mutually exclusive explicit owners and controls", () => {
    const result = runRule(
      formControlRequiresName,
      `const Example = ({ useForm }) => useForm ? <form id="profile" /> : <input form="profile" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("matches explicit owners through an inline render callback", () => {
    const result = runRule(
      formControlRequiresName,
      `const ProfileForm = ({ fields }) => <><form id="profile" />{fields.map((field) => <input key={field} form="profile" />)}</>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat unused JSX allocated in a render callback as a form descendant", () => {
    const result = runRule(
      formControlRequiresName,
      `const ProfileForm = ({ fields }) => <form>{fields.map((field) => { const unused = <input key={field} />; return null; })}</form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("stops form ancestry at render props, custom components, and portals", () => {
    const result = runRule(
      formControlRequiresName,
      `import { createPortal as portal } from "react-dom"; const Example = ({ target }) => <form><Widget render={() => <input />} /><Wrapper><textarea /></Wrapper>{portal(<select />, target)}</form>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports when explicit props after a spread prove the control is enabled and nameless", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = ({ props }) => <form><input {...props} type="text" disabled={false} name={null} form={undefined} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("analyzes object spreads that cannot provide relevant attributes", () => {
    const result = runRule(
      formControlRequiresName,
      `const Form = () => <form><input {...{ className: "field" }} /></form>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("skips controls rasterized by an imported ImageResponse", () => {
    const result = runRule(
      formControlRequiresName,
      `import { ImageResponse } from "next/og";
       export const GET = () => new ImageResponse(<form><input /></form>);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
