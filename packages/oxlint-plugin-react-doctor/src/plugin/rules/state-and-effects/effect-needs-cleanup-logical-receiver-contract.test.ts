import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { wrapWithSemanticContext } from "../../utils/wrap-with-semantic-context.js";
import { effectNeedsCleanup } from "./effect-needs-cleanup.js";

interface LogicalReceiverContractCase {
  name: string;
  declarations?: string;
  setup?: string;
  receiver?: string;
  effectSetup?: string;
  cleanup?: string;
  expectedCount: number;
}

const declaredProvider = `interface Navigation {
  addListener: (event: string, handler: () => void) => () => void;
  getParent: () => Navigation | undefined;
}
declare function getNavigation(): Navigation;`;
const importedProvider = `import { useNavigation } from "@react-navigation/native";`;
const logicalReceiverContractCases: LogicalReceiverContractCase[] = [
  {
    name: "accepts the explicit ambient callable-return contract without relying on names",
    declarations: declaredProvider,
    setup: "const receiver = getNavigation();",
    receiver: "receiver.getParent() ?? receiver",
    expectedCount: 0,
  },
  {
    name: "accepts returning an imported navigation disposer directly",
    cleanup: "return unsubscribe;",
    expectedCount: 0,
  },
  {
    name: "accepts the owned issue 1956 renamed ambient receiver",
    declarations: declaredProvider,
    setup: "const coveredNavigation = getNavigation();",
    receiver: "coveredNavigation",
    expectedCount: 0,
  },
  {
    name: "rejects ambient any instead of guessing from the navigation name",
    declarations: "declare function getNavigation(): any;",
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects an initialized navigation object returning a subscription object",
    setup: "const navigation = { addListener: () => ({ remove: () => {} }) };",
    expectedCount: 1,
  },
  {
    name: "rejects a runtime factory despite its navigation name",
    setup:
      "const getNavigation = () => ({ addListener: () => ({ remove: () => {} }) }); const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects an imported EventEmitter named navigation",
    declarations: 'import { EventEmitter } from "node:events";',
    setup: "const navigation = new EventEmitter();",
    expectedCount: 1,
  },
  {
    name: "rejects a mixed unknown provider branch",
    receiver: "opaque ?? navigation",
    expectedCount: 1,
  },
  {
    name: "rejects a DOM listener return value",
    receiver: "window ?? document",
    effectSetup: "const unsubscribe = (window ?? document).addEventListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects assigning another provider to a logical receiver alias",
    effectSetup:
      "let target = navigation ?? navigation; target = opaque; const unsubscribe = target.addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects listener method writes through a receiver alias",
    effectSetup:
      "const alias = navigation; alias.addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects parent method writes through a receiver alias",
    effectSetup:
      "const alias = navigation; alias.getParent = () => opaque; const unsubscribe = (navigation.getParent() ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects recomputed member receivers mutated through an alias",
    effectSetup:
      "const handler = () => {}; (opaque.first || opaque.second).on('focus', handler); const alias = opaque; alias.first = navigation;",
    cleanup: "return () => (opaque.first || opaque.second).off('focus', handler);",
    expectedCount: 1,
  },
  {
    name: "rejects Object.assign mutations to a declared provider",
    declarations: declaredProvider,
    setup: "const navigation = getNavigation();",
    effectSetup:
      "Object.assign(navigation, {addListener: () => ({remove() {}})}); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects Reflect.set mutations to an imported provider",
    effectSetup:
      "Reflect.set(navigation, 'addListener', () => ({remove() {}})); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects Object.defineProperty mutations to an imported provider",
    effectSetup:
      "Object.defineProperty(navigation, 'addListener', {value: () => ({remove() {}})}); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects synchronous helper mutations through provider aliases",
    effectSetup:
      "const alias = navigation; const replace = (target) => { target.addListener = () => ({remove() {}}); }; replace(alias); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects reacquiring a subscription through a cleanup helper",
    cleanup:
      "const cleanup = () => { unsubscribe(); (navigation ?? navigation).addListener('focus', () => {}); }; return () => cleanup();",
    expectedCount: 1,
  },
  {
    name: "rejects provider mutation through an object container",
    effectSetup:
      "const box = { target: navigation }; box.target.addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects provider mutation through a destructured container",
    effectSetup:
      "const { target } = { target: navigation }; target.addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a provider container passed to a local mutator",
    effectSetup:
      "const box = { target: navigation }; const replace = (container) => { container.target.addListener = () => ({ remove() {} }); }; replace(box); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects provider mutation through an array container",
    effectSetup:
      "const box = [navigation]; box[0].addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects exposing a provider through a local getter",
    effectSetup:
      "const getReceiver = () => navigation; const replace = (target) => { target.addListener = () => ({ remove() {} }); }; replace(getReceiver()); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a logical receiver stored in an object container",
    effectSetup:
      "const box = { target: navigation ?? navigation }; box.target.addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a logical receiver stored in an array container",
    effectSetup:
      "const box = [navigation ?? navigation]; box[0].addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects mutation through a selected logical receiver alias",
    effectSetup:
      "const alias = navigation ?? navigation; alias.addListener = () => ({ remove() {} }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a logical receiver passed to a mutator",
    effectSetup:
      "const replace = (target) => { target.addListener = () => ({ remove() {} }); }; replace(navigation ?? navigation); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects mutating an alias of a repeated parent result",
    effectSetup:
      "const escaped = navigation.getParent(); if (escaped) Object.assign(escaped, { addListener: () => ({ remove() {} }) }); const unsubscribe = (navigation.getParent() ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a parent result stored in a mutated container",
    effectSetup:
      "const box = { target: navigation.getParent() }; if (box.target) box.target.addListener = () => ({ remove() {} }); const unsubscribe = (navigation.getParent() ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a provider escaped through valueOf",
    effectSetup:
      "const escaped = navigation.valueOf(); Object.assign(escaped, { addListener: () => ({ remove() {} }) }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects a declared identity method returning the provider",
    declarations: declaredProvider.replace(
      "getParent: () => Navigation | undefined;",
      "identity: () => Navigation; getParent: () => Navigation | undefined;",
    ),
    setup: "const navigation = getNavigation();",
    effectSetup:
      "const escaped = navigation.identity(); Object.assign(escaped, { addListener: () => ({ remove() {} }) }); const unsubscribe = (navigation ?? navigation).addListener('focus', () => {});",
    expectedCount: 1,
  },
  {
    name: "rejects ambient factory overwrites through a global-object container",
    declarations: declaredProvider,
    setup:
      "const box = { world: globalThis }; box.world.getNavigation = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects ambient factory overwrites through a global-object array",
    declarations: declaredProvider,
    setup:
      "const box = [globalThis]; Reflect.set(box[0], 'getNavigation', () => opaque); const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects ambient factory overwrites through a logical global-object container",
    declarations: declaredProvider,
    setup:
      "const box = { world: globalThis ?? globalThis }; box.world.getNavigation = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects ambient factory overwrites through a global valueOf result",
    declarations: declaredProvider,
    setup:
      "const world = globalThis.valueOf(); Reflect.set(world, 'getNavigation', () => opaque); const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects mutation through a self-returning registration result",
    declarations: 'import { EventEmitter } from "node:events";',
    setup: "const emitter = new EventEmitter();",
    effectSetup:
      "const handler = () => {}; const escaped = (emitter ?? emitter).on('focus', handler); escaped.off = () => {};",
    cleanup: "return () => (emitter ?? emitter).off('focus', handler);",
    expectedCount: 1,
  },
  {
    name: "rejects mutation through a self-returning release result",
    declarations: 'import { EventEmitter } from "node:events";',
    setup: "const emitter = new EventEmitter();",
    effectSetup:
      "const handler = () => {}; (emitter ?? emitter).on('focus', handler); const escaped = (emitter ?? emitter).off('other', handler); escaped.off = () => {};",
    cleanup: "return () => (emitter ?? emitter).off('focus', handler);",
    expectedCount: 1,
  },
  {
    name: "rejects a registration result exposed through a container",
    declarations: 'import { EventEmitter } from "node:events";',
    setup: "const emitter = new EventEmitter();",
    effectSetup:
      "const handler = () => {}; const box = { target: (emitter ?? emitter).on('focus', handler) }; box.target.off = () => {};",
    cleanup: "return () => (emitter ?? emitter).off('focus', handler);",
    expectedCount: 1,
  },
  {
    name: "rejects passing a registration result to a mutator",
    declarations: 'import { EventEmitter } from "node:events";',
    setup: "const emitter = new EventEmitter();",
    effectSetup:
      "const handler = () => {}; const replace = (target) => { target.off = () => {}; }; replace((emitter ?? emitter).on('focus', handler));",
    cleanup: "return () => (emitter ?? emitter).off('focus', handler);",
    expectedCount: 1,
  },
  {
    name: "rejects conditional disposer execution",
    cleanup: "return () => { if (enabled) unsubscribe(); };",
    expectedCount: 1,
  },
  {
    name: "rejects an early cleanup return before the disposer",
    cleanup: "return () => { if (enabled) return; unsubscribe(); };",
    expectedCount: 1,
  },
  {
    name: "rejects subscribing again inside cleanup",
    cleanup:
      "return () => { unsubscribe(); (navigation ?? navigation).addListener('focus', () => {}); };",
    expectedCount: 1,
  },
  {
    name: "rejects conditional matching receiver cleanup",
    effectSetup: "const handler = () => {}; (opaque.first || opaque.second).on('focus', handler);",
    cleanup:
      "return () => { if (enabled) (opaque.first || opaque.second).off('focus', handler); };",
    expectedCount: 1,
  },
  {
    name: "rejects runtime providers merely asserted to the declared interface",
    declarations: declaredProvider,
    setup: "const navigation = opaque as Navigation;",
    expectedCount: 1,
  },
  {
    name: "rejects a shadowed ambient factory",
    declarations: declaredProvider,
    setup: "const getNavigation = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects an ambiguous merged interface contract",
    declarations: declaredProvider + "interface Navigation { addListener: () => unknown; }",
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects generic ambient factories",
    declarations: declaredProvider.replace("getNavigation()", "getNavigation<Value>()"),
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects a generic provider type contract",
    declarations: declaredProvider.replace("interface Navigation", "interface Navigation<Value>"),
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects subscription-object return contracts",
    declarations: declaredProvider.replace("=> () => void", "=> { remove: () => void }"),
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects parent methods returning an unrelated provider",
    declarations: declaredProvider.replace(
      "getParent: () => Navigation | undefined",
      "getParent: () => { addListener: () => { remove: () => void } }",
    ),
    setup: "const navigation = getNavigation();",
    receiver: "navigation.getParent() ?? navigation",
    expectedCount: 1,
  },
  {
    name: "rejects assignments to an ambient factory binding",
    declarations: declaredProvider,
    setup: "getNavigation = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects logical assignments to an ambient factory binding",
    declarations: declaredProvider,
    setup: "getNavigation ||= () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects asserted writes to an ambient factory binding",
    declarations: declaredProvider,
    setup: "(getNavigation as any) = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects Reflect.set replacement of the ambient global factory",
    declarations: declaredProvider,
    setup:
      "Reflect.set(globalThis, 'getNavigation', () => opaque); const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects Object.assign replacement of the ambient global factory",
    declarations: declaredProvider,
    setup:
      "Object.assign(globalThis, {getNavigation: () => opaque}); const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects direct global-object replacement of the ambient factory",
    declarations: declaredProvider,
    setup: "globalThis.getNavigation = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects replacement through a global-object alias",
    declarations: declaredProvider,
    setup:
      "const world = globalThis; world.getNavigation = () => opaque; const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects Reflect.set replacement through a global-object alias",
    declarations: declaredProvider,
    setup:
      "const world = globalThis; Reflect.set(world, 'getNavigation', () => opaque); const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects duplicate optional listener signatures",
    declarations: declaredProvider.replace(
      "getParent: () => Navigation | undefined;",
      "addListener?: () => unknown; getParent: () => Navigation | undefined;",
    ),
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects non-void disposer contracts outside the ambient proof",
    declarations: declaredProvider.replace("=> () => void", "=> () => number"),
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
  {
    name: "rejects disposer contracts requiring an argument",
    declarations: declaredProvider.replace("=> () => void", "=> (token: string) => void"),
    setup: "const navigation = getNavigation();",
    expectedCount: 1,
  },
];

describe("effect-needs-cleanup logical receiver contract", () => {
  for (const testCase of logicalReceiverContractCases) {
    it(testCase.name, () => {
      const source = `import { useEffect } from "react";
${testCase.declarations ?? importedProvider}
export const Panel = ({ opaque, enabled }: any) => {
  ${testCase.setup ?? "const navigation = useNavigation();"}
  useEffect(() => {
    ${testCase.effectSetup ?? `const unsubscribe = (${testCase.receiver ?? "navigation ?? navigation"}).addListener('focus', () => {});`}
    ${testCase.cleanup ?? "return () => unsubscribe();"}
  }, [opaque, enabled]);
  return null;
};`;
      const result = runRule(effectNeedsCleanup, source);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(testCase.expectedCount);
      expect(runRule(wrapWithSemanticContext(effectNeedsCleanup), source)).toEqual(result);
    });
  }
});
