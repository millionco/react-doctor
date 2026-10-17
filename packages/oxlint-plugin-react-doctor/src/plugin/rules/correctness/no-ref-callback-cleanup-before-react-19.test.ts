import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noRefCallbackCleanupBeforeReact19 } from "./no-ref-callback-cleanup-before-react-19.js";

const runRuleForCode = (code: string) =>
  runRule(noRefCallbackCleanupBeforeReact19, code, { filename: "src/tree.tsx" });

describe("no-ref-callback-cleanup-before-react-19", () => {
  it("reports the exact Nteract callback-ref cleanup shape", () => {
    const result = runRuleForCode(`
      const TreeItem = ({ itemRefs, node }) => (
        <li
          ref={(element) => {
            if (element) itemRefs.current.set(node.id, element);
            return () => { itemRefs.current.delete(node.id); };
          }}
        />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("React 18");
  });

  it("reports concise and conditionally returned cleanup functions", () => {
    const result = runRuleForCode(`
      const Examples = ({ remove }) => (
        <>
          <div ref={(node) => () => remove(node)} />
          <span ref={(node) => node ? () => remove(node) : undefined} />
          <button ref={(node) => node && (() => remove(node))} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(3);
  });

  it("reports immutable local callbacks and aliases", () => {
    const result = runRuleForCode(`
      const Component = ({ remove, condition }) => {
        const attach = (node) => {
          return () => remove(node);
        };
        const attachAlias = attach;
        const attachWithoutCleanup = (node) => { remove(node); };
        return (
          <>
            <div ref={attachAlias} />
            <span ref={condition ? attachWithoutCleanup : attach} />
          </>
        );
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports immutable function declaration callbacks and aliases", () => {
    const result = runRuleForCode(`
      const Component = ({ remove }) => {
        const attachAlias = attach;
        return <><div ref={attach} /><span ref={attachAlias} /></>;

        function attach(node) {
          return () => remove(node);
        }
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("reports callbacks stabilized with React useCallback", () => {
    const result = runRuleForCode(`
      import React, { useCallback as useStableCallback } from "react";
      const Component = ({ remove }) => {
        const firstRef = React.useCallback((node) => () => remove(node), [remove]);
        const secondRef = useStableCallback((node) => {
          return () => remove(node);
        }, [remove]);
        return <><div ref={firstRef} /><span ref={secondRef} /></>;
      };
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(2);
  });

  it("stays silent for React 18-compatible null-detach callbacks", () => {
    const result = runRuleForCode(`
      const Component = ({ itemRefs, id }) => (
        <li ref={(element) => {
          if (element) itemRefs.current.set(id, element);
          else itemRefs.current.delete(id);
        }} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not mistake nested function returns for ref callback returns", () => {
    const result = runRuleForCode(`
      const Component = ({ subscribe }) => (
        <div ref={(node) => {
          const register = () => {
            return () => subscribe(node);
          };
          register();
        }} />
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report statically unreachable logical cleanup branches", () => {
    const result = runRuleForCode(`
      const Component = ({ remove }) => (
        <>
          <div ref={(node) => false && (() => remove(node))} />
          <span ref={(node) => true || (() => remove(node))} />
          <button ref={(node) => "attached" ?? (() => remove(node))} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not report statically unreachable conditional cleanup branches", () => {
    const result = runRuleForCode(`
      const safeRef = (node) => { node?.focus(); };
      const Component = ({ remove }) => (
        <>
          <div ref={false ? ((node) => () => remove(node)) : safeRef} />
          <span ref={true ? safeRef : ((node) => () => remove(node))} />
          <button ref={0 ? ((node) => () => remove(node)) : safeRef} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent for unknown, mutable, async, and non-ref callbacks", () => {
    const result = runRuleForCode(`
      import { importedRef } from "./refs";
      let mutableRef = (node) => () => node.remove();
      function reassignedRef(node) { return () => node.remove(); }
      reassignedRef = (node) => { node?.focus(); };
      const handlers = { ref: (node) => () => node.remove() };
      const Component = ({ providedRef }) => (
        <>
          <div ref={importedRef} />
          <div ref={mutableRef} />
          <div ref={reassignedRef} />
          <div ref={handlers.ref} />
          <div ref={providedRef} />
          <div ref={async (node) => () => node.remove()} />
          <div onClick={(event) => () => event.preventDefault()} />
        </>
      );
    `);

    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

const nullDetachCases = [
  {
    name: "direct-late-read-same-action",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "early-null-return-same-action",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (!entry) { slots.current.delete(tileKey); return; } slots.current.set(tileKey, entry); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "callback-local-map-snapshot-with-null-detach",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { const snapshot = slots.current; if (entry) snapshot.set(tileKey, entry); else snapshot.delete(tileKey); return () => { snapshot.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "guarded-return-deferred",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) { slots.current.set(tileKey, entry); return () => { if (slots.current.get(tileKey) === entry) slots.current.delete(tileKey); }; } else slots.current.delete(tileKey); }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "different-null-key",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete("different"); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "missing-null-action",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "additional-returned-action",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); notify(); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "callback-input-key-differs-on-null",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(entry, entry); else slots.current.delete(entry); return () => { slots.current.delete(entry); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "direct-current-write-does-not-change-late-read-identity",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map()); slots.current = new Map(); return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "custom-object-same-declared-action",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = { current: { set() {}, delete() {} } };  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "callback-local-key-recomputed-deferred",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { const localKey = nextKey(); if (entry) slots.current.set(localKey, entry); else slots.current.delete(localKey); return () => { slots.current.delete(localKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "react19-gate-inherited-quiet",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18", "react:19"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "dotted-string-receiver-collision",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots["left.right"].set(tileKey, entry); else slots["left.right"].delete(tileKey); return () => { slots.left.right.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "dotted-string-key-collision",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(slots["left.right"], entry); else slots.current.delete(slots["left.right"]); return () => { slots.current.delete(slots.left.right); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "benign-computed-current-deferred",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots["current"].set(tileKey, entry); else slots["current"].delete(tileKey); return () => { slots["current"].delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "benign-computed-key-deferred",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(slots["id"], entry); else slots.current.delete(slots["id"]); return () => { slots.current.delete(slots["id"]); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "same-literal-string-key",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set("tile", entry); else slots.current.delete("tile"); return () => { slots.current.delete("tile"); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "literal-reference-domain-distinct",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete("tileKey"); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "different-literal-keys",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete("other"); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "different-null-receiver",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.other.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "optional-delete-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current?.delete(tileKey); return () => { slots.current?.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "optional-method-call-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete?.(tileKey); return () => { slots.current.delete?.(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "extra-delete-argument-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey, entry); return () => { slots.current.delete(tileKey, entry); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "spread-delete-argument-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(...[tileKey]); return () => { slots.current.delete(...[tileKey]); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "method-alias-return-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { const release = slots.current.delete; release(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "async-return-action-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return async () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "returned-action-parameter-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return (ignored) => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "extra-null-notification-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else { slots.current.delete(tileKey); notify(); } return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "throw-null-action-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else { slots.current.delete(tileKey); throw new Error("detach"); } return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "custom-component-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <Surface ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</Surface>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "underscore-component-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <_Surface ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</_Surface>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "opaque-trailing-spread-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }} {...props}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "destructured-input-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={({ entry }) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "callback-default-input-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry = null) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "callback-local-prologue-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { const ignored = 0; if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "reassigned-external-key-retained",
    code: 'import * as React from "react";\nconst Tile = () => { let tileKey = "tile"; tileKey = nextKey(); const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "concise-return-action-equivalent",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => slots.current.delete(tileKey); }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "external-member-key-equivalent",
    code: 'import * as React from "react";\nconst Tile = () => { const item = { id: "tile" }; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(item.id, entry); else slots.current.delete(item.id); return () => { slots.current.delete(item.id); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "external-identifier-receiver-equivalent",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.set(tileKey, entry); else slots.delete(tileKey); return () => { slots.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "external-readonly-parameters-equivalent",
    code: "const Tile = ({ slots, item }) => <li ref={(entry) => { if (entry) slots.current.set(item.id, entry); else slots.current.delete(item.id); return () => { slots.current.delete(item.id); }; }}>Tile</li>;",
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "unresolved-receiver-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) missingSlots.current.set(tileKey, entry); else missingSlots.current.delete(tileKey); return () => { missingSlots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "unresolved-key-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(missingKey, entry); else slots.current.delete(missingKey); return () => { slots.current.delete(missingKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "input-root-receiver-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) entry.owner.set(tileKey, entry); else entry.owner.delete(tileKey); return () => { entry.owner.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "mutable-external-receiver-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; let slots = React.useRef(new Map()); slots = nextSlots();  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "bare-undefined-prologue-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { undefined; if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "empty-statement-prologue-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { ; if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "dollar-component-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <$Surface ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</$Surface>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "namespace-component-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <Surface.Item ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</Surface.Item>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "later-explicit-ref-override-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }} ref={otherRef}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "earlier-spread-with-authoritative-ref-equivalent",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li {...props} ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 0,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "different-registration-value-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, anotherEntry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "different-cleanup-method-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.clear(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "returned-cleanup-helper-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map()); const cleanup = () => slots.current.delete(tileKey);  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return cleanup; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "explicit-null-compare-deferred",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry !== null) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "returned-call-receiver-deferred",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { getSlots().delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "input-key-member-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(entry.id, entry); else slots.current.delete(entry.id); return () => { slots.current.delete(entry.id); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "extra-returned-statement-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); undefined; }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "early-null-with-extra-release-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={(entry) => { if (!entry) { slots.current.delete(tileKey); notify(); return; } slots.current.set(tileKey, entry); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
  {
    name: "direct-callback-function-expression-retained",
    code: 'import * as React from "react";\nconst Tile = () => { const tileKey = "tile"; const slots = React.useRef(new Map());  return <li ref={function(entry) { if (entry) slots.current.set(tileKey, entry); else slots.current.delete(tileKey); return () => { slots.current.delete(tileKey); }; }}>Tile</li>; };\n',
    expected: 1,
    settings: {
      "react-doctor": {
        capabilities: ["react", "react:18"],
        portedRuleMode: "curated",
      },
    },
  },
];

describe("matching null-detach actions", () => {
  it.each(nullDetachCases)("$name", ({ code, expected, settings }) => {
    const result = runRule(noRefCallbackCleanupBeforeReact19, code, {
      filename: "src/ref-cleanup.tsx",
      includeLocations: true,
      forceJsx: false,
      settings,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(expected);
  });
});
