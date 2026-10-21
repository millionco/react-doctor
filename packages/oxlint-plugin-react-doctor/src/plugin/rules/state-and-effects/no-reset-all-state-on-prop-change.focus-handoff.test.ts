import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { RuleContext } from "../../utils/rule-context.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { noResetAllStateOnPropChange } from "./no-reset-all-state-on-prop-change.js";

import { defineRule } from "../../utils/define-rule.js";
import type { EsTreeNodeOfType } from "../../utils/es-tree-node-of-type.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import {
  getEffectFn,
  getEffectFnRefs,
  getUseStateDecl,
  isSyncStateSetterCall,
} from "./utils/effect/react.js";
import { hasPostcommitFocusRequestConsumption } from "./utils/has-postcommit-focus-request-consumption.js";

interface FocusHandoffCase {
  name: string;
  source: string;
  accepted: boolean;
  checkTarget?: boolean;
  expectedTargetCount?: number;
}

const rowsPanel = `import { useEffect, useRef, useState } from 'react';
const Action = ({ attach, choose }) => <button ref={attach} onClick={choose}>Remove</button>;
export const RowActions = ({ rows }) => {
  const fallback = useRef(null);
  const buttons = useRef(new Map());
  const previousKeys = useRef([]);
  const [ticket, setTicket] = useState(null);
  useEffect(() => {
    const keys = rows?.map(row => row.key) || [];
    if (ticket !== null && rows) {
      const position = Math.min(ticket, rows.length - 1);
      const selected = rows[position];
      const target = selected ? buttons.current.get(selected.key) : null;
      if (target) target.focus();
      else if (fallback.current) fallback.current.focus();
      setTicket(null);
    }
    previousKeys.current = keys;
  }, [rows, ticket]);
  const chooseRow = key => {
    const position = previousKeys.current.indexOf(key);
    if (position >= 0) setTicket(position);
  };
  return <section>
    {rows?.map(row => <Action key={row.key}
      choose={() => chooseRow(row.key)}
      attach={element => {
        if (element) buttons.current.set(row.key, element);
        else buttons.current.delete(row.key);
      }} />)}
    <input ref={fallback} />
  </section>;
};
`;

const action =
  "const Action = ({ attach, choose }) => <button ref={attach} onClick={choose}>Remove</button>;";
const ownedDisplayGetter = `import { useEffect, useRef, useState } from 'react';
let sharedDisplay;
const suppliedRows = {
  get length() { return 1; },
  get 0() {
    sharedDisplay.current = "changed";
    return { key: "chosen" };
  },
  map: transform => [transform({ key: "chosen" })],
};
const Action = ({ attach, choose }) => <button ref={attach} onClick={choose}>Remove</button>;
export const RowActions = ({ rows }) => {
  const display = useRef("");
  sharedDisplay = display;
  const fallback = useRef(null);
  const buttons = useRef(new Map());
  const previousKeys = useRef([]);
  const [ticket, setTicket] = useState(null);
  useEffect(() => {
    const keys = rows?.map(row => row.key) || [];
    if (ticket !== null && rows) {
      const position = Math.min(ticket, rows.length - 1);
      const selected = rows[position];
      const target = selected ? buttons.current.get(selected.key) : null;
      if (target) target.focus();
      else if (fallback.current) fallback.current.focus();
      setTicket(null);
    }
    previousKeys.current = keys;
  }, [rows, ticket]);
  const chooseRow = key => {
    const position = previousKeys.current.indexOf(key);
    if (position >= 0) setTicket(position);
  };
  return <section><output>{display.current}</output>
    {rows?.map(row => <Action key={row.key}
      choose={() => chooseRow(row.key)}
      attach={element => {
        if (element) buttons.current.set(row.key, element);
        else buttons.current.delete(row.key);
      }} />)}
    <input ref={fallback} />
  </section>;
};

export const Example = () => <RowActions rows={suppliedRows} />;
`;

