import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import type { Rule } from "../../utils/rule.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface ClosedNavigationCase {
  name: string;
  source: string;
  expectedDiagnostics: number;
}

const cases: ClosedNavigationCase[] = [
  {
    name: "closed-callable-thunk",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "closed-callable-direct",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return unsubscribe;\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "renamed-closed-callable",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const customNavigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  useEffect(() => {\n    const unsubscribe = customNavigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [customNavigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "closed-object-invalid-call",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => ({ remove: () => {} }) };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "closed-object-valid-remove",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => ({ remove: () => {} }) };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe.remove(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "all-return-block",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => { return () => {}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "all-return-conditional",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => { if (flag) return () => {}; return () => {}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "mixed-return",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => { if (flag) return () => {}; return {remove:()=>{}}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "fallthrough",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => { if (flag) return () => {}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "bare-return",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => { if (flag) return; return () => {}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "async-registration",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: async (_event: string, _callback: () => void) => () => {} };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "generator-registration",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: function* (_event: string, _callback: () => void) { return () => {}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "method-replaced-before-effect",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  navigation.addListener = () => ({remove:()=>{}});\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "method-replaced-inside-effect",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  useEffect(() => {\n    navigation.addListener = () => ({remove:()=>{}});\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "computed-write",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  navigation[key] = () => ({remove:()=>{}});\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "object-assign-receiver",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  Object.assign(navigation,{addListener:()=>({remove:()=>{}})});\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "escaped-receiver",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  mutate(navigation);\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "escaped-alias-receiver",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  const alias = navigation; mutate(alias);\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "this-receiver-escape",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: function (_event: string, _callback: () => void) { mutate(this); return () => {}; } };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "eval-mutation",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  eval("navigation.addListener=()=>({remove(){}})");\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "catch-default-eval-mutation",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  try { throw {}; } catch ({ unused = eval("navigation.addListener=()=>({remove(){}})") }) {}\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "inert-eval-key",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  const notes = {eval:"description"};\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "unindexed-catch-default-object-assign",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  try { throw {}; } catch ({ unused = Object.assign(navigation, {addListener:()=>({remove(){}})}) }) {}\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "unindexed-catch-default-member-write",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  try { throw {}; } catch ({ unused = (navigation.addListener = () => ({remove(){}})) }) {}\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "unindexed-catch-default-receiver-escape",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  try { throw {}; } catch ({ unused = mutate(navigation) }) {}\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "inert-navigation-property-key",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  const notes = {navigation:"description"};\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "erased-only-navigation-signature",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  interface Notes { call({navigation}:{navigation:string}): void; }\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 0,
  },
  {
    name: "zero-argument-inner-iife-remains-unsupported",
    source:
      'import { useEffect } from "react";\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: (_event: string, _callback: () => void) => () => {} };\n  useEffect(() => {\n    return (() => { const unsubscribe = navigation.addListener("event", () => {}); return () => unsubscribe(); })();\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "registration-alias-catch-default-write",
    source:
      'import { useEffect } from "react";\nfunction register(){ return()=>{}; }\ntry{throw{}}catch({unused=(register=()=>({remove(){}}))}){}\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: register };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "return-factory-indexed-write",
    source:
      'import { useEffect } from "react";\nfunction createDisposer(){return()=>{};}\ncreateDisposer=()=>({remove(){}});\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: ()=>createDisposer() };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "return-factory-catch-default-write",
    source:
      'import { useEffect } from "react";\nfunction createDisposer(){return()=>{};}\ntry{throw{}}catch({unused=(createDisposer=()=>({remove(){}}))}){}\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: ()=>createDisposer() };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "literal-aliased-registration-unsupported-control",
    source:
      'import { useEffect } from "react";\nfunction register(){return()=>{};}\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: register };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "return-factory-unsupported-control",
    source:
      'import { useEffect } from "react";\nfunction createDisposer(){return()=>{};}\nexport const SubscriptionPanel = () => {\n  const navigation = { addListener: ()=>createDisposer() };\n  useEffect(() => {\n    const unsubscribe = navigation.addListener("event", () => {});\n    return () => { unsubscribe(); };\n  }, [navigation]);\n  return null;\n};\n',
    expectedDiagnostics: 1,
  },
  {
    name: "interface-callable",
    source:
      'import {useEffect} from "react"; export const Collision = () => { interface navigation {} const navigation={addListener:()=>()=>{}}; useEffect(()=>{const unsubscribe=navigation.addListener("event",()=>{}); return()=>unsubscribe();},[navigation]); return null; };',
    expectedDiagnostics: 0,
  },
  {
    name: "interface-noncallable",
    source:
      'import {useEffect} from "react"; export const Collision = () => { interface navigation {} const navigation={addListener:()=>({remove(){}})}; useEffect(()=>{const unsubscribe=navigation.addListener("event",()=>{}); return()=>unsubscribe();},[navigation]); return null; };',
    expectedDiagnostics: 1,
  },
  {
    name: "type-callable",
    source:
      'import {useEffect} from "react"; export const Collision = () => { type navigation=unknown; const navigation={addListener:()=>()=>{}}; useEffect(()=>{const unsubscribe=navigation.addListener("event",()=>{}); return()=>unsubscribe();},[navigation]); return null; };',
    expectedDiagnostics: 0,
  },
  {
    name: "type-noncallable",
    source:
      'import {useEffect} from "react"; export const Collision = () => { type navigation=unknown; const navigation={addListener:()=>({remove(){}})}; useEffect(()=>{const unsubscribe=navigation.addListener("event",()=>{}); return()=>unsubscribe();},[navigation]); return null; };',
    expectedDiagnostics: 1,
  },
];

describe("closed local navigation callable cleanup", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      let didObserveSemanticContext = false;
      const observedRule: Rule = {
        ...effectNeedsCleanup,
        create: (context) => {
          const prototype = Object.getPrototypeOf(context);
          didObserveSemanticContext =
            prototype.constructor.name === "SemanticRuleContext" &&
            typeof Object.getOwnPropertyDescriptor(prototype, "scopes")?.get === "function" &&
            typeof Object.getOwnPropertyDescriptor(prototype, "cfg")?.get === "function";
          return effectNeedsCleanup.create(context);
        },
      };
      const mirror = runRule(effectNeedsCleanup, testCase.source);
      const actual = runRule(wrapWithSemanticContext(observedRule), testCase.source);
      expect(didObserveSemanticContext).toBe(true);
      expect(actual.parseErrors).toEqual([]);
      expect(mirror).toEqual(actual);
      expect(actual.diagnostics).toHaveLength(testCase.expectedDiagnostics);
    });
  }
});
