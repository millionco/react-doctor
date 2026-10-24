import { describe, expect, it } from "vite-plus/test";
import type { Rule } from "../../utils/rule.js";
import { runRule } from "../../../test-utils/run-rule.js";
import { isCurrentContextRecordTransition } from "./utils/is-current-context-record-transition.js";
import { CONTEXT_RECORD_EVENT_CALLER_STRESS_LAYER_COUNT } from "./utils/constants.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

const certificateProbe: Rule = {
  id: "current-context-neutral-record-probe",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (isCurrentContextRecordTransition(node, context, "neutral-reset"))
        context.report({ node, message: "current-context neutral record reset" });
    },
  }),
};

const baseSource = `
import { useEffect, useState } from "react";
export const JobStatus = ({ scopeId, load }) => {
  const currentScope = \`scope:\${scopeId}\`;
  const [status, setStatus] = useState({ scope: currentScope, busy: false });
  useEffect(() => {
    setStatus({ scope: currentScope, busy: false });
  }, [currentScope]);
  const start = async () => {
    const snapshot = currentScope;
    setStatus(previous => ({
      scope: snapshot,
      busy: true,
      message: previous.scope === snapshot ? previous.message : undefined,
    }));
    const result = await load();
    setStatus({ scope: snapshot, busy: false, message: result.message });
  };
  const visible = status.scope === currentScope ? status : { busy: false };
  return <section><button onClick={start}>Start</button><span>{visible.busy ? "Busy" : "Ready"}</span><p>{visible.message}</p></section>;
};
`;

