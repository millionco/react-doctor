import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const source = `
import { useEffect, useState } from "react";
interface ArrayProps {
  data: string[];
}
export const Panel = (props: ArrayProps) => {
  const { data: sourceValue } = props;
  const [draft, setDraft] = useState(sourceValue);
  interface setDraft {}

  useEffect(() => {
    setDraft(sourceValue);
  }, [sourceValue]);
  return <button onClick={() => setDraft([...draft].reverse())}>{String(draft)}</button>;
};
`;

describe("exhaustive-deps body array erased binding", () => {
  it("does not require a stable React setter hidden by an erased interface", () => {
    const result = runRule(exhaustiveDeps, source, {
      filename: "/synthetic/body-array-sibling/erased-setter.tsx",
      settings: { "react-doctor": { portedRuleMode: "curated", capabilities: ["react"] } },
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