const cases: FocusHandoffCase[] = [
  { name: "accepts private native ref and event forwarding", source: rowsPanel, accepted: true },
  {
    name: "accepts direct intrinsic ref and event callbacks",
    source: rowsPanel
      .replace(action, "")
      .replace("<Action key={row.key}", "<button key={row.key}")
      .replace("choose={() => chooseRow(row.key)}", "onClick={() => chooseRow(row.key)}")
      .replace("attach={element => {", "ref={element => {"),
    accepted: true,
  },
  {
    name: "allows a separate guarded native input value clear",
    source: rowsPanel.replace(
      "  useEffect(() => {",
      "  useEffect(() => { if (fallback.current !== null) fallback.current.value = ''; }, []);\n  useEffect(() => {",
    ),
    accepted: true,
  },
  {
    name: "declines focus replacement through the ref callback parameter",
    source: rowsPanel.replace(
      "if (element) buttons.current.set(row.key, element);",
      "if (element) { element.focus = notify; buttons.current.set(row.key, element); }",
    ),
    accepted: false,
  },
  {
    name: "declines work between focus and consumption",
    source: rowsPanel.replace("      setTicket(null);", "      notify();\n      setTicket(null);"),
    accepted: false,
  },
  {
    name: "declines consumption before focus",
    source: rowsPanel
      .replace(
        "      if (target) target.focus();",
        "      setTicket(null);\n      if (target) target.focus();",
      )
      .replace("      setTicket(null);\n    }", "    }"),
    accepted: false,
  },
  {
    name: "retains directly rendered state",
    source: rowsPanel.replace("<section>", "<section><output>{ticket}</output>"),
    accepted: false,
  },
  {
    name: "retains helper-rendered state",
    source: rowsPanel.replace(
      "  return <section>",
      "  const readTicket = () => ticket;\n  return <section><output>{readTicket()}</output>",
    ),
    accepted: false,
  },
  {
    name: "declines a replaced lookup method",
    source: rowsPanel.replace(
      "  const previousKeys",
      "  buttons.current.get = suppliedLookup;\n  const previousKeys",
    ),
    accepted: false,
  },
  {
    name: "declines an unknown collection callback",
    source: rowsPanel.replace(
      "  const previousKeys",
      "  invalidate(buttons.current);\n  const previousKeys",
    ),
    accepted: false,
  },
  {
    name: "declines a collection alias with foreign elements",
    source: rowsPanel.replace(
      "  const previousKeys",
      "  const mutable = buttons.current;\n  mutable.set('other', {focus: notify});\n  const previousKeys",
    ),
    accepted: false,
  },
  {
    name: "declines manual ref delivery",
    source: rowsPanel.replace(
      action,
      "const Action = ({attach, choose}) => { attach({focus: notify}); return <button ref={attach} onClick={choose}>Remove</button>; };",
    ),
    accepted: false,
  },
  {
    name: "declines an escaped forwarded event",
    source: rowsPanel.replace(
      action,
      "const Action = ({attach, choose}) => { register(choose); return <button ref={attach} onClick={choose}>Remove</button>; };",
    ),
    accepted: false,
  },
  {
    name: "declines deferred primary focus",
    source: rowsPanel.replace(
      "if (target) target.focus();",
      "if (target) queueMicrotask(() => target.focus());",
    ),
    accepted: false,
  },
  {
    name: "does not let a real fallback bless an unknown primary",
    source: rowsPanel.replace(
      "selected ? buttons.current.get(selected.key) : null",
      "selected ? suppliedLookup(selected.key) : null",
    ),
    accepted: false,
  },
  {
    name: "declines fallback current replacement",
    source: rowsPanel.replace(
      "  const previousKeys",
      "  fallback.current = suppliedTarget;\n  const previousKeys",
    ),
    accepted: false,
  },
  {
    name: "declines an opaque state consumer",
    source: rowsPanel.replace("  const chooseRow", "  observe(ticket);\n  const chooseRow"),
    accepted: false,
  },
  {
    name: "declines a later ref or event override",
    source: rowsPanel.replace(
      "<button ref={attach} onClick={choose}>",
      "<button ref={attach} onClick={choose} {...overrides}>",
    ),
    accepted: false,
  },
  {
    name: "declines state passed to a child",
    source: rowsPanel.replace("<Action key={row.key}", "<Action ticket={ticket} key={row.key}"),
    accepted: false,
  },
  {
    name: "declines state returned from the component",
    source: rowsPanel.replace(
      "  return <section>",
      "  if (returnTicket) return ticket;\n  return <section>",
    ),
    accepted: false,
  },
  {
    name: "declines a returned state-reading helper",
    source: rowsPanel.replace(
      "  return <section>",
      "  const readTicket = () => ticket;\n  if (returnReader) return readTicket;\n  return <section>",
    ),
    accepted: false,
  },
  {
    name: "declines state read by another effect",
    source: rowsPanel.replace(
      "  const chooseRow",
      "  useEffect(() => notify(ticket), [ticket]);\n  const chooseRow",
    ),
    accepted: false,
  },
  {
    name: "declines state inside a computed dependency",
    source: rowsPanel.replace("}, [rows, ticket]);", "}, [rows, {ticket}]);"),
    accepted: false,
  },
  {
    name: "declines a type-only React hook import",
    source: rowsPanel.replace("useEffect, useRef, useState", "useEffect, useRef, type useState"),
    accepted: false,
    checkTarget: false,
  },
  {
    name: "declines an unresolved hook spelling",
    source: rowsPanel.replace("useEffect, useRef, useState", "useEffect, useRef"),
    accepted: false,
    checkTarget: false,
  },
  {
    name: "declines a shadowed genuine builtin",
    source: rowsPanel.replace("  const fallback", "  const Math = suppliedMath;\n  const fallback"),
    accepted: false,
    checkTarget: false,
  },
  {
    name: "declines setter escape without a state identifier read",
    source: rowsPanel.replace("  const chooseRow", "  observe(setTicket);\n  const chooseRow"),
    accepted: false,
  },
  {
    name: "declines a functional state updater publication",
    source: rowsPanel.replace(
      "setTicket(position);",
      "setTicket(previous => previous + position);",
    ),
    accepted: false,
  },
  {
    name: "declines an opaque state predicate",
    source: rowsPanel.replace("ticket !== null && rows", "isPending(ticket) && rows"),
    accepted: false,
  },
  {
    name: "declines direct eval while retaining the existing analysis bailout",
    source: rowsPanel.replace("  const chooseRow", "  eval('ticket');\n  const chooseRow"),
    accepted: false,
    expectedTargetCount: 0,
  },
  {
    name: "declines the indexed getter that publishes an owned display ref",
    source: ownedDisplayGetter,
    accepted: false,
  },
  {
    name: "declines a Math result published to another owned ref",
    source: rowsPanel
      .replace("  const fallback", "  const display = useRef('');\n  const fallback")
      .replace("      const selected", "      display.current = position;\n      const selected")
      .replace("<section>", "<section><output>{display.current}</output>"),
    accepted: false,
  },
  {
    name: "declines visible primitive coercion hooks",
    source: "const coercion = {valueOf(){return 1}};\n" + rowsPanel,
    accepted: false,
  },
  {
    name: "declines visible symbol coercion hooks",
    source: "const coercion = {[Symbol.toPrimitive](){return 1}};\n" + rowsPanel,
    accepted: false,
  },
  {
    name: "declines source-visible custom collection dispatch",
    source: "const customRows = {map: transform => []};\n" + rowsPanel,
    accepted: false,
  },
  {
    name: "declines Proxy collection construction",
    source: "const customRows = new Proxy([], {});\n" + rowsPanel,
    accepted: false,
  },
  {
    name: "declines native focus capture callbacks",
    source: rowsPanel.replace(
      "<button ref={attach}",
      "<button onFocusCapture={notify} ref={attach}",
    ),
    accepted: false,
  },
  {
    name: "declines ancestor blur capture callbacks",
    source: rowsPanel.replace("<section>", "<section onBlurCapture={notify}>"),
    accepted: false,
  },
  {
    name: "declines focus handlers transported by a spread",
    source: rowsPanel.replace("<button ref={attach}", "<button {...handlers} ref={attach}"),
    accepted: false,
  },
  {
    name: "declines customized intrinsic buttons",
    source: rowsPanel.replace("<button ref={attach}", "<button is='alternate-button' ref={attach}"),
    accepted: false,
  },
  {
    name: "declines a custom JSX factory pragma",
    source: "/** @jsx customFactory */\n" + rowsPanel,
    accepted: false,
  },
  {
    name: "declines React namespace provider replacement",
    source: "import * as Runtime from 'react';\nRuntime.useRef = factory;\n" + rowsPanel,
    accepted: false,
  },
  {
    name: "declines additional owned memo storage",
    source: rowsPanel
      .replace("useEffect, useRef, useState", "useEffect, useMemo, useRef, useState")
      .replace(
        "  const fallback",
        "  const display = useMemo(() => ({value: ''}), []);\n  const fallback",
      )
      .replace("<section>", "<section><output>{display.value}</output>"),
    accepted: false,
  },
  {
    name: "declines additional reducer-owned storage",
    source: rowsPanel
      .replace("useEffect, useRef, useState", "useEffect, useReducer, useRef, useState")
      .replace(
        "  const fallback",
        "  const [display, publish] = useReducer((prior, next) => next, '');\n  const fallback",
      )
      .replace("<section>", "<section><output>{display}</output>"),
    accepted: false,
  },
  {
    name: "allows the bounded passive router fetcher initializer",
    source:
      "import {useFetcher} from 'react-router';\n" +
      rowsPanel
        .replace(
          "  const fallback",
          "  const fetcher = useFetcher({key: 'sample-request'});\n  const fallback",
        )
        .replace(
          "  useEffect(() => {",
          "  useEffect(() => { if (fetcher.data) { if (fallback.current !== null) fallback.current.value = ''; } }, [fetcher.data]);\n  useEffect(() => {",
        )
        .replace(
          "<input ref={fallback}",
          "<input aria-label={fetcher.state !== 'idle' ? 'Waiting' : 'Ready'} ref={fallback}",
        ),
    accepted: true,
  },
];

