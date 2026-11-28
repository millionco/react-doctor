import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const component = (body: string, extra = "") => `
  import { useState } from "react";

  export function Panel() {
    const [loading, setLoading] = useState(false);
    const [busy, setBusy] = useState(false);
    ${extra}
    const run = async () => {
      setLoading(true);
      ${body}
      await updatePreview();
      setLoading(false);
    };
    return <button disabled={loading || busy} onClick={run} />;
  }
`;

describe("loading flags cleared before later work", () => {
  it.each([
    ["a direct prior clear", component("setLoading(false);")],
    [
      "a prior finally clear",
      component("try { await preparePreview(); } finally { setLoading(false); }"),
    ],
    [
      "a prior clear before a variable initializer await",
      component("setLoading(false);").replace(
        "await updatePreview();",
        "const result = await updatePreview();",
      ),
    ],
  ])("stays quiet after %s", (_name, source) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a conditional clear", component("if (ready) setLoading(false);")],
    ["a zero-trip loop clear", component("while (ready) setLoading(false);")],
    ["a different setter", component("setBusy(false);")],
    ["a same-setter activation after clearing", component("setLoading(false); setLoading(true);")],
    ["an unknown write after clearing", component("setLoading(false); setLoading(flag);")],
    [
      "an update outside the async function",
      component("setLoading(false);", "register(() => setLoading(true));"),
    ],
    ["an escaped setter", component("setLoading(false); remember(setLoading);")],
    ["a lexical dynamic write", component('setLoading(false); eval("setLoading(true)");')],
    [
      "a nested activation followed by a rejectable await",
      component("setLoading(false); await preparePreview(setLoading(true));"),
    ],
    [
      "an activation in an awaited class initializer",
      component("setLoading(false); await preparePreview(class { static { setLoading(true); } });"),
    ],
    ["an unresolved previous await", component("await preparePreview(); setLoading(false);")],
    [
      "a conditional finalizer clear",
      component("try { await preparePreview(); } finally { if (ready) setLoading(false); }"),
    ],
    [
      "a finalizer that can fail before the clear",
      component("try { await preparePreview(); } finally { notify(); setLoading(false); }"),
    ],
    [
      "a reducer dispatch",
      component("setLoading(false);")
        .replace("import { useState }", "import { useReducer, useState }")
        .replace(
          "const [loading, setLoading] = useState(false);",
          "const [loading, setLoading] = useReducer(reducer, false);",
        ),
    ],
    [
      "an unbound setter",
      "const run = async () => { setLoading(true); setLoading(false); await updatePreview(); setLoading(false); };",
    ],
  ])("still warns with %s", (_name, source) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
