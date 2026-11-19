import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noLoadingFlagResetOutsideFinally } from "./no-loading-flag-reset-outside-finally.js";

const renderFixture = ({
  formal = "withSpinner = false",
  raise = "if (withSpinner) setLoading(true);",
  work = "await load();",
  finalizer = "if (withSpinner) setLoading(false);",
  setup = "",
  stateDeclaration = "const [loading, setLoading] = useState(false);",
  handler = "",
} = {}) => `
  import { useCallback, useState } from "react";
  const Example = ({ load, other }) => {
    ${stateDeclaration}
    ${setup}
    const update = useCallback(async (${formal}) => {
      ${raise}
      try {
        ${work}
      } ${handler} finally {
        ${finalizer}
      }
    }, [load, other]);
    return <button onClick={() => update(true)}>{String(loading)}</button>;
  };
`;

describe("matching loading guard in finally", () => {
  it.each([
    {},
    {
      formal: "withSpinner: boolean",
      raise: "if (withSpinner) { setLoading(true); }",
      finalizer: "if (withSpinner) { setLoading(false); }",
      handler: "catch (caught) { throw caught; }",
    },
    { work: "return await load();" },
  ])("clears the flag whenever the matching parameter raised it", (fixture) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, renderFixture(fixture));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    { name: "different parameter", fixture: { finalizer: "if (other) setLoading(false);" } },
    {
      name: "extra condition",
      fixture: { finalizer: "if (withSpinner && other) setLoading(false);" },
    },
    { name: "reassigned parameter", fixture: { work: "await load(); withSpinner = false;" } },
    {
      name: "destructured assignment",
      fixture: { work: "await load(); [withSpinner] = [false];" },
    },
    {
      name: "shadowed parameter",
      fixture: { finalizer: "const withSpinner = false; if (withSpinner) setLoading(false);" },
    },
    { name: "dynamic assignment", fixture: { work: 'await load(); eval("withSpinner = false");' } },
    {
      name: "throwing operation before try",
      fixture: { raise: "if (withSpinner) { setLoading(true); check(); }" },
    },
    {
      name: "throwing operation before reset",
      fixture: { finalizer: "check(); if (withSpinner) setLoading(false);" },
    },
    {
      name: "unconditional second raise",
      fixture: { raise: "setLoading(true); if (withSpinner) setLoading(true);" },
    },
    { name: "escaped setter", fixture: { work: "await load(setLoading);" } },
    {
      name: "setter captured by helper",
      fixture: { setup: "const start = () => setLoading(true);", work: "start(); await load();" },
    },
    { name: "unknown setter", fixture: { stateDeclaration: "const loading = false;" } },
  ])("preserves the warning for $name", ({ fixture }) => {
    const result = runRule(noLoadingFlagResetOutsideFinally, renderFixture(fixture));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
