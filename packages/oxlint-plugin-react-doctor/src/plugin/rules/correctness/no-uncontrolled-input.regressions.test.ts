import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { altText } from "../a11y/alt-text.js";
import { noUncontrolledInput } from "./no-uncontrolled-input.js";

const READ_ONLY_VALUE_INPUT_TYPES = [
  "button",
  "checkbox",
  "hidden",
  "image",
  "radio",
  "reset",
  "submit",
];

describe("correctness/no-uncontrolled-input — regressions", () => {
  it("stays silent on a `disabled` value input (React suppresses the missing-onChange warning)", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Profile({ email }) { return <input type="text" value={email ?? ""} disabled />; }`,
      { filename: "app/profile.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a value input wired to `onInput` (SolidJS-port idiom)", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Field({ text, setText }) { return <input value={text} onInput={(e) => setText(e.currentTarget.value)} />; }`,
      { filename: "app/field.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a genuinely uncontrolled value input (no handler, not disabled)", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Field({ text }) { return <input type="text" value={text} />; }`,
      { filename: "app/field.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each(["button", "hidden", "image", "reset", "submit"])(
    "still flags an undefined-state transition for a %s input without asking for onChange",
    (inputType) => {
      const result = runRule(
        noUncontrolledInput,
        `import { useState } from "react";
        export default function Control() {
          const [label] = useState();
          return <input type="${inputType}" value={label} />;
        }`,
        { filename: "app/control.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("Give useState a starting value");
      expect(result.diagnostics[0]?.message).not.toContain("add onChange");
    },
  );

  it.each(["checkbox", "radio"])(
    "does not treat value state as the controlledness signal for an exact-lowercase %s input",
    (inputType) => {
      const result = runRule(
        noUncontrolledInput,
        `import { useState } from "react";
        export default function Control() {
          const [value] = useState();
          return <input type="${inputType}" value={value} />;
        }`,
        { filename: "app/control.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("still flags an undefined-state transition for uppercase CHECKBOX because React's checked controlledness test is case-sensitive", () => {
    const result = runRule(
      noUncontrolledInput,
      `import { useState } from "react";
      export default function Control() {
        const [value] = useState();
        return <input type="CHECKBOX" value={value} />;
      }`,
      { filename: "app/control.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).not.toContain(
      "When `type` resolves to a value-controlled input type",
    );
  });

  it("uses conditional transition wording for dynamic and mixed checked-controlledness types", () => {
    const result = runRule(
      noUncontrolledInput,
      `import { useState } from "react";
      export default function Controls({ inputType, useCheckbox }) {
        const [dynamicValue] = useState();
        const [mixedValue] = useState();
        return <>
          <input type={inputType} value={dynamicValue} />
          <input type={useCheckbox ? "checkbox" : "submit"} value={mixedValue} />
        </>;
      }`,
      { filename: "app/controls.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).toContain("When `type` resolves to a value-controlled input type");
      expect(diagnostic.message).not.toContain("add onChange");
    }
  });

  it("stays silent on the DevLovers submit input whose value labels a button", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function BlogHeaderSearch() {
        return <input id="search_submit" value="" type="submit" className="search-submit" />;
      }`,
      { filename: "components/blog/BlogHeaderSearch.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an editable text input adjacent to the DevLovers regression", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function BlogHeaderSearch({ search }) {
        return <input id="search_query" value={search} type="text" />;
      }`,
      { filename: "components/blog/BlogHeaderSearch.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  for (const inputType of READ_ONLY_VALUE_INPUT_TYPES) {
    it(`stays silent on a ${inputType} input whose value is not user-editable`, () => {
      const result = runRule(
        noUncontrolledInput,
        `export default function Control() { return <input type="${inputType}" value="Action" />; }`,
        { filename: "app/control.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`normalizes a statically known ${inputType} input type case-insensitively`, () => {
      const result = runRule(
        noUncontrolledInput,
        `export default function Control() { return <input type="${inputType.toUpperCase()}" value="Action" />; }`,
        { filename: "app/control.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it(`still flags value and defaultValue together on a ${inputType} input`, () => {
      const result = runRule(
        noUncontrolledInput,
        `export default function Control() { return <input type="${inputType}" value="Action" defaultValue="Fallback" />; }`,
        { filename: "app/control.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("defaultValue");
    });
  }

  it.each(["text", "search"])(
    "still flags an editable %s input without a change handler",
    (inputType) => {
      const result = runRule(
        noUncontrolledInput,
        `export default function Field({ value }) { return <input type="${inputType}" value={value} />; }`,
        { filename: "app/field.tsx" },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("still flags an input with no statically known type", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Field({ value, inputType }) { return <input type={inputType} value={value} />; }`,
      { filename: "app/field.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain(
      "When `type` resolves to an editable input type",
    );
  });

  it("stays silent on expression, wrapped, const-alias, and all-bypass ternary types", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Controls({ alternate }) {
        const inputType = "reset";
        return <>
          <input type={"submit"} value="Submit" />
          <input type={("IMAGE" as const)} value="Search" alt="Search" />
          <input type={inputType} value="Reset" />
          <input type={alternate ? "button" : "submit"} value="Action" />
        </>;
      }`,
      { filename: "app/controls.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("resolves a constant ternary and a long const alias chain", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Controls() {
        const firstType = "submit";
        const secondType = firstType;
        const thirdType = secondType;
        const fourthType = thirdType;
        const fifthType = fourthType;
        const sixthType = fifthType;
        return <>
          <input type={true ? "submit" : editableType} value="Action" />
          <input type={sixthType} value="Action" />
        </>;
      }`,
      { filename: "app/controls.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags mixed editable ternaries and mutable aliases", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Fields({ alternate }) {
        let mutableInputType = "submit";
        return <>
          <input type={alternate ? "submit" : "text"} value="Action" />
          <input type={mutableInputType} value="Action" />
        </>;
      }`,
      { filename: "app/fields.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.message).toContain("When `type` resolves to an editable input type");
    }
  });

  it("uses the last explicit input type when duplicate attributes are present", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Controls({ value }) {
        return <>
          <input type="submit" type="text" value={value} />
          <input type="text" type="submit" value="Action" />
        </>;
      }`,
      { filename: "app/controls.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays conservative when an opaque spread appears before or after the input type", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Controls({ inputProps }) {
        return <>
          <input {...inputProps} type="submit" value="Action" />
          <input type="submit" {...inputProps} value="Action" />
        </>;
      }`,
      { filename: "app/controls.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an input with a missing type", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Field({ value }) { return <input value={value} />; }`,
      { filename: "app/field.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps the missing-alt diagnostic for image inputs", () => {
    const source = `export default function ImageControl() { return <input type="image" value="Search" />; }`;
    const controlledInputResult = runRule(noUncontrolledInput, source, {
      filename: "app/image-control.tsx",
    });
    const altTextResult = runRule(altText, source, { filename: "app/image-control.tsx" });
    expect(controlledInputResult.parseErrors).toEqual([]);
    expect(controlledInputResult.diagnostics).toEqual([]);
    expect(altTextResult.parseErrors).toEqual([]);
    expect(altTextResult.diagnostics).toHaveLength(1);
  });

  it("stays silent on a static input mock in a __tests__ file (test-noise)", () => {
    const result = runRule(
      noUncontrolledInput,
      `const StaticInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({
        id,
        value = '',
      }) => {
        shouldNotRender();
        return <input id={id} value={value} />;
      };`,
      { filename: "components/form/__tests__/index.test.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a value input whose only partner is a literal `disabled={false}`", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Field({ text }) { return <input type="text" value={text} disabled={false} />; }`,
      { filename: "app/field.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a value input with a dynamic `disabled={expression}`", () => {
    const result = runRule(
      noUncontrolledInput,
      `export default function Field({ text, isSubmitting }) { return <input type="text" value={text} disabled={isSubmitting} />; }`,
      { filename: "app/field.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
