import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUncontrolledInput } from "./no-uncontrolled-input.js";

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
