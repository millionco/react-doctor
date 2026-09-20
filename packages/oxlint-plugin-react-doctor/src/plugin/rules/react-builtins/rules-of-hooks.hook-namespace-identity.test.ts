import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { rulesOfHooks } from "./rules-of-hooks.js";

const runTsx = (code: string) =>
  runRule(rulesOfHooks, code, { filename: "fixture.tsx", includeLocations: true });

describe("rules-of-hooks — hook-namespace-identity", () => {
  it("resolves an inspection dispatcher including factories and effect events", () => {
    const result = runTsx(`
      const log = [];
      const inspectState = (value) => { log.push(value); return [value, () => {}]; };
      const inspectContext = (context) => context.current;
      const inspectEffect = (callback) => { log.push(callback); };
      const inspectEvent = (callback) => { log.push(callback); return callback; };
      const createInspector = (kind) => (value) => { log.push(kind); return value; };
      const inspectAction = createInspector("action");
      const Dispatcher = {
        useContext: inspectContext,
        useState: inspectState,
        useReducer: inspectState,
        useRef: inspectState,
        useEffect: inspectEffect,
        useEffectEvent: inspectEvent,
        useActionState: inspectAction,
      };
      function collectStack() {
        try {
          Dispatcher.useContext({ current: null });
          Dispatcher.useState(null);
          Dispatcher.useReducer(null);
          Dispatcher.useRef(null);
          Dispatcher.useEffect(() => {});
          if (typeof Dispatcher.useEffectEvent === "function") {
            Dispatcher.useEffectEvent(() => {});
          }
          Dispatcher.useActionState(null);
        } finally { log.length = 0; }
      }
    `);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `const readValue = () => 1; const Hooks = { useValue: readValue };`,
    `const readValue = () => 1; const Alias = readValue; const Hooks = { useValue: Alias };`,
    `const Source = { useValue: () => 1 }; const Hooks = Source;`,
    `const Hooks = { useValue() { return 1; } };`,
    `function readValue() { return 1; } const Hooks = { useValue: readValue };`,
    `const readValue = () => 1; const Hooks = ({ useValue: readValue } as const);`,
    `const createValue = () => { return () => 1; }; const Hooks = { useValue: createValue() };`,
    `const Hooks = { ...unknown, useValue: () => 1 };`,
  ])("allows a resolved local member: %s", (setup) => {
    const result = runTsx(`${setup}\nHooks.useValue();`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses the shadowing local binding rather than the imported namespace", () => {
    const result = runTsx(`
      import * as Hooks from "./hooks";
      function collect() {
        const Hooks = { useState: () => 0 };
        Hooks.useState();
      }
    `);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `import * as Hooks from "react";`,
    `import * as React from "react"; const Hooks = React;`,
    `import { useState as state } from "react"; const Hooks = { useState: state };`,
    `import * as Hooks from "./feature-hooks";`,
    `import * as Hooks from "@/feature-hooks";`,
    `import * as Hooks from "./opaque-hook-package";`,
    `const Hooks = createUnknownNamespace();`,
    `const Hooks = { useState: importedImplementation };`,
    `const Hooks = { get useState() { return implementation; } };`,
    `const Hooks = { useState: () => 0, ...unknown };`,
    `const Hooks = { useState: () => 0, [unknown]: implementation };`,
    `let Hooks = { useState: () => 0 }; Hooks = React;`,
    `const Hooks = { useState: () => 0 }; Hooks.useState = React.useState;`,
    `const Hooks = { useState: () => 0 }; const Alias = Hooks; Alias.useState = React.useState;`,
    `const Hooks = { useState: () => 0 }; Hooks[key] = React.useState;`,
    `const Hooks = { useState: () => 0 }; mutate(Hooks);`,
    `const Hooks = { useState: () => 0 }; Object.assign(Hooks, React);`,
    `const Hooks = { useState: () => 0 }; Object.defineProperty(Hooks, "useState", descriptor);`,
    `const Hooks = { useState: () => React.useState(0) };`,
    `import { useState as state } from "react"; const Hooks = { useState: () => state(0) };`,
    `import { useFeature as feature } from "./hooks"; const Hooks = { useState: () => feature() };`,
    `const useFeature = () => React.useState(0); const Hooks = { useState: useFeature };`,
    `const read = () => React.useState(0); const Hooks = { useState: () => read() };`,
    `const Hooks = { useState: () => (() => React.useState(0))() };`,
    `const Hooks = { useState: () => (useFeature as Function)() };`,
    `const Hooks = { useState: () => Other["useFeature"]() };`,
    `const createHook = () => () => React.useState(0); const Hooks = { useState: createHook() };`,
    `const createHook = (callback) => () => callback(); const Hooks = { useState: createHook(React.useState) };`,
    `const createHook = async () => () => 0; const Hooks = { useState: createHook() };`,
    `const createHook = () => () => 0; const Hooks = { useState: createHook() }; mutate(Hooks);`,
    `const createHook = () => () => 0; const Hooks = { useState: createHook() }; Object.assign(Hooks, React);`,
    `const read = () => read(); const Hooks = { useState: read };`,
  ])("retains a possible Hook call: %s", (setup) => {
    const result = runTsx(`${setup}\nHooks.useState();`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.some((diagnostic) => diagnostic.line === 2)).toBe(true);
  });

  it("retains conditional calls through React aliases and local custom Hook objects", () => {
    const result = runTsx(`
      import * as ReactRuntime from "react";
      const Alias = ReactRuntime;
      const Hooks = { useFeature: () => ReactRuntime.useState(0) };
      function Component({ enabled }) {
        if (enabled) {
          Alias.useState(0);
          Hooks.useFeature();
        }
        return null;
      }
    `);
    expect(
      result.diagnostics.filter((diagnostic) => diagnostic.message.includes("changes Hook order")),
    ).toHaveLength(2);
  });

  it("keeps a shadowing unknown parameter eligible for the namespace heuristic", () => {
    const result = runTsx(`
      const Hooks = { useState: () => 0 };
      function collect(Hooks) { Hooks.useState(); }
    `);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("preserves React effect event escape checks beside a local implementation", () => {
    const result = runTsx(`
      import * as React from "react";
      const Dispatcher = { useEffectEvent: (callback) => callback };
      Dispatcher.useEffectEvent(() => {});
      React.useEffectEvent(() => {});
    `);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].line).toBe(5);
    expect(result.diagnostics[0].message).toContain("passing it around");
  });
});
