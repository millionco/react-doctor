import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noEventTriggerState } from "./no-event-trigger-state.js";

const buildForm = (cleanup: string): string => `import { useEffect, useState } from "react";
const Form = () => {
  const [firstName, setFirstName] = useState("");
  const [jsonToSubmit, setJsonToSubmit] = useState(null);
  useEffect(() => {
    if (jsonToSubmit !== null) {
      post("/api/register", jsonToSubmit);
    }
    ${cleanup}
  }, [jsonToSubmit]);
  return (
    <form onSubmit={(event) => { event.preventDefault(); setJsonToSubmit({ firstName }); }}>
      <input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
    </form>
  );
};`;

describe("no-event-trigger-state — regressions", () => {
  it.each([
    ["no cleanup", ""],
    ["an empty arrow", "return () => {};"],
    ["an arrow that only reads a binding", "return () => { jsonToSubmit; };"],
  ])("flags an event-triggered POST effect with %s", (_label, cleanup) => {
    const result = runRule(noEventTriggerState, buildForm(cleanup));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when the effect returns a cleanup that does work", () => {
    const result = runRule(noEventTriggerState, buildForm("return () => { cancelled = true; };"));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    "return () => cleanupSignal;",
    "return () => void cleanupSignal;",
    "return subscribe();",
    "return (() => connection.close()) as (() => void);",
  ])("retains meaningful or unproved cleanup work: %s", (cleanup) => {
    const result = runRule(
      noEventTriggerState,
      `Object.defineProperty(globalThis, "cleanupSignal", {
        get() { connection.close(); }
      });\n${buildForm(cleanup)}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
