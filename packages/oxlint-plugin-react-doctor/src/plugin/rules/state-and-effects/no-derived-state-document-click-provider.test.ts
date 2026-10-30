import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { defineRule } from "../../utils/define-rule.js";
import { getProgramAnalysis } from "./utils/effect/get-program-analysis.js";
import { hasFiniteDocumentListenerProvider } from "./utils/has-finite-document-listener-provider.js";
import { noDerivedState } from "./no-derived-state.js";
import { noDerivedStateEffect } from "./no-derived-state-effect.js";

const providerAttacks = [
  "target.addEventListener = () => false;",
  "target.addEventListener++;",
  "delete target.addEventListener;",
  "target.removeEventListener = () => false;",
  "target.removeEventListener++;",
  "delete target.removeEventListener;",
  "const extract = target.addEventListener;",
  "const { addEventListener: extract } = target;",
  "const { removeEventListener: extract } = target;",
  "platform.document.addEventListener++;",
  "delete platform.document.addEventListener;",
  "operations.defineProperty(target, 'addEventListener', { value: () => false });",
  "operations.assign(target, { addEventListener: () => false });",
  "operations.set(target, 'addEventListener', () => false);",
  "operations.deleteProperty(target, 'addEventListener');",
  "operations.setPrototypeOf(target, {});",
  "consume(globalThis);",
  "consume(self);",
  "consume(global);",
  "const { globalThis: root } = platform; consume(root);",
  "declare const globalThis: object; consume(globalThis);",
  "declare const self: object; consume(self);",
  "const { document: localDocument } = platform; localDocument.addEventListener = () => false;",
  "const { document: localDocument } = platform; delete localDocument.addEventListener;",
  "operations.defineProperties(target, { addEventListener: { value: () => false } });",
  "const dispatch = target.dispatchEvent; dispatch();",
  "const block = (event) => event.stopImmediatePropagation(); document.addEventListener('click', block);",
  "const block = (event) => event.stopImmediatePropagation(); useEffect(() => { document.addEventListener('click', block); return () => document.removeEventListener('click', block); }, [block]);",
];

const buildSource = (attack: string): string => `
import { useState, useEffect } from 'react';
const Panel = ({ expanded, target, platform, operations, consume }) => {
  const [visible, setVisible] = useState(false);
  ${attack}
  const close = () => setVisible(false);
  const dismiss = () => close();
  useEffect(() => {
    document.addEventListener('click', dismiss);
    return () => document.removeEventListener('click', dismiss);
  }, [dismiss]);
  useEffect(() => setVisible(expanded), [expanded]);
  return <aside>{visible ? 'open' : 'closed'}</aside>;
};`;

const providerCases = [
  ...providerAttacks.map((attack) => ({ attack, source: buildSource(attack) })),
  {
    attack: "type-only React hooks",
    source: buildSource("").replace(
      "import { useState, useEffect }",
      "import type { useState, useEffect }",
    ),
  },
  {
    attack: "type-only React useEffect",
    source: buildSource("").replace(
      "import { useState, useEffect }",
      "import { useState, type useEffect }",
    ),
  },
  {
    attack: "namespace React mutation",
    source: buildSource("ReactProvider.useEffect = () => false;").replace(
      "const Panel =",
      "import * as ReactProvider from 'react'; const Panel =",
    ),
  },
  { attack: "escaped React hook", source: buildSource("consume(useEffect);") },
];

describe("closed document listener provider", () => {
  it.each(providerCases)("rejects provider capability: $attack", ({ source }) => {
    let providerAccepted: boolean | undefined;
    const rule = defineRule({
      id: "document-provider-direct-check",
      title: "Document provider direct check",
      severity: "warn",
      recommendation: "Check the provider certificate directly.",
      create: (context) => ({
        Program(program) {
          const analysis = getProgramAnalysis(program);
          if (!analysis) throw new Error("Missing program analysis");
          providerAccepted = hasFiniteDocumentListenerProvider(analysis, context);
        },
      }),
    });
    expect(runRule(rule, source).parseErrors).toEqual([]);
    expect(providerAccepted).toBe(false);
    for (const derivedRule of [noDerivedState, noDerivedStateEffect]) {
      const result = runRule(derivedRule, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics, derivedRule.id).toHaveLength(1);
    }
  });
});
