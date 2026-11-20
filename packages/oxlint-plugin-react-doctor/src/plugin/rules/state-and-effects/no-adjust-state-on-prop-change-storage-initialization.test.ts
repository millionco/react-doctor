import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

const rule = wrapWithSemanticContext(noAdjustStateOnPropChange) as Rule;
const fixture = `import { useEffect, useState } from 'react';

const isPreview = () => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('demo');
};
const readStored = (name: string) => {
  if (typeof window === 'undefined' || isPreview()) return false;
  return localStorage.getItem(name) === 'ready';
};
const storeReady = (name: string) => {
  if (typeof window !== 'undefined' && !isPreview()) localStorage.setItem(name, 'ready');
};
export function Preview({ name, immediate, fallback }: { name: string; immediate: boolean; fallback: string }) {
  const [value, setValue] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (ready) return;
    if (typeof window !== 'undefined') {
      const existing = immediate || readStored(name);
      if (existing) {
        if (immediate) storeReady(name);
        setValue(fallback);
      }
      setReady(true);
    }
  }, [name, immediate, fallback, ready]);
  useEffect(() => {
    if (!ready) return;
    document.title = value;
  }, [ready, value]);
  return <span>{value}</span>;
}
`;

const windowProviderOverwrite = `const fallbackStore = {
  getItem(_key: string) { return 'ready'; },
  setItem(_key: string, _value: string) {},
};
addEventListener('load', (event) => {
  const owner = event.currentTarget;
  if (owner) Object.defineProperty(owner, 'localStorage', { configurable: true, value: fallbackStore });
}, { once: true });

`;

const timerProviderOverwrite = `setTimeout(\`
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem() { return 'ready'; }, setItem() {} },
  });
  globalThis.URLSearchParams = class { has() { return false; } };
\`, 0);

`;

const withSetup = (setup: string): string =>
  fixture.replace("const isPreview = ", `${setup}const isPreview = `);

const cases = [
  {
    name: "accepts a private marker after the browser storage check",
    code: fixture,
    writes: [],
  },
  {
    name: "reports a skip branch that can bypass browser storage work",
    code: fixture.replace("        if (immediate) storeReady(name);\n", ""),
    writes: ["setReady(true);"],
  },
  {
    name: "reports different completion values for storage reads and writes",
    code: fixture.replace(
      "localStorage.setItem(name, 'ready');",
      "localStorage.setItem(name, 'different-checkpoint');",
    ),
    writes: ["setReady(true);"],
  },
  {
    name: "reports when the marker is rendered",
    code: fixture.replace(
      "  return <span>{value}</span>;",
      "  return <span>{String(ready)}{value}</span>;",
    ),
    writes: ["setReady(true);"],
  },
  {
    name: "reports when a setter alias can rearm the marker",
    code: fixture.replace(
      "  return <span>{value}</span>;",
      "  const replaceReady = setReady;\n  return <button onClick={() => replaceReady(false)}>{value}</button>;",
    ),
    writes: ["setReady(true);"],
  },
  {
    name: "reports when a Window event can replace storage",
    code: withSetup(windowProviderOverwrite),
    writes: ["setReady(true);"],
  },
  {
    name: "reports when an evaluated timer can replace storage",
    code: withSetup(timerProviderOverwrite),
    writes: ["setReady(true);"],
  },
  {
    name: "reports when a timer alias can evaluate code",
    code: withSetup(
      `const later = setTimeout;\n${timerProviderOverwrite.replace("setTimeout(", "later(")}`,
    ),
    writes: ["setReady(true);"],
  },
];

describe.each(["curated", "upstream"] as const)(
  "no-adjust-state-on-prop-change browser storage initialization (%s)",
  (portedRuleMode) => {
    it.each(cases)("$name", ({ code, writes }) => {
      const result = runRule(rule, code, {
        filename: "storage-initialization.tsx",
        includeLocations: true,
        settings: { "react-doctor": { portedRuleMode } },
      });
      expect(result.parseErrors).toEqual([]);
      const lines = code.split("\n");
      expect(
        result.diagnostics.map(({ line }) =>
          line === undefined ? undefined : lines[line - 1]?.trim(),
        ),
      ).toEqual(writes);
    });
  },
);