const cases = [
  {
    name: "closed record with a captured primitive stamp and neutral projection",
    source: baseSource,
    certificate: true,
  },
  {
    name: "renamed state, selector and discriminator",
    source: baseSource
      .replace(/\bstatus\b/g, "notice")
      .replaceAll("setStatus", "setNotice")
      .replace(/\bscope\b/g, "token")
      .replace(/\bvisible\b/g, "activeNotice"),
    certificate: true,
  },
  {
    name: "explicit undefined payload in all neutral objects",
    source: baseSource.replaceAll("busy: false }", "busy: false, message: undefined }"),
    certificate: true,
  },
  {
    name: "one-return block updater",
    source: baseSource
      .replace("previous => ({", "previous => { return ({")
      .replace("    }));", "    }); });"),
    certificate: true,
  },
  {
    name: "aliased genuine React imports",
    source: baseSource
      .replace("useEffect, useState", "useEffect as effect, useState as state")
      .replaceAll("useEffect(", "effect(")
      .replaceAll("useState(", "state("),
    certificate: true,
  },
  {
    name: "closed useCallback callers and passive dependency references",
    source: baseSource
      .replace("useEffect, useState", "useCallback, useEffect, useState")
      .replace("const start = async () => {", "const start = useCallback(async () => {")
      .replace(
        "  };\n  const visible =",
        "  }, [currentScope, load]);\n  const click = useCallback(() => { void start(); }, [start]);\n  const visible =",
      )
      .replace("onClick={start}", "onClick={click}"),
    certificate: true,
  },
  {
    name: "an async useCallback writer is called synchronously during render",
    source: baseSource
      .replace("useEffect, useState", "useCallback, useEffect, useState")
      .replace("const start = async () => {", "const start = useCallback(async () => {")
      .replace(
        "  };\n  const visible =",
        "  }, [currentScope, load]);\n  if (scopeId === 'next') void start();\n  const visible =",
      ),
    certificate: false,
  },
  {
    name: "a conditional event-prop reference has no synchronous invocation",
    source: baseSource.replace("onClick={start}", "onClick={load ? start : undefined}"),
    certificate: true,
  },
  {
    name: "normal function writers are outside the closed arrow grammar",
    source: baseSource.replace(
      "const start = async () => {",
      "const start = async function inner() {",
    ),
    certificate: false,
  },
  {
    name: "a normal function self-name escapes beyond its outer event binding",
    source:
      "let saved;\n" +
      baseSource
        .replace(
          "const start = async () => {",
          "const start = async function inner() {\n    saved = inner;",
        )
        .replace(
          "  const visible =",
          "  if (scopeId === 'next' && saved) void saved();\n  const visible =",
        ),
    certificate: false,
  },
  {
    name: "raw payload remains visible",
    source: baseSource.replace("{visible.message}", "{status.message}"),
    certificate: false,
  },
  {
    name: "comparison result remains visible",
    source: baseSource.replace("<section>", "<section aria-busy={status.scope === currentScope}>"),
    certificate: false,
  },
  {
    name: "raw record escapes",
    source: baseSource.replace("  const visible =", "  load(status);\n  const visible ="),
    certificate: false,
  },
  {
    name: "projected record escapes",
    source: baseSource.replace("  return <section>", "  load(visible);\n  return <section>"),
    certificate: false,
  },
  {
    name: "projected payload is mutated",
    source: baseSource.replace("  return <section>", "  visible.busy = true;\n  return <section>"),
    certificate: false,
  },
  {
    name: "projected stamp is visible",
    source: baseSource.replace("{visible.message}", "{visible.scope}"),
    certificate: false,
  },
  {
    name: "neutral busy defaults differ",
    source: baseSource.replace("? status : { busy: false }", "? status : { busy: true }"),
    certificate: false,
  },
  {
    name: "omitted and defined payload defaults differ",
    source: baseSource.replace(
      "? status : { busy: false }",
      '? status : { busy: false, message: "old" }',
    ),
    certificate: false,
  },
  {
    name: "selector compares a different key",
    source: baseSource.replace(
      "status.scope === currentScope ? status",
      "status.scope === scopeId ? status",
    ),
    certificate: false,
  },
  {
    name: "loose comparison is unsupported",
    source: baseSource.replace("status.scope === currentScope", "status.scope == currentScope"),
    certificate: false,
  },
  {
    name: "the false branch exposes the old record",
    source: baseSource.replace("? status : { busy: false }", "? { busy: false } : status"),
    certificate: false,
  },
  {
    name: "a typed parameter does not establish a primitive stamp",
    source: baseSource.replace(
      "const currentScope = `scope:${scopeId}`;",
      "const currentScope = scopeId;",
    ),
    certificate: false,
  },
  {
    name: "numeric stamps do not inherit the string proof",
    source: baseSource.replace(
      "const currentScope = `scope:${scopeId}`;",
      "const currentScope = Number(scopeId);",
    ),
    certificate: false,
  },
  {
    name: "mutable current stamp",
    source: baseSource.replace("const currentScope =", "let currentScope ="),
    certificate: false,
  },
  {
    name: "mutable callback snapshot",
    source: baseSource.replace("const snapshot =", "let snapshot ="),
    certificate: false,
  },
  {
    name: "captured snapshot is reassigned",
    source: baseSource.replace(
      "    const result = await load();",
      '    snapshot = "other";\n    const result = await load();',
    ),
    certificate: false,
  },
  {
    name: "state writer returns an unknown record",
    source: baseSource.replace(
      "setStatus({ scope: snapshot, busy: false, message: result.message });",
      "setStatus(result);",
    ),
    certificate: false,
  },
  {
    name: "state setter escapes",
    source: baseSource.replace("await load()", "await load(setStatus)"),
    certificate: false,
  },
  {
    name: "an updater returns the previous record",
    source: baseSource.replace("setStatus(previous => ({", "setStatus(previous => previous || ({"),
    certificate: false,
  },
  {
    name: "an updater returns null",
    source: baseSource.replace(
      "setStatus(previous => ({",
      "setStatus(previous => scopeId ? null : ({",
    ),
    certificate: false,
  },
  {
    name: "an updater reads an unguarded old payload",
    source: baseSource.replace(
      "previous.scope === snapshot ? previous.message : undefined",
      "previous.message",
    ),
    certificate: false,
  },
  {
    name: "an updater compares another stamp",
    source: baseSource.replace("previous.scope === snapshot", "previous.scope === scopeId"),
    certificate: false,
  },
  {
    name: "an updater leaks its previous record",
    source: baseSource.replace(
      "previous.scope === snapshot ? previous.message : undefined",
      "load(previous)",
    ),
    certificate: false,
  },
  {
    name: "the effect has an additional statement",
    source: baseSource.replace(
      "    setStatus({ scope: currentScope, busy: false });",
      "    load();\n    setStatus({ scope: currentScope, busy: false });",
    ),
    certificate: false,
  },
  {
    name: "the effect has another dependency",
    source: baseSource.replace("}, [currentScope]);", "}, [currentScope, load]);"),
    certificate: false,
  },
  {
    name: "an async effect is unsupported",
    source: baseSource.replace("useEffect(() =>", "useEffect(async () =>"),
    certificate: false,
  },
  {
    name: "a spread record is unsupported",
    source: baseSource.replaceAll(
      "{ scope: currentScope, busy: false }",
      "{ ...{}, scope: currentScope, busy: false }",
    ),
    certificate: false,
  },
  {
    name: "a visible inherited payload getter defeats omission equivalence",
    source:
      'Object.defineProperty(Object.prototype, "message", { get() { return this.scope; } });\n' +
      baseSource,
    certificate: false,
  },
  {
    name: "prototype capability transport is unsupported",
    source: "const mutate = Reflect.setPrototypeOf;\n" + baseSource,
    certificate: false,
  },
  {
    name: "an unobserved fallback property performs a render update",
    source: baseSource.replace(
      "? status : { busy: false }",
      "? status : { busy: false, extra: setStatus({ scope: currentScope, busy: true }) }",
    ),
    certificate: false,
  },
  {
    name: "a direct conditional render update changes the neutral payload",
    source: baseSource.replace(
      "  const visible =",
      "  if (scopeId === 'next') setStatus({ scope: currentScope, busy: true });\n  const visible =",
    ),
    certificate: false,
  },
  {
    name: "an event-shaped helper is called during render",
    source: baseSource.replace(
      "  const visible =",
      "  if (scopeId === 'next') start();\n  const visible =",
    ),
    certificate: false,
  },
  {
    name: "a writer is transported through an unresolved callback role",
    source: baseSource.replace("  const visible =", "  load(start);\n  const visible ="),
    certificate: false,
  },
  {
    name: "an inherited method can expose the projected receiver",
    source: baseSource.replace("{visible.message}", "{visible.valueOf().scope}"),
    certificate: false,
  },
  {
    name: "a projected method can observe the record as its receiver",
    source: baseSource.replace("{visible.message}", "{visible.message()}"),
    certificate: false,
  },
  {
    name: "custom hook providers are unsupported",
    source: baseSource.replace('from "react"', 'from "./hooks"'),
    certificate: false,
  },
];

