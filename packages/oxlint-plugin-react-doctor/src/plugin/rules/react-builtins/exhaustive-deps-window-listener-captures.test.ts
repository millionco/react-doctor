import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { exhaustiveDeps } from "./exhaustive-deps.js";

const coveredSource = `
import { useEffect, useRef, useState } from "react";

export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {
  const field = useRef<HTMLInputElement>(null);
  const [show, setShow] = useState(false);
  const resetFocus = () => {
    field.current?.focus();
  };
  const handleEscape = (event: Event) => {
    if (event instanceof KeyboardEvent && event.key === "Escape" && show) {
      setShow(false);
      resetFocus();
    }
  };
  useEffect(() => {
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [show]);
  return <div><input ref={field} /><button onClick={() => setShow(true)}>Open suggestions</button></div>;
}
`;

const upstream = {
  settings: { "react-doctor": { portedRuleMode: "upstream" } },
};

describe("exhaustive-deps for paired window listener captures", () => {
  it("accepts a listener whose transitive render captures are already declared", () => {
    const curated = runRule(exhaustiveDeps, coveredSource);
    const baseline = runRule(exhaustiveDeps, coveredSource, upstream);
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toEqual([]);
    expect(baseline.parseErrors).toEqual([]);
    expect(baseline.diagnostics).toHaveLength(1);
    expect(baseline.diagnostics[0]?.message).toContain("handleEscape");
  });

  it("retains the behavior of an explicitly listed handler dependency", () => {
    const source = coveredSource.replace("[show]);", "[show, handleEscape]);");
    const curated = runRule(exhaustiveDeps, source);
    const baseline = runRule(exhaustiveDeps, source, upstream);
    expect(curated.parseErrors).toEqual([]);
    expect(baseline.parseErrors).toEqual([]);
    expect(curated.diagnostics).toEqual(baseline.diagnostics);
    expect(curated.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      label: "a transitive render capture",
      edits: [
        ["    field.current?.focus();\n", '    if (mode === "search") field.current?.focus();\n'],
      ],
    },
    {
      label: "another cleanup target",
      edits: [
        [
          '    return () => window.removeEventListener("keydown", handleEscape);\n',
          '    return () => document.removeEventListener("keydown", handleEscape);\n',
        ],
      ],
    },
    {
      label: "different capture flags",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n    return () => window.removeEventListener("keydown", handleEscape);\n',
          '    window.addEventListener("keydown", handleEscape, { capture: true });\n    return () => window.removeEventListener("keydown", handleEscape, { capture: false });\n',
        ],
      ],
    },
    {
      label: "dynamic listener options",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n    return () => window.removeEventListener("keydown", handleEscape);\n',
          '    window.addEventListener("keydown", handleEscape, { capture: mode === "search" });\n    return () => window.removeEventListener("keydown", handleEscape, false);\n',
        ],
      ],
    },
    {
      label: "a shadowed receiver",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          "declare function getListenerTarget(mode: string): EventTarget;\n\nexport function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
        ],
        [
          "  const field = useRef<HTMLInputElement>(null);\n",
          "  const window = getListenerTarget(mode);\n  const field = useRef<HTMLInputElement>(null);\n",
        ],
      ],
    },
    {
      label: "a cleanup event mismatch",
      edits: [
        [
          '    return () => window.removeEventListener("keydown", handleEscape);\n',
          '    return () => window.removeEventListener("keyup", handleEscape);\n',
        ],
      ],
    },
    {
      label: "an escaped handler",
      edits: [
        [
          "  return <div><input ref={field} /><button onClick={() => setShow(true)}>Open suggestions</button></div>;\n",
          "  return <div><input ref={field} /><button onClick={() => { remember(handleEscape); setShow(true); }}>Open suggestions</button></div>;\n",
        ],
      ],
    },
    {
      label: "a deferred callback capture",
      edits: [
        [
          "    field.current?.focus();\n",
          '    queueMicrotask(() => { if (mode === "search") field.current?.focus(); });\n',
        ],
      ],
    },
    {
      label: "implicit per-render arguments",
      edits: [
        [
          "    field.current?.focus();\n",
          '    if (arguments[0].mode === "search") field.current?.focus();\n',
        ],
      ],
    },
    {
      label: "a render-time ref snapshot",
      edits: [
        [
          "  const resetFocus = () => {\n",
          "  const input = field.current;\n  const resetFocus = () => {\n",
        ],
        ["    field.current?.focus();\n", "    input?.focus();\n"],
      ],
    },
    {
      label: "a window alias override",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          'declare const register: Window["addEventListener"];\n\nexport function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n',
        ],
        [
          "  const field = useRef<HTMLInputElement>(null);\n",
          "  window.window.addEventListener = register;\n  const field = useRef<HTMLInputElement>(null);\n",
        ],
      ],
    },
    {
      label: "an EventTarget prototype override",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          'declare const register: EventTarget["addEventListener"];\n\nexport function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n',
        ],
        [
          "  const field = useRef<HTMLInputElement>(null);\n",
          "  EventTarget.prototype.addEventListener = register;\n  const field = useRef<HTMLInputElement>(null);\n",
        ],
      ],
    },
    {
      label: "a helper destructuring fallback",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          "export function Picker({ mode, remember, options }: { mode: string; remember: (listener: EventListener) => void; options: { focus?: () => void } }) {\n",
        ],
        [
          "  const resetFocus = () => {\n    field.current?.focus();\n  };\n",
          "  const { focus: resetFocus = () => field.current?.focus() } = options;\n",
        ],
      ],
    },
    {
      label: "a handler destructuring fallback",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          "export function Picker({ mode, remember, options }: { mode: string; remember: (listener: EventListener) => void; options: { escape?: EventListener } }) {\n",
        ],
        [
          "  const handleEscape = (event: Event) => {\n",
          "  const { escape: handleEscape = (event: Event) => {\n",
        ],
        ["    }\n  };\n", "    }\n  } } = options;\n"],
      ],
    },
    {
      label: "a ref destructuring fallback",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          "export function Picker({ mode, remember, focusFallback }: { mode: string; remember: (listener: EventListener) => void; focusFallback: () => void }) {\n",
        ],
        [
          "  const resetFocus = () => {\n    field.current?.focus();\n  };\n",
          "  const { current: resetFocus = focusFallback } = useRef<(() => void) | undefined>(undefined);\n",
        ],
      ],
    },
    {
      label: "a late initialization",
      edits: [
        [
          "export function Picker({ mode, remember }: { mode: string; remember: (listener: EventListener) => void }) {\n",
          "export function Picker({ mode, remember, disabled }: { mode: string; remember: (listener: EventListener) => void; disabled: boolean }) {\n",
        ],
        ["  const resetFocus = () => {\n    field.current?.focus();\n  };\n", ""],
        [
          "  return <div><input ref={field} /><button onClick={() => setShow(true)}>Open suggestions</button></div>;\n",
          "  if (disabled) return null;\n  const resetFocus = () => {\n    field.current?.focus();\n  };\n  return <div><input ref={field} /><button onClick={() => setShow(true)}>Open suggestions</button></div>;\n",
        ],
      ],
    },
    {
      label: "an escaped transitive helper",
      edits: [
        [
          "  return <div><input ref={field} /><button onClick={() => setShow(true)}>Open suggestions</button></div>;\n",
          "  return <div><input ref={field} /><button onClick={() => { remember(resetFocus); setShow(true); }}>Open suggestions</button></div>;\n",
        ],
      ],
    },
    {
      label: "an active element passed to an opaque member",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n',
          '    const inspector = {\n      contains(target: Element | null) {\n        const view = target?.ownerDocument.defaultView;\n        if (view) {\n          Object.defineProperty(view, "addEventListener", {\n            configurable: true,\n            value(_type: string, listener: EventListener) { remember(listener); },\n          });\n        }\n        return false;\n      },\n    };\n    inspector.contains(document.activeElement);\n  }, [remember]);\n  useEffect(() => {\n    window.addEventListener("keydown", handleEscape);\n',
        ],
      ],
    },
    {
      label: "a direct native code-string timer",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n',
          '    const timer = setTimeout("window.addEventListener = function(type, listener) { window.lastListener = listener; }", 0);\n    return () => clearTimeout(timer);\n  }, []);\n  useEffect(() => {\n    window.addEventListener("keydown", handleEscape);\n',
        ],
      ],
    },
    {
      label: "an escaped native timer binding",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n',
          '    const schedule = setInterval;\n    const timer = schedule("window.addEventListener = function(type, listener) { window.lastListener = listener; }", 25);\n    return () => clearInterval(timer);\n  }, []);\n  useEffect(() => {\n    window.addEventListener("keydown", handleEscape);\n',
        ],
      ],
    },
    {
      label: "a replaced default React provider in interop",
      edits: [
        [
          'import { useEffect, useRef, useState } from "react";\n',
          'import React, { useEffect, useRef, useState } from "react";\n\nconst blankListener = () => {};\n\nObject.defineProperty(React, "useRef", {\n  value<T>(value: T): { current: T } { return { current: value }; },\n});\n',
        ],
        [
          "  const field = useRef<HTMLInputElement>(null);\n",
          "  const latest = useRef(remember);\n  const field = useRef<HTMLInputElement>(null);\n",
        ],
        [
          "    field.current?.focus();\n",
          "    latest.current(blankListener);\n    field.current?.focus();\n",
        ],
      ],
    },
    {
      label: "a replaced React namespace member",
      edits: [
        [
          'import { useEffect, useRef, useState } from "react";\n',
          'import React, { useEffect, useState } from "react";\n\nconst blankListener = () => {};\n\nObject.defineProperty(React, "useRef", {\n  value<T>(value: T): { current: T } { return { current: value }; },\n});\n',
        ],
        [
          "  const field = useRef<HTMLInputElement>(null);\n",
          "  const latest = React.useRef(remember);\n  const field = React.useRef<HTMLInputElement>(null);\n",
        ],
        [
          "    field.current?.focus();\n",
          "    latest.current(blankListener);\n    field.current?.focus();\n",
        ],
      ],
    },
    {
      label: "a native event currentTarget provider escape",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n',
          '    const installRecorder = (event: Event) => {\n      const provider = event.currentTarget;\n      if (provider) {\n        Object.defineProperty(provider, "addEventListener", {\n          configurable: true,\n          value(_type: string, listener: EventListener) { remember(listener); },\n        });\n      }\n    };\n    window.addEventListener("load", installRecorder);\n    return () => window.removeEventListener("load", installRecorder);\n  }, [remember]);\n  useEffect(() => {\n    window.addEventListener("keydown", handleEscape);\n',
        ],
      ],
    },
    {
      label: "a DOM ref owner document provider escape",
      edits: [
        [
          '    window.addEventListener("keydown", handleEscape);\n',
          '    const { ownerDocument } = field.current ?? {};\n    const provider = ownerDocument?.defaultView;\n      if (provider) {\n        Object.defineProperty(provider, "addEventListener", {\n          configurable: true,\n          value(_type: string, listener: EventListener) { remember(listener); },\n        });\n      }\n  }, [remember]);\n  useEffect(() => {\n    window.addEventListener("keydown", handleEscape);\n',
        ],
      ],
    },
  ] satisfies Array<{ label: string; edits: [string, string][] }>)(
    "preserves the listener diagnostic for $label",
    ({ edits }) => {
      const source = edits.reduce(
        (code, [before, after]) => code.replace(before, after),
        coveredSource,
      );
      const curated = runRule(exhaustiveDeps, source);
      const baseline = runRule(exhaustiveDeps, source, upstream);
      expect(curated.parseErrors).toEqual([]);
      expect(baseline.parseErrors).toEqual([]);
      expect(curated.diagnostics).toEqual(baseline.diagnostics);
      expect(curated.diagnostics).toHaveLength(1);
      expect(curated.diagnostics[0]?.message).toContain("handleEscape");
    },
  );
});
