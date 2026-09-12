import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { octaneNoNativeTextOnchange } from "./octane-no-native-text-onchange.js";

const runOctaneRule = (source: string) =>
  runRule(
    octaneNoNativeTextOnchange,
    `
      import { Fragment } from "octane";
      ${source}
    `,
    { filename: "field.tsx" },
  );

describe("octane-no-native-text-onchange", () => {
  it("reports React-style change handlers on text inputs and textareas", () => {
    const result = runOctaneRule(`
      export const Field = ({ value }) => (
        <>
          <input value={value} onChange={() => {}} />
          <textarea onChangeCapture={() => {}} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    expect(result.diagnostics[0]?.message).toContain("`onInput`");
    expect(result.diagnostics[0]?.message).toContain("`defaultValue`");
    expect(result.diagnostics[1]?.message).toContain("`onInputCapture`");
  });

  it("covers missing, text-entry, and invalid input types", () => {
    const textEntryTypes = [
      "",
      "text",
      "SEARCH",
      "url",
      "tel",
      "password",
      "email",
      "number",
      "not-a-real-input-state",
    ];
    const fields = textEntryTypes
      .map((inputType) => `<input type="${inputType}" onChange={() => {}} />`)
      .join("\n");
    const result = runOctaneRule(`
      export const Field = () => (
        <>
          <input onChange={() => {}} />
          <input type onChange={() => {}} />
          <input type={42} onChange={() => {}} />
          ${fields}
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(textEntryTypes.length + 3);
  });

  it("allows known non-text controls and component callbacks", () => {
    const nonTextTypes = [
      "button",
      "checkbox",
      "color",
      "date",
      "datetime-local",
      "file",
      "hidden",
      "image",
      "month",
      "radio",
      "range",
      "reset",
      "submit",
      "time",
      "week",
    ];
    const fields = nonTextTypes
      .map((inputType) => `<input type="${inputType}" onChange={() => {}} />`)
      .join("\n");
    const result = runOctaneRule(`
      const Field = () => null;
      export const Form = () => (
        <>
          ${fields}
          <select onChange={() => {}} />
          <custom-input onChange={() => {}} />
          <Field onChange={() => {}} />
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows usable input handlers and explicit native commit intent", () => {
    const result = runOctaneRule(`
      const handleInput = () => {};
      export const Field = () => (
        <>
          <input onChange={() => {}} onInput={() => {}} />
          <input onChange={() => {}} onInputCapture={handleInput} />
          <input onChange={() => {}} readOnly />
          <textarea onChange={() => {}} disabled="disabled" />
          <input onChange={() => {}} suppressNativeChangeWarning />
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports false host booleans and false suppression", () => {
    const result = runOctaneRule(`
      export const Field = () => (
        <>
          <input onChange={() => {}} readOnly={false} />
          <input onChange={() => {}} readonly="" />
          <input onChange={() => {}} disabled={0} />
          <input onChange={() => {}} suppressNativeChangeWarning={false} />
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(4);
  });

  it("defers dynamic and spread-owned decisions to Octane runtime checks", () => {
    const result = runOctaneRule(`
      import { importedInput } from "./handlers";
      export const Field = (props) => (
        <>
          <input type={props.type} onChange={() => {}} />
          <input {...props.inputProps} onChange={() => {}} />
          <textarea onChange={() => {}} onInput={importedInput} />
          <input onChange={() => {}} readOnly={props.readOnly} />
          <input
            onChange={() => {}}
            suppressNativeChangeWarning={props.commitOnly}
          />
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(0);
  });

  it("ignores absent change handlers and honors final readonly spelling", () => {
    const result = runOctaneRule(`
      export const Field = () => (
        <>
          <input onChange={null} />
          <input onChange={false} />
          <input onChange={undefined} />
          <input readOnly={false} readonly onChange={() => {}} />
          <input readonly readOnly={false} onChange={() => {}} />
        </>
      );
    `);

    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not apply Octane event semantics to React modules", () => {
    const result = runRule(
      octaneNoNativeTextOnchange,
      `
        import { Fragment } from "react";
        export const Field = () => <input onChange={() => {}} />;
      `,
      { filename: "field.tsx" },
    );

    expect(result.diagnostics).toHaveLength(0);
  });

  it("recognizes Octane's DOM pragma and skips non-DOM renderer pragmas", () => {
    const domResult = runRule(
      octaneNoNativeTextOnchange,
      `
        /** @jsxImportSource octane */
        export const Field = () => <textarea onChange={() => {}} />;
      `,
      { filename: "field.tsx" },
    );
    const rendererResult = runRule(
      octaneNoNativeTextOnchange,
      `
        /** @jsxImportSource @octanejs/three/intrinsics */
        export const Field = () => <textarea onChange={() => {}} />;
      `,
      { filename: "field.tsx" },
    );

    expect(domResult.diagnostics).toHaveLength(1);
    expect(rendererResult.diagnostics).toHaveLength(0);
  });
});
