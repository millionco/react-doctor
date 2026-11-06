import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noPassDataToParent } from "./no-pass-data-to-parent.js";
import { getOwnedAbortSignalCommandProof } from "./utils/is-owned-abort-signal-command.js";
import { isNodeOfType } from "../../utils/is-node-of-type.js";
import type { Rule } from "../../utils/rule.js";

const cancellationProofRule: Rule = {
  id: "cancellation-command-proof",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (
        isNodeOfType(node.callee, "Identifier") &&
        node.callee.name === "onInspect" &&
        getOwnedAbortSignalCommandProof({
          call: node,
          context,
          isParentCallbackExpression: (expression) =>
            isNodeOfType(expression, "Identifier") &&
            (expression.name === "onInspect" || expression.name === "onResult"),
        })
      ) {
        context.report({ node, message: "Proven cancellation command" });
      }
    },
  }),
};

const directCommand = (body: string, moduleSetup = ""): string => `
import { useEffect } from "react";
import { readRecord, retain, acquireSignal } from "external-source";
${moduleSetup}
export const Panel = ({ onInspect, onResult }) => {
  useEffect(() => {
    const request = new AbortController();
    ${body}
  }, [onInspect, onResult]);
  return null;
};`;

const ownedCommand = (
  body: string,
  componentSetup = "",
  moduleSetup = "",
  refInitializer = "useRef<AbortController | null>(null)",
): string => `
import { useCallback, useEffect, useRef } from "react";
import { readRecord, retain, acquireSignal } from "external-source";
${moduleSetup}
export const Panel = ({ onInspect, onResult }) => {
  const active = ${refInitializer};
  ${componentSetup}
  const begin = useCallback(() => {
    const request = new AbortController();
    active.current = request;
    ${body}
  }, [onInspect, onResult]);
  useEffect(() => { begin(); }, [begin]);
  useEffect(() => () => { active.current?.abort(); }, []);
  return null;
};`;

