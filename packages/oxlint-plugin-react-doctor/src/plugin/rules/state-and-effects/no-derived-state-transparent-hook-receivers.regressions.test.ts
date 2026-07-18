import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";
import { noDerivedState } from "./no-derived-state.js";

const rules = [noDerivedState, noDerivedStateEffect];

describe("derived-state transparent hook receivers", () => {
  it("reports derived state through wrapped React namespace receivers", () => {
    const source = `import * as React from "react";
      function CastReceiver({ value }) {
        const [draft, setDraft] = (React as any).useState("");
        (React as any).useEffect(() => setDraft(value), [value]);
        return <output>{draft}</output>;
      }
      function NonNullReceiver({ value }) {
        const [draft, setDraft] = React!.useState("");
        React!.useEffect(() => setDraft(value), [value]);
        return <output>{draft}</output>;
      }`;

    for (const rule of rules) {
      const result = runRule(rule, source, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    }
  });

  it("rejects wrapped userland React lookalikes", () => {
    const source = `const React = {
        useState: (initialValue) => [initialValue, () => undefined],
        useEffect: (callback) => callback(),
      };
      function Example({ value }) {
        const [draft, setDraft] = (React as any).useState("");
        React!.useEffect(() => setDraft(value), [value]);
        return <output>{draft}</output>;
      }`;

    for (const rule of rules) {
      const result = runRule(rule, source, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });
});
