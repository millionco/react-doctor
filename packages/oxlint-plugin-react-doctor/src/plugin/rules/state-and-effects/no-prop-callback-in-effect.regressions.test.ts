import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPropCallbackInEffect } from "./no-prop-callback-in-effect.js";

describe("no-prop-callback-in-effect — regressions", () => {
  it("stays silent when the prop is a pure transform consumed locally", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ validate }) {
        const [value] = useState("");
        const [error, setError] = useState(null);
        useEffect(() => { setError(validate(value)); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a discarded prop callback that syncs the parent", () => {
    const result = runRule(
      noPropCallbackInEffect,
      `function Field({ onChange }) {
        const [value, setValue] = useState("");
        useEffect(() => { onChange(value); }, [value]);
        return null;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