describe("no-pass-data-to-parent — owned cancellation commands", () => {
  it.each([
    ["direct signal", directCommand("onInspect(request.signal);")],
    [
      "erased types",
      directCommand("onInspect(request.signal);", "interface Erased { constructor: Function; }"),
    ],
    [
      "benign Object API",
      directCommand("onInspect(request.signal);", "const names = Object.keys({});"),
    ],
    ["transparent signal", directCommand("onInspect((request.signal as AbortSignal));")],
    ["local cancellation storage", ownedCommand("onInspect(request.signal);")],
    [
      "erased React namespace",
      ownedCommand("onInspect(request.signal);", "", 'import type * as React from "react";'),
    ],
    [
      "unused default import",
      ownedCommand("onInspect(request.signal);", "", 'import React from "react";'),
    ],
    [
      "renamed ref import",
      ownedCommand("onInspect(request.signal);", "", "", "acquireRef(null)").replace(
        "useRef }",
        "useRef as acquireRef }",
      ),
    ],
    ["later no-argument abort", directCommand("onInspect(request.signal); request.abort();")],
    [
      "identity and aborted guards in settlement closures",
      ownedCommand(`
        const result = onInspect(request.signal);
        result.then(() => {
          if (active.current !== request) return;
          if (request.signal.aborted) return;
          active.current = null;
        });
      `),
    ],
    [
      "truthy ref abort and reset",
      ownedCommand(
        "onInspect(request.signal);",
        "const cancel = () => { if (active.current) { active.current.abort(); active.current = null; } };",
      ),
    ],
  ])("accepts %s", (_description, source) => {
    const result = runRule(noPassDataToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["records local settlement", "state.current = accepted ? 'ready' : 'failed';", "", 0],
    ["forwards actual parent data", "onResult(accepted);", "", 1],
    ["exports the callback with data", "retain({ onResult, accepted });", "", 1],
    [
      "lets a thenable observe child data",
      "state.current = accepted ? 'ready' : 'failed';",
      "return state.current;",
      1,
    ],
  ])(
    "separates a cancellation handoff from a wrapper that %s",
    (_label, settlement, continuation, expected) => {
      const source = `
import { useCallback, useEffect, useRef } from "react";
import { retain } from "external-source";
export const Panel = ({ tabs, onInspect, onResult }) => {
  const hasVisibleTab = tabs.some((tab) => tab.visible);
  const active = useRef<AbortController | null>(null);
  const state = useRef("idle");
  const begin = useCallback(() => {
    if (!hasVisibleTab) return;
    const request = new AbortController();
    active.current = request;
    const completion = onInspect(request.signal);
    const settle = (accepted: boolean) => {
      if (active.current !== request) return;
      ${settlement}
    };
    completion.then(() => { if (!request.signal.aborted) settle(true); ${continuation} });
    completion.catch(() => { if (!request.signal.aborted) settle(false); });
  }, [hasVisibleTab, onInspect, onResult]);
  useEffect(() => { begin(); }, [begin]);
  useEffect(() => () => { active.current?.abort(); }, []);
  return null;
};`;
      const result = runRule(noPassDataToParent, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(expected);
    },
  );

  it("certifies settlement identity and cancellation reads", () => {
    const result = runRule(
      cancellationProofRule,
      ownedCommand(`
      const result = onInspect(request.signal);
      result.then(() => {
        if (active.current !== request) return;
        if (request.signal.aborted) return;
        active.current = null;
      });
    `),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["payload before handoff", "request.abort(readRecord()); onInspect(request.signal);"],
    ["payload after handoff", "onInspect(request.signal); request.abort(readRecord());"],
    [
      "queued payload after handoff",
      "onInspect(request.signal); queueMicrotask(() => request.abort(readRecord()));",
    ],
    ["explicit abort argument", "onInspect(request.signal); request.abort(undefined);"],
    ["prior abort", "request.abort(); onInspect(request.signal);"],
    ["mixed argument tuple", "onInspect(request.signal, readRecord());"],
    ["another data callback", "onInspect(request.signal); onResult(readRecord());"],
    ["same callback with data", "onInspect(request.signal); onInspect(readRecord());"],
    ["another signal handoff", "onInspect(request.signal); onResult(request.signal);"],
    ["controller escape", "retain(request); onInspect(request.signal);"],
    ["signal escape", "retain(request.signal); onInspect(request.signal);"],
    ["controller alias", "const alias = request; onInspect(alias.signal);"],
    ["signal alias", "const signal = request.signal; onInspect(signal);"],
    ["signal wrapper", "onInspect({ signal: request.signal });"],
    ["optional handoff", "onInspect?.(request.signal);"],
    ["computed signal", 'onInspect(request["signal"]);'],
    ["reason forwarding", "onInspect(request.signal); onResult(request.signal.reason);"],
    ["decoration", "request.signal.payload = readRecord(); onInspect(request.signal);"],
    [
      "own signal getter",
      'Object.defineProperty(request, "signal", { get: readRecord }); onInspect(request.signal);',
    ],
    [
      "signal metadata definition",
      'Object.defineProperty(request.signal, "payload", { value: readRecord() }); onInspect(request.signal);',
    ],
  ])("retains %s", (_description, body) => {
    const result = runRule(noPassDataToParent, directCommand(body));
    expect(result.parseErrors).toEqual([]);
    const expectedCount =
      _description === "another signal handoff" ||
      _description === "reason forwarding" ||
      _description === "another data callback" ||
      _description === "same callback with data"
        ? 2
        : 1;
    expect(result.diagnostics).toHaveLength(expectedCount);
  });

  it.each([
    ["ref alias", "onInspect(request.signal);", "const alias = active;"],
    ["ref escape", "onInspect(request.signal);", "retain(active);"],
    ["other ref writer", "onInspect(request.signal);", "active.current = acquireSignal();"],
    ["ref current alias", "onInspect(request.signal); const alias = active.current;", ""],
    [
      "unknown ref member",
      "onInspect(request.signal);",
      "Object.defineProperty(active, 'current', { get: readRecord });",
    ],
    ["ref payload callback", "onInspect(request.signal); onResult(active.current);", ""],
    ["mixed wrapper data", "onInspect(request.signal); onResult(readRecord());", ""],
  ])("retains %s", (_description, body, componentSetup) => {
    const result = runRule(noPassDataToParent, ownedCommand(body, componentSetup));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["signal prototype payload", "AbortSignal.prototype.payload = readRecord();"],
    [
      "signal prototype getter",
      'Object.defineProperty(AbortSignal.prototype, "payload", { get: readRecord });',
    ],
    ["event target prototype payload", "EventTarget.prototype.payload = readRecord();"],
    ["object prototype payload", "Object.prototype.payload = readRecord();"],
    [
      "signal prototype replacement",
      "Object.setPrototypeOf(AbortSignal.prototype, { payload: readRecord() });",
    ],
    [
      "reflective Object capability",
      'const prototype = Reflect.get(Object, "prototype"); prototype.payload = readRecord();',
    ],
    [
      "descriptor EventTarget capability",
      'const prototype = Object.getOwnPropertyDescriptor(EventTarget, "prototype").value; prototype.payload = readRecord();',
    ],
    [
      "aliased Object capability",
      'const NativeObject = Object; const prototype = Reflect.get(NativeObject, "prototype"); prototype.payload = readRecord();',
    ],
    [
      "destructured Object capability",
      "const { prototype } = Object; prototype.payload = readRecord();",
    ],
    [
      "destructured signal capability",
      "const { prototype } = AbortSignal; prototype.payload = readRecord();",
    ],
    ["constructor assignment", "globalThis.AbortController = acquireSignal();"],
    ["prototype write", "AbortController.prototype.abort = readRecord;"],
    ["constructor escape", "retain(AbortController);"],
    ["prototype escape", "retain(AbortController.prototype);"],
    ["prototype alias", "const prototype = Object.getPrototypeOf(new AbortController());"],
    [
      "reflective prototype alias",
      "const prototype = Reflect.getPrototypeOf(new AbortController());",
    ],
    ["legacy prototype alias", "const prototype = (new AbortController()).__proto__;"],
    ["constructor alias", "const constructor = (new AbortController()).constructor;"],
    ["dynamic Function", 'Function("globalThis.AbortController = fake")();'],
  ])("retains native-provider uncertainty from %s", (_description, moduleSetup) => {
    const result = runRule(
      noPassDataToParent,
      directCommand("onInspect(request.signal);", moduleSetup),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "ambient ref provider",
      "globalThis.React = { useRef: () => ({ set current(value) { value.abort(readRecord()); } }) };",
      "React.useRef(null)",
    ],
    [
      "default ref provider",
      'import React from "react"; React.useRef = () => ({ set current(value) { value.abort(readRecord()); } });',
      "React.useRef(null)",
    ],
    [
      "named ref with default provider write",
      'import React from "react"; React.useRef = () => ({ set current(value) { value.abort(readRecord()); } });',
      "useRef(null)",
    ],
    [
      "named ref with namespace exposure",
      'import * as React from "react"; retain(React);',
      "useRef(null)",
    ],
    [
      "named ref with internal dispatcher write",
      'import { __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE as internals } from "react"; internals.H = { useRef: () => ({ set current(value) { value.abort(readRecord()); } }) };',
      "useRef(null)",
    ],
    [
      "named ref with CommonJS provider",
      'const otherReact = require("react"); otherReact.useRef = () => ({ set current(value) { value.abort(readRecord()); } });',
      "useRef(null)",
    ],
    [
      "named ref with dynamic provider",
      'import("react").then((otherReact) => { otherReact.useRef = () => ({ set current(value) { value.abort(readRecord()); } }); });',
      "useRef(null)",
    ],
    [
      "named ref with Node module loader",
      'import { createRequire } from "node:module"; const load = createRequire(import.meta.url); const otherReact = load("react"); otherReact.useRef = readRecord;',
      "useRef(null)",
    ],
    ["named API escape", "retain(useRef);", "useRef(null)"],
  ])("retains %s", (_description, moduleSetup, refInitializer) => {
    const source = ownedCommand("onInspect(request.signal);", "", moduleSetup, refInitializer);
    const result = runRule(noPassDataToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(runRule(cancellationProofRule, source).diagnostics).toEqual([]);
  });

  it.each([
    [
      "imported constructor",
      `import { AbortController } from "external-source";
       import { useEffect } from "react";
       const Panel = ({ onInspect }) => {
         useEffect(() => { const request = new AbortController(); onInspect(request.signal); }, [onInspect]);
       };`,
    ],
    [
      "typed opaque signal",
      `import { useEffect } from "react";
       import { acquireSignal } from "external-source";
       const Panel = ({ onInspect }) => {
         useEffect(() => { const signal: AbortSignal = acquireSignal(); onInspect(signal); }, [onInspect]);
       };`,
    ],
    [
      "cached controller",
      `import { useEffect } from "react";
       const request = new AbortController();
       const Panel = ({ onInspect }) => {
         useEffect(() => { onInspect(request.signal); }, [onInspect]);
       };`,
    ],
  ])("retains %s", (_description, source) => {
    const result = runRule(noPassDataToParent, source);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    'function inspect(eval) { eval("globalThis.changed = true"); }',
    "function inspect(value) { with (value) { changed = true; } }",
  ])("declines valid script dynamic uncertainty", (uncertainty) => {
    const result = runRule(
      cancellationProofRule,
      `const React = require("react");
       ${uncertainty}
       const Panel = ({ onInspect }) => {
         React.useEffect(() => {
           const request = new AbortController();
           onInspect(request.signal);
         }, [onInspect]);
       };`,
      { filename: "cancellation.cjs" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("certifies an ordinary script cancellation call", () => {
    const result = runRule(
      cancellationProofRule,
      `
      const React = require("react");
      const Panel = ({ onInspect }) => {
        React.useEffect(() => {
          const request = new AbortController();
          onInspect(request.signal);
        }, [onInspect]);
      };`,
      { filename: "cancellation.cjs" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    [
      "direct eval",
      directCommand('eval("request.abort(readRecord())"); onInspect(request.signal);'),
    ],
    [
      "parenthesized eval",
      directCommand('(eval)("request.abort(readRecord())"); onInspect(request.signal);'),
    ],
    [
      "nested eval",
      directCommand(
        'onInspect(request.signal); queueMicrotask(() => eval("request.abort(readRecord())"));',
      ),
    ],
    [
      "late ref reason",
      ownedCommand(
        "onInspect(request.signal); queueMicrotask(() => active.current.abort(readRecord()));",
      ),
    ],
  ])(
    "declines certificate for %s independently of callback-emitter coverage",
    (_description, source) => {
      const result = runRule(cancellationProofRule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );
});
