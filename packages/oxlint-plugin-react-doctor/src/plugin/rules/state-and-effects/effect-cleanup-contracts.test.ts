import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { Rule } from "../../utils/rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";
import { noChainStateUpdates } from "./no-chain-state-updates.js";
import { noEffectEventHandler } from "./no-effect-event-handler.js";
import { noEventHandler } from "./no-event-handler.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";

interface CleanupExemptRuleCase {
  readonly rule: Rule;
  readonly buildCode: (cleanup: string) => string;
}

const NO_OP_CLEANUPS = [
  ["an empty arrow", "return () => {};"],
  ["an empty arrow with an unused identifier parameter", "return (_unused) => {};"],
  ["a parenthesized const binding to an empty arrow", "const noop = (() => {}); return noop;"],
  [
    "a const empty function behind TypeScript assertions",
    "const noop = ((() => {}) as (() => void)) satisfies (() => void); return noop;",
  ],
  ["an empty function expression", "return function () {};"],
  ["an arrow returning undefined", "return () => undefined;"],
  ["an arrow returning void 0", "return () => void 0;"],
  ["a binding to an empty arrow", "const noop = () => {};\nreturn noop;"],
  ["an empty arrow behind a conditional", "return isEnabled ? () => {} : undefined;"],
  ["an arrow that only reads a binding", "const isEnabled = true; return () => { isEnabled; };"],
  ["an arrow returning a binding", "const isEnabled = true; return () => isEnabled;"],
  ["an arrow returning void of a binding", "const isEnabled = true; return () => void isEnabled;"],
  ["an async arrow returning intrinsic undefined", "return async () => undefined;"],
  [
    "an async arrow discarding a thenable binding",
    "const cleanupValue = { get then() { dispose(); return undefined; } }; return async () => void cleanupValue;",
  ],
  [
    "an async block that only reads a thenable binding",
    "const cleanupValue = { get then() { dispose(); return undefined; } }; return async () => { cleanupValue; };",
  ],
];

const CLEANUP_EXEMPT_RULE_CASES: Record<string, CleanupExemptRuleCase> = {
  "no-adjust-state-on-prop-change": {
    rule: noAdjustStateOnPropChange,
    buildCode: (cleanup) => `function Selection({ itemId, cache }) {
      const [selection, setSelection] = useState(null);
      useEffect(() => {
        setSelection(null);
        cache.get(itemId);
        ${cleanup}
      }, [itemId, cache]);
      return selection;
    }`,
  },
  "no-chain-state-updates": {
    rule: noChainStateUpdates,
    buildCode: (cleanup) => `function Editor() {
      const editorRef = useRef(null);
      const [editor, setEditor] = useState(null);
      useEffect(() => {
        if (editor) return;
        setEditor(createEditor(editorRef.current));
        ${cleanup}
      }, [editor]);
      return <div ref={editorRef} />;
    }`,
  },
  "no-effect-event-handler": {
    rule: noEffectEventHandler,
    buildCode: (cleanup) => `import { useEffect } from "react";
    const Checkout = ({ status }) => {
      useEffect(() => {
        if (status !== "submitted") return;
        toast("Order submitted!");
        ${cleanup}
      }, [status]);
      return null;
    };`,
  },
  "no-event-handler": {
    rule: noEventHandler,
    buildCode: (cleanup) => `function Toast({ onShow }) {
      const [visible, setVisible] = useState(false);
      useEffect(() => {
        if (visible) setTimeout(() => onShow(), 0);
        ${cleanup}
      }, [visible, onShow]);
      return <button onClick={() => setVisible(true)} />;
    }`,
  },
  "no-pass-data-to-parent": {
    rule: noPassDataToParent,
    buildCode: (cleanup) => `import { useEffect } from "react";
    export const MultiSelectField = ({ onPendingChange }) => {
      const values = useSelectedValues();
      useEffect(() => {
        onPendingChange(values);
        ${cleanup}
      }, [onPendingChange, values]);
      return null;
    };`,
  },
};

describe.each(Object.entries(CLEANUP_EXEMPT_RULE_CASES))(
  "%s cleanup exemption",
  (_, { rule, buildCode }) => {
    it.each(NO_OP_CLEANUPS)("still reports when the effect returns %s", (_, cleanup) => {
      const result = runRule(rule, buildCode(cleanup), { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it.each([
      "return () => { cleanupSignal; };",
      "return () => cleanupSignal;",
      "return () => void cleanupSignal;",
    ])("retains a cleanup that reads a global accessor: %s", (cleanup) => {
      const source = `Object.defineProperty(globalThis, "cleanupSignal", {
        get() { connection.close(); }
      });\n${buildCode(cleanup)}`;
      const result = runRule(rule, source, { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      "declare const cleanupSignal: unknown;",
      'import type { cleanupSignal } from "cleanup-types";',
    ])("does not treat an erased binding as a local cleanup read: %s", (declaration) => {
      const result = runRule(rule, `${declaration}\n${buildCode("return () => cleanupSignal;")}`, {
        forceJsx: true,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });

    it.each([
      ["a cleanup that does work", "return () => { cancelled = true; };"],
      [
        "an async cleanup that adopts a thenable binding",
        "const cleanupValue = { get then() { dispose(); return undefined; } }; return async () => cleanupValue;",
      ],
      [
        "an async cleanup that adopts a thenable through a type assertion",
        "const cleanupValue = { get then() { dispose(); return undefined; } }; return async () => (cleanupValue as unknown);",
      ],
      [
        "an async cleanup returning a thenable named undefined",
        "const undefined = { get then() { dispose(); return void 0; } }; return async () => undefined;",
      ],
      ["a cleanup that reads a member", "return () => { connection.state; };"],
      ["a disposer call opposite an empty arrow", "return isEnabled ? subscribe() : () => {};"],
      [
        "a mutable binding replaced by a working arrow",
        "let cleanup = () => {}; cleanup = () => { cancelled = true; }; return cleanup;",
      ],
      [
        "a mutable binding replaced by a disposer call",
        "let cleanup = () => {}; cleanup = subscribe(); return cleanup;",
      ],
      ["a cleanup with default-parameter work", "return (_unused = dispose()) => {};"],
      ["a cleanup with destructuring-default work", "return ({ unused = dispose() } = {}) => {};"],
      [
        "a disposer call opposite a named empty function",
        "const noop = () => {}; return isEnabled ? subscribe() : noop;",
      ],
      [
        "an unrelated useCallback factory returning a working cleanup",
        "const api = { useCallback: () => () => { cancelled = true; } }; const cleanup = api.useCallback(() => {}); return cleanup;",
      ],
    ])("stays silent when the effect returns %s", (_, cleanup) => {
      const result = runRule(rule, buildCode(cleanup), { forceJsx: true });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    });
  },
);
