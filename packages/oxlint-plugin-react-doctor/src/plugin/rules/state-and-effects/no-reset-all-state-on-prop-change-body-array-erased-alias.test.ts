import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

const source = `
import { useEffect, useState } from "react";
interface ArrayProps {
  data: string[];
}
export const Panel = (props: ArrayProps) => {
  const { data: sourceValue } = props;
  interface sourceValue {}
  const [draft, setDraft] = useState(sourceValue);

  useEffect(() => {
    setDraft(sourceValue);
  }, [sourceValue]);
  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;
};
`;

describe("no-reset-all-state-on-prop-change body array erased binding", () => {
  it("does not treat a prop-derived array as a constant reset", () => {
    const result = runRule(noResetAllStateOnPropChange, source, {
      filename: "/synthetic/body-array-sibling/erased-alias.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
