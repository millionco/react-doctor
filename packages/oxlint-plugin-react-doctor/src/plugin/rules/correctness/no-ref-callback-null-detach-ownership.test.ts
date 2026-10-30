import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

interface NullDetachOwnershipCase {
  name: string;
  code: string;
}

const guardedCallback = `node => {
  if (node) {
    entries.current.set("shared", node);
    return () => {
      if (entries.current.get("shared") === node) entries.current.delete("shared");
    };
  } else entries.current.delete("shared");
}`;

const guardedCases: ReadonlyArray<NullDetachOwnershipCase> = [
  {
    name: "repeated callbacks with one literal key",
    code: `import { useRef } from "react";
      export const Panel = ({ rows }) => {
        const entries = useRef(new Map());
        return rows.map(row => <section key={row} ref={${guardedCallback}} />);
      };`,
  },
  {
    name: "a single fixed node cloned by its consumer",
    code: `import { cloneElement, useRef, useState } from "react";
      const Duplicate = ({ child }) => {
        const [showEarlier, setShowEarlier] = useState(true);
        return <>
          {showEarlier ? cloneElement(child, { key: "earlier" }) : null}
          {cloneElement(child, { key: "later" })}
          <button onClick={() => setShowEarlier(false)}>Remove earlier</button>
        </>;
      };
      export const Panel = () => {
        const entries = useRef(new Map());
        const child = <section ref={${guardedCallback}} />;
        return <Duplicate child={child} />;
      };`,
  },
  {
    name: "a nested renderer sharing its outer owner's Map",
    code: `import { useRef } from "react";
      export const Panel = () => {
        const entries = useRef(new Map());
        const Entry = () => <section ref={${guardedCallback}} />;
        return <><Entry /><Entry /></>;
      };`,
  },
  {
    name: "a retained sibling observed after an earlier detachment",
    code: `import { useLayoutEffect, useRef, useState } from "react";
      const Retain = ({ children, observe }) => {
        const [showEarlier, setShowEarlier] = useState(true);
        useLayoutEffect(() => { observe(); }, [showEarlier, observe]);
        return <>
          {showEarlier ? children[0] : null}
          {children[1]}
          <button onClick={() => setShowEarlier(false)}>Remove earlier</button>
        </>;
      };
      export const Panel = () => {
        const entries = useRef(new Map());
        const observe = () => { entries.current.get("shared")?.focus(); };
        return <Retain observe={observe}>
          {["earlier", "later"].map(row => <section key={row} tabIndex={-1} ref={${guardedCallback}} />)}
        </Retain>;
      };`,
  },
  {
    name: "an identity guard despite a readonly key snapshot",
    code: `import { useRef } from "react";
      export const Panel = ({ rows }) => {
        const entries = useRef(new Map());
        const entryKey = "shared";
        return rows.map(row => <section key={row} ref={node => {
          if (node) {
            entries.current.set(entryKey, node);
            return () => {
              if (entries.current.get(entryKey) === node) entries.current.delete(entryKey);
            };
          } else entries.current.delete(entryKey);
        }} />);
      };`,
  },
];

const equivalentCases: ReadonlyArray<NullDetachOwnershipCase> = [
  {
    name: "the same unconditional delete",
    code: `import { useRef } from "react";
      export const Panel = () => {
        const entries = useRef(new Map());
        return <section ref={node => {
          if (node) entries.current.set("shared", node);
          else entries.current.delete("shared");
          return () => entries.current.delete("shared");
        }} />;
      };`,
  },
  {
    name: "an owned callback-local Map snapshot",
    code: `import { useRef } from "react";
      export const Panel = () => {
        const entries = useRef(new Map());
        return <section ref={node => {
          const snapshot = entries.current;
          if (node) snapshot.set("shared", node);
          else snapshot.delete("shared");
          return () => snapshot.delete("shared");
        }} />;
      };`,
  },
  {
    name: "an early null-detach return",
    code: `import { useRef } from "react";
      export const Panel = () => {
        const entries = useRef(new Map());
        return <section ref={node => {
          if (!node) { entries.current.delete("shared"); return; }
          entries.current.set("shared", node);
          return () => entries.current.delete("shared");
        }} />;
      };`,
  },
];

describe("callback-ref null-detach ownership", () => {
  it.each(guardedCases)("keeps the React 18 warning for $name", ({ code }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, {
      filename: "src/panel.tsx",
      settings: { "react-doctor": { capabilities: ["react", "react:18"] } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(equivalentCases)("preserves $name", ({ code }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, {
      filename: "src/panel.tsx",
      settings: { "react-doctor": { capabilities: ["react", "react:18"] } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(guardedCases)("keeps the React 19 capability gate for $name", ({ code }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, {
      filename: "src/panel.tsx",
      settings: { "react-doctor": { capabilities: ["react", "react:18", "react:19"] } },
    });

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
