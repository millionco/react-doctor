import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPlaceholderOnlyField } from "./no-placeholder-only-field.js";

describe("no-placeholder-only-field", () => {
  it("flags an input that uses only a placeholder", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input placeholder="Email address" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts a label associated by htmlFor", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label htmlFor="email">Email</label><input id="email" placeholder="name@example.com" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not associate labels from mutually exclusive render branches", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ showLabel }) => showLabel
        ? <label htmlFor="email">Email</label>
        : <input id="email" placeholder="name@example.com" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("tracks aliased branch predicates for label associations", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ showLabel }) => {
        const shouldRenderLabel = showLabel;
        return <>{shouldRenderLabel && <ElementHeader headline="Email" htmlFor="email" />}{!showLabel && <input id="email" placeholder="name@example.com" />}</>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps possibly coexisting dynamic label and field branches conservative", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ showLabel, showField }) => <>{showLabel && <label htmlFor="email">Email</label>}{showField && <input id="email" placeholder="name@example.com" />}</>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not associate labels from a render function with shadowed predicates", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ visible }) => {
        const label = visible && <label htmlFor="email">Email</label>;
        const Field = ({ visible }) => !visible && <input id="email" placeholder="name@example.com" />;
        return <>{label}<Field visible={visible} /></>;
      };`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts an opaque label component associated by htmlFor", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><ElementHeader headline="Username" htmlFor="username" /><input id="username" placeholder="Enter username" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an input nested in a label", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <label>Email<input placeholder="name@example.com" /></label>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("honors explicit label ownership and the first nested labelable control", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label htmlFor="other">Email<input placeholder="Email" /></label><label>Fields<input placeholder="First" /><textarea placeholder="Second" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts fields nested in the proven Windmill label component", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `import { Label as FieldLabel } from "@windmill/react-ui";
       const Example = () => <FieldLabel><span>Email</span><div><input placeholder="name@example.com" /></div></FieldLabel>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not trust same-named label components from other sources", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `import { Label } from "@acme/ui";
       const Example = () => <Label><input placeholder="Email" /></Label>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowing component with the Windmill label import's local name", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `import { Label as FieldLabel } from "@windmill/react-ui";
       const Example = ({ FieldLabel }) => <FieldLabel><input placeholder="Email" /></FieldLabel>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not treat an empty Windmill label wrapper as an accessible name", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `import { Label } from "@windmill/react-ui";
       const Example = () => <Label><input placeholder="Email" /></Label>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags fields wrapped by empty native labels", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label><span><input placeholder="Email" /></span></label><label> {" "} <textarea placeholder="Message" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags fields associated with empty native labels", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label htmlFor="email" /><input id="email" placeholder="Email" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts uncertain dynamic and component-provided label content", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ label }) => <><label>{label}<input placeholder="Email" /></label><label><Icon /><textarea placeholder="Message" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts explicit and wrapping labels with named intrinsic descendants", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label htmlFor="email"><img alt="Email" /></label><input id="email" placeholder="Email" /><label><span aria-label="Message" /><textarea placeholder="Message" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not count screen-reader-hidden label descendants as a name", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label htmlFor="email"><span aria-hidden="true">Hidden</span></label><input id="email" placeholder="Email" /><label><span hidden>Hidden</span><textarea placeholder="Message" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not count a hidden label itself as a name", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><label hidden htmlFor="email">Email</label><input id="email" placeholder="Email" /><label aria-hidden="true" htmlFor="message">Message</label><textarea id="message" placeholder="Message" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts label content with aria-hidden statically false", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <label aria-hidden={false}>Email<input placeholder="Email" /></label>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts labels whose intrinsic descendants may inject text content", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ label }) => <><label><span dangerouslySetInnerHTML={{ __html: "Email" }} /><input placeholder="Email" /></label><label><span children={label} /><textarea placeholder="Message" /></label></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts an explicitly named field", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input aria-label="Search" placeholder="Search docs" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags fields with empty static accessible names", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><input aria-label="  " placeholder="Search docs" /><textarea aria-labelledby={''} placeholder="Message" /><input aria-label={null} placeholder="Email" /><textarea aria-labelledby={void 0} placeholder="Details" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(4);
  });

  it("accepts fields with dynamically resolved accessible names", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ label, labelledBy }) => <><input aria-label={label} placeholder="Search docs" /><textarea aria-labelledby={labelledBy} placeholder="Message" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts React-stringified boolean ARIA names", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input aria-label={false} placeholder="Search docs" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer missing labels through spread props", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ field }) => <input placeholder="Email" {...field} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports through inline spreads that cannot provide relevant field attributes", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <>
        <input {...{ className: "field", "data-testid": "email" }} placeholder="Email" />
        <textarea placeholder="Message" {...{ rows: 4, ...{ spellCheck: true } }} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("honors explicit relevant attributes after an unresolved spread", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ field }) => <input {...field} aria-label="" aria-labelledby="" type="email" id={null} placeholder="Email" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative when unresolved spreads may supply or override relevant attributes", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ before, after }) => <>
        <input {...before} placeholder="Email" />
        <textarea placeholder="Message" {...after} />
        <input aria-label="" {...after} placeholder="Search" />
        <input aria-label="" aria-labelledby="" type="email" placeholder="Name" {...after} id={null} />
      </>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("uses effective duplicate attributes and treats omitted ids as unassociated", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <><input aria-label="Email" aria-label="" placeholder="Email" /><input placeholder="Email" placeholder="" /><input id={null} placeholder="Name" /><label htmlFor="wrong" htmlFor="email">Email</label><input id="email" placeholder="Email" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("skips placeholder fields inside hidden subtrees", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <div hidden><input placeholder="Email" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply to non-text controls", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type="checkbox" placeholder="Ignored" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not apply to brace-wrapped non-text controls", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type={'checkbox'} placeholder="Ignored" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips inputs whose type cannot be resolved", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = ({ type }) => <input type={type} placeholder="Maybe a text field" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("still flags brace-wrapped text input types", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type={'email'} placeholder="Email address" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("treats invalid input types as the text-state default", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input type="typo" placeholder="Email address" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not associate labels across separate render functions", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Label = () => <label htmlFor="email">Email</label>; const Field = () => <input id="email" placeholder="Email" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not report placeholder-only fields in non-production files", () => {
    const result = runRule(
      noPlaceholderOnlyField,
      `const Example = () => <input placeholder="Demo value" />;`,
      { filename: "src/demo/example.tsx" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
