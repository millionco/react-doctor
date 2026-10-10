import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noAdjustStateOnPropChange } from "./no-adjust-state-on-prop-change.js";

describe("no-adjust-state-on-prop-change — nested resource guards", () => {
  it.each([
    ["nested statements", "if (active) { if (disabled) { TRANSITION } }"],
    ["nested alternate", "if (!active) {} else if (disabled) { TRANSITION }"],
    ["conditional expression", "active ? (disabled ? (TRANSITION) : null) : null;"],
    ["logical expression", "active && (disabled && (TRANSITION));"],
  ])("keeps timer cleanup silent under %s", (_, effectBody) => {
    for (const transition of ["clearTimeout(timer.current), setActive(false)", "stop()"]) {
      const result = runRule(
        noAdjustStateOnPropChange,
        `import { useState, useRef, useCallback, useEffect } from "react";
        function Timer({ disabled }) {
          const [active, setActive] = useState(true);
          const timer = useRef();
          const stop = useCallback(() => {
            clearTimeout(timer.current);
            setActive(false);
          }, []);
          useEffect(() => {
            ${effectBody.replace("TRANSITION", transition)}
          }, [active, disabled, stop]);
          return active;
        }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("follows unconditional cleanup helpers before a ref-guarded state write", () => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useState, useRef, useCallback, useEffect } from "react";
      function Timer({ disabled }) {
        const [active, setActive] = useState(true);
        const activeRef = useRef(true);
        const timer = useRef();
        const cancel = useCallback(() => { clearTimeout(timer.current); }, []);
        const stop = useCallback(() => {
          cancel();
          if (activeRef.current) {
            activeRef.current = false;
            setActive(false);
          }
        }, [cancel]);
        useEffect(() => {
          if (active) {
            if (disabled) stop();
          }
        }, [active, disabled, stop]);
        return active;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    [
      "cleanup after write",
      "if (active) { if (disabled) { setActive(false); clearTimeout(timer.current); } }",
    ],
    [
      "helper cleanup after write",
      "const stop = () => { setActive(false); clearTimeout(timer.current); }; if (active) { if (disabled) { stop(); } }",
    ],
    [
      "nested timer scheduling",
      "if (active) { if (disabled) { setTimeout(advance, 1000); setActive(false); } }",
    ],
    [
      "helper scheduling",
      "const stop = () => { setTimeout(advance, 1000); setActive(false); }; if (active) { if (disabled) { stop(); } }",
    ],
    [
      "conditional helper cleanup",
      "const cancel = () => { if (other) clearTimeout(timer.current); }; const stop = () => { cancel(); setActive(false); }; if (active) { if (disabled) { stop(); } }",
    ],
    [
      "early-return helper cleanup",
      "const cancel = () => { if (other) return; clearTimeout(timer.current); }; const stop = () => { cancel(); setActive(false); }; if (active) { if (disabled) { stop(); } }",
    ],
    [
      "conditional intermediate helper",
      "const cancel = () => clearTimeout(timer.current); const maybeCancel = () => { if (other) cancel(); }; const stop = () => { maybeCancel(); setActive(false); }; if (active) { if (disabled) { stop(); } }",
    ],
    [
      "logical helper cleanup",
      "const cancel = () => other && clearTimeout(timer.current); const stop = () => { cancel(); setActive(false); }; if (active) { if (disabled) { stop(); } }",
    ],
    [
      "discarded state read",
      "if ((active, true)) { if (disabled) { clearTimeout(timer.current); setActive(false); } }",
    ],
    ["pure reset", "if (active) { if (disabled) { setActive(false); } }"],
    [
      "unrelated state guard",
      "if (other) { if (disabled) { clearTimeout(timer.current); setActive(false); } }",
    ],
    [
      "sibling state guard",
      "if (active) {} if (disabled) { clearTimeout(timer.current); setActive(false); }",
    ],
    [
      "conditional cleanup",
      "if (active) { if (disabled) { if (other) { clearTimeout(timer.current); } setActive(false); } }",
    ],
    [
      "cleanup after nested write",
      "if (active) { if (disabled) { if (other) { setActive(false); } clearTimeout(timer.current); } }",
    ],
    [
      "shadowed state",
      "{ const active = other; if (active) { if (disabled) { clearTimeout(timer.current); setActive(false); } } }",
    ],
    [
      "deferred state read",
      "if (Boolean(() => active)) { if (disabled) { clearTimeout(timer.current); setActive(false); } }",
    ],
    [
      "function guard",
      "if (() => active) { if (disabled) { clearTimeout(timer.current); setActive(false); } }",
    ],
    [
      "unreachable state read",
      "if (true || active) { if (disabled) { clearTimeout(timer.current); setActive(false); } }",
    ],
  ])("retains the warning for %s", (_, effectBody) => {
    const result = runRule(
      noAdjustStateOnPropChange,
      `import { useState, useRef, useEffect } from "react";
      function Timer({ disabled }) {
        const [active, setActive] = useState(true);
        const [other] = useState(true);
        const timer = useRef();
        useEffect(() => {
          ${effectBody}
        }, [active, other, disabled]);
        return active;
      }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