describe("current-context neutral record resets", () => {
  it("checks shared event-caller graphs without expanding every path", () => {
    const layers = Array.from(
      { length: CONTEXT_RECORD_EVENT_CALLER_STRESS_LAYER_COUNT },
      (_, index) => {
        const previousLeft = index === 0 ? "start" : `left${index}`;
        const previousRight = index === 0 ? "start" : `right${index}`;
        return `const left${index + 1} = () => { ${previousLeft}(); ${previousRight}(); }; const right${index + 1} = () => { ${previousLeft}(); ${previousRight}(); };`;
      },
    ).join("\n");
    const source = baseSource
      .replace("  const visible =", `${layers}\n  const visible =`)
      .replace(
        "onClick={start}",
        `onClick={left${CONTEXT_RECORD_EVENT_CALLER_STRESS_LAYER_COUNT}} onPointerDown={right${CONTEXT_RECORD_EVENT_CALLER_STRESS_LAYER_COUNT}}`,
      );
    const result = runRule(certificateProbe, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(cases)("$name", ({ source, certificate }) => {
    const result = runRule(certificateProbe, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(certificate ? 1 : 0);
  });

  it("keeps a fully masked record reset quiet", () => {
    const result = runRule(noResetAllStateOnPropChange, baseSource);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an unmasked reset warning", () => {
    const result = runRule(
      noResetAllStateOnPropChange,
      baseSource.replace("{visible.message}", "{status.message}"),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
