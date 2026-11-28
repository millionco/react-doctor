import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface HistoryFixtureOptions {
  importLine?: string;
  stateModule?: string;
  declaration?: string;
  setup?: string;
  effect?: string;
  render?: string;
}

const buildSource = ({
  importLine = 'import { createMemoryHistory as createHistory } from "history";',
  stateModule = "react",
  declaration = "const history = createHistory();",
  setup = "",
  effect = "useLayoutEffect(() => history.listen(setUpdate), [history]);",
  render = 'return <button onClick={() => history.push("/next")}>{update.location.pathname}</button>;',
}: HistoryFixtureOptions = {}): string => `
  ${importLine}
  import { useLayoutEffect } from "react";
  import { useState } from "${stateModule}";
  ${declaration}
  export function NavigationStatus({ active }) {
    ${setup}
    const [update, setUpdate] = useState({ location: history.location });
    ${effect}
    ${render}
  }
`;

describe("owned History listener cleanup", () => {
  it.each([
    ["a directly returned MemoryHistory disposer", {}],
    [
      "a block return from a HashHistory effect",
      {
        importLine: 'import { createHashHistory as createHistory } from "history";',
        effect: "useLayoutEffect(() => { return history.listen(setUpdate); }, [history]);",
      },
    ],
    [
      "a BrowserHistory disposer after an early return with no registration",
      {
        importLine: 'import { createBrowserHistory as createHistory } from "history";',
        effect:
          "useLayoutEffect(() => { if (!active) return; return history.listen(setUpdate); }, [active, history]);",
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, HistoryFixtureOptions]>)(
    "accepts %s",
    (_label, options) => {
      const result = runRule(effectNeedsCleanup, buildSource(options));
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    [
      "a discarded disposer",
      { effect: "useLayoutEffect(() => { history.listen(setUpdate); }, [history]);" },
    ],
    [
      "a conditional return after registration",
      {
        effect:
          "useLayoutEffect(() => { const release = history.listen(setUpdate); if (active) return release; }, [active, history]);",
      },
    ],
    [
      "a deferred registration",
      {
        effect:
          "useLayoutEffect(() => Promise.resolve().then(() => history.listen(setUpdate)), [history]);",
      },
    ],
    [
      "an unrelated cleanup function",
      {
        effect:
          "useLayoutEffect(() => { history.listen(setUpdate); return () => {}; }, [history]);",
      },
    ],
    ["a replaced listener method", { setup: "history.listen = () => undefined;" }],
    [
      "an effect from a mutable namespace",
      {
        importLine:
          'import { createMemoryHistory as createHistory } from "history"; import React from "react";',
        setup: "React.useLayoutEffect = registerWithoutCleanup;",
        effect: "React.useLayoutEffect(() => history.listen(setUpdate), [history]);",
      },
    ],
    ["a receiver accessible through a dynamic scope", { setup: "eval(source);" }],

    [
      "an ordinary named callback",
      {
        setup: "const handleUpdate = () => { throw new Error('Navigation failed'); };",
        effect: "useLayoutEffect(() => history.listen(handleUpdate), [history]);",
      },
    ],
    [
      "a setter from an unverified hook provider",
      {
        stateModule: "state-adapter",
      },
    ],
    ["an escaped receiver", { render: "return <Router navigator={history} />;" }],
    ["an exported receiver", { declaration: "export const history = createHistory();" }],
    [
      "a receiver re-export",
      { declaration: "const history = createHistory(); export { history };" },
    ],
    [
      "an aliased receiver passed to a caller",
      { setup: "const alias = history; transform(alias);" },
    ],
    [
      "a method from an unverified provider",
      { importLine: 'import { createMemoryHistory as createHistory } from "history-adapter";' },
    ],
    [
      "a shadowed factory",
      {
        declaration: "",
        setup: "const createHistory = () => fallback; const history = createHistory();",
      },
    ],
  ] satisfies ReadonlyArray<readonly [string, HistoryFixtureOptions]>)(
    "keeps the warning for %s",
    (_label, options) => {
      const result = runRule(effectNeedsCleanup, buildSource(options));
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );
});