const certificateRule = defineRule({
  id: "focus-request-certificate-probe",
  severity: "warn",
  create: (context: RuleContext) => ({
    CallExpression(node: EsTreeNodeOfType<"CallExpression">) {
      const analysis = getProgramAnalysis(node);
      const effect = analysis && getEffectFn(analysis, node);
      const references = analysis && getEffectFnRefs(analysis, node);
      if (!analysis || !effect || !references) return;
      const setters = references.filter((reference) =>
        isSyncStateSetterCall(analysis, reference, effect),
      );
      if (
        setters.length === 1 &&
        hasPostcommitFocusRequestConsumption(node, getUseStateDecl(analysis, setters[0]), context)
      ) {
        context.report({
          node,
          message: "Private effect request is consumed after its selected work.",
        });
      }
    },
  }),
});

describe("postcommit focus request consumption", () => {
  it.each(cases)(
    "$name",
    ({ source, accepted, checkTarget = true, expectedTargetCount = accepted ? 0 : 1 }) => {
      const certificate = runRule(certificateRule, source, { forceJsx: true });
      expect(certificate.parseErrors).toEqual([]);
      expect(certificate.diagnostics).toHaveLength(accepted ? 1 : 0);
      if (!checkTarget) return;
      for (const rule of [
        noResetAllStateOnPropChange,
        {
          ...noResetAllStateOnPropChange,
          create: (context: RuleContext) =>
            wrapWithSemanticContext(noResetAllStateOnPropChange).create(context),
        },
      ]) {
        const result = runRule(rule, source, { forceJsx: true });
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(expectedTargetCount);
      }
    },
  );
});
