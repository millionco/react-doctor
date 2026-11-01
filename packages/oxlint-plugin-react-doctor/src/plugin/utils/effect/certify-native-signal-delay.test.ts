import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import type { EsTreeNode } from "../es-tree-node.js";
import { isNodeOfType } from "../is-node-of-type.js";
import { isPassiveValueUse } from "../is-passive-value-use.js";
import type { Rule } from "../rule.js";
import { walkAst } from "../walk-ast.js";
import { certifyNativeSignalDelay } from "./certify-native-signal-delay.js";
import { NATIVE_DELAY_MAX_ALIAS_DEPTH } from "./native-signal-delay/constants.js";

interface PassiveDiamondObservation {
  readonly accepted: boolean;
  readonly maximumDepth: number;
  readonly symbolLookups: number;
  readonly nodeCount: number;
}

const certificateRule: Rule = {
  id: "native-delay-certificate-test",
  severity: "warn",
  create: (context) => ({
    CallExpression: (node) => {
      if (
        !isNodeOfType(node, "CallExpression") ||
        !isNodeOfType(node.callee, "Identifier") ||
        node.callee.name !== "inspectCertificate"
      )
        return;
      const [call, signal] = node.arguments;
      if (!isNodeOfType(call, "CallExpression") || !signal) return;
      context.report({
        node,
        message: certifyNativeSignalDelay(call, signal, context) ? "certified" : "unknown",
      });
    },
  }),
};

const nativeDelay = `
const pause = (milliseconds, signal) => new Promise((settle) => {
  if (signal.aborted) { settle(false); return; }
  const timer = setTimeout(() => {
    signal.removeEventListener("abort", cancel);
    settle(true);
  }, milliseconds);
  const cancel = () => { clearTimeout(timer); settle(false); };
  signal.addEventListener("abort", cancel, { once: true });
});
`;

const inspect = (producer: string, invocation = "pause(24, ownedSignal)", extra = ""): string => {
  const result = runRule(
    certificateRule,
    `${producer}
    const controller = new AbortController();
    const ownedSignal = controller.signal;
    ${extra}
    inspectCertificate(${invocation}, ownedSignal);
  `,
  );
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(1);
  return result.diagnostics[0].message;
};

describe("certifyNativeSignalDelay", () => {
  it.each([
    "const parts = ['quay', 'ridge']; const selector = `[data-part=${parts[1]}]`;",
    "const parts = ['quay', 'ridge']; const index = 1; const selector = `[data-part=${parts[index]}]`;",
  ])("resolves literal and readonly numeric property names: %s", (setup) => {
    expect(inspect(nativeDelay, undefined, setup)).toBe("certified");
  });

  it.each([
    "const parts = ['quay', 'ridge']; const index = -1; const selector = `[data-part=${parts[index]}]`;",
    "const parts = ['quay', 'ridge']; const index = unknownIndex; const selector = `[data-part=${parts[index]}]`;",
    "const parts = ['quay', 'ridge']; let index = 1; const selector = `[data-part=${parts[index]}]`;",
    "const parts = ['quay', 'ridge']; const index = { toString: () => 'constructor' }; const selector = `[data-part=${parts[index]}]`;",
    "const parts = ['quay', 'ridge']; const index = 'constructor'; const selector = `[data-part=${parts[index]}]`;",
    "const parts = ['quay', 'ridge']; const index = '__proto__'; const selector = `[data-part=${parts[index]}]`;",
  ])("retains refusal for unproved or protected property names: %s", (setup) => {
    expect(inspect(nativeDelay, undefined, setup)).toBe("unknown");
  });

  it("bounds converging passive alias paths by node and remaining depth", () => {
    const diamondLevelCount = 12;
    const observations: PassiveDiamondObservation[] = [];
    const passiveRule: Rule = {
      id: "passive-diamond-test",
      severity: "warn",
      create: (context) => ({
        MemberExpression: (node) => {
          if (
            !isNodeOfType(node, "MemberExpression") ||
            !isNodeOfType(node.object, "Identifier") ||
            node.object.name !== "record"
          )
            return;
          let nodeCount = 0;
          walkAst(context.scopes.rootScope.node, () => {
            nodeCount += 1;
          });
          for (const maximumDepth of [NATIVE_DELAY_MAX_ALIAS_DEPTH, diamondLevelCount]) {
            let symbolLookups = 0;
            const scopes = {
              ...context.scopes,
              symbolFor: (candidate: EsTreeNode) => {
                symbolLookups += 1;
                return context.scopes.symbolFor(candidate);
              },
            };
            const accepted = isPassiveValueUse({ node, scopes, maximumDepth });
            observations.push({ accepted, maximumDepth, symbolLookups, nodeCount });
          }
        },
      }),
    };
    const declarations = Array.from(
      { length: diamondLevelCount },
      (_, index) => `const value${index + 1} = true ? value${index} : value${index};`,
    ).join("\n");
    const result = runRule(
      passiveRule,
      `const record = { label: "quay" }; const chooseName = () => "label";
       const value0 = record[chooseName()]; ${declarations} void value${diamondLevelCount};`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(observations.map((observation) => observation.accepted)).toEqual([true, false]);
    for (const observation of observations)
      expect(observation.symbolLookups).toBeLessThanOrEqual(
        observation.nodeCount * observation.maximumDepth,
      );
  });

  it("certifies a private native timer with closed false and true settlement paths", () => {
    expect(inspect(nativeDelay)).toBe("certified");
  });

  it.each(["constructor", "['constructor']"])(
    "refuses a function code-constructor gateway %s without executing it",
    (member) => {
      const access = member === "constructor" ? ".constructor" : member;
      expect(
        inspect(
          nativeDelay,
          "pause(24, ownedSignal)",
          `const makeCode = (() => {})${access}; makeCode('globalThis.setTimeout = replacement')();`,
        ),
      ).toBe("unknown");
    },
  );

  it.each([
    "const makeCode = Object.constructor;",
    "const makeCode = Array.constructor;",
    "const makeCode = ''.slice.constructor;",
    "const makeCode = Math.max.constructor;",
    "const { constructor: makeCode } = () => {};",
    "const makeCode = Reflect.get(() => {}, 'constructor');",
  ])("refuses native/reflected code-constructor extraction %s without execution", (setup) => {
    expect(
      inspect(
        nativeDelay,
        "pause(24, ownedSignal)",
        setup + " makeCode('globalThis.setTimeout = replacement')();",
      ),
    ).toBe("unknown");
  });

  it.each([
    'const chooseName = () => "constructor"; const [Carrier] = [() => {}]; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = () => {}; const {[chooseName()]: makeCode} = Carrier;',
    'const chooseName = () => "constructor"; const Carrier = () => {}; const {nested:{[chooseName()]: makeCode}} = {nested: Carrier};',
    'const chooseName = () => "constructor"; let Carrier; Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = 1; Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; var Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = class {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; var Carrier = class {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; let Carrier = () => {}; Carrier = Carrier; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = () => {}; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; function Carrier() {} const Alias = Carrier; const makeCode = Alias[chooseName()];',
    'const chooseName = () => "constructor"; class Carrier {} const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = class {}; const Alias = Carrier; const makeCode = Alias[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = Object; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = Math.max; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = "".slice; const makeCode = Carrier[chooseName()];',
    'const chooseName = () => "constructor"; const Carrier = Math.max.bind(null); const makeCode = Carrier[chooseName()];',
  ])("refuses unknown computed callable property extraction %s without execution", (setup) => {
    expect(
      inspect(
        nativeDelay,
        "pause(24, ownedSignal)",
        setup + " makeCode('globalThis.setTimeout = replacement')();",
      ),
    ).toBe("unknown");
  });

  it.each([
    'const chooseName = () => "label"; const record = {label:"quay"}; const result = record[chooseName()];',
    'const chooseName = () => "label"; const Math = {max:{label:"quay"}}; const result = Math.max[chooseName()];',
    "const Carrier = () => {}; const { name: label } = Carrier;",
    "const Carrier = () => {}; const result = Carrier.name;",
  ])("keeps ordinary data/static member access %s", (setup) => {
    expect(inspect(nativeDelay, "pause(24, ownedSignal)", setup)).toBe("certified");
  });

  it("tracks readonly producer, duration, and signal aliases", () => {
    expect(
      inspect(
        nativeDelay,
        "waitAgain(interval, token)",
        `
      const waitAgain = pause;
      const interval = 6 * 4;
      const token = ownedSignal;
    `,
      ),
    ).toBe("certified");
  });

  it("allows ordinary native static promise uses and readonly native constructor aliases", () => {
    expect(
      inspect(
        nativeDelay,
        "pause(24, ownedSignal)",
        "Promise.all([]); Promise.resolve(1); AbortSignal.timeout(5);",
      ),
    ).toBe("certified");
    expect(
      inspect(
        nativeDelay.replace("new Promise", "new NativePromise"),
        "pause(24, ownedSignal)",
        "const NativePromise = Promise;",
      ),
    ).toBe("certified");
  });

  it("does not confuse local names with alternate global windows", () => {
    expect(
      inspect(
        nativeDelay,
        "pause(24, ownedSignal)",
        "const parent = 1; const top = 2; const opener = 3; const frames = []; const open = () => {};",
      ),
    ).toBe("certified");
  });

  it("accepts private function declarations and reversed producer parameter order", () => {
    const producer = nativeDelay
      .replace(
        "const pause = (milliseconds, signal) =>",
        "function pause(signal, milliseconds) { return",
      )
      .replace(/\}\);\s*$/, "}); }");
    expect(inspect(producer, "pause(ownedSignal, 24)")).toBe("certified");
  });

  it("accepts a terminal returned false settlement and listener removal during abort", () => {
    const producer = nativeDelay
      .replace("{ settle(false); return; }", "return settle(false);")
      .replace(
        "clearTimeout(timer); settle(false);",
        'clearTimeout(timer); signal.removeEventListener("abort", cancel); return settle(false);',
      );
    expect(inspect(producer)).toBe("certified");
  });

  const unsafeProducers = [
    [
      "async adoption",
      nativeDelay.replace("(milliseconds, signal) =>", "async (milliseconds, signal) =>"),
    ],
    [
      "postsettlement application callback",
      nativeDelay.replace("settle(true);", "settle(true); notify();"),
    ],
    [
      "postsettlement microtask",
      nativeDelay.replace("settle(true);", "settle(true); queueMicrotask(notify);"),
    ],
    [
      "true before listener removal",
      nativeDelay.replace(
        'signal.removeEventListener("abort", cancel);\n    settle(true);',
        'settle(true); signal.removeEventListener("abort", cancel);',
      ),
    ],
    ["thenable resolution", nativeDelay.replace("settle(true);", "settle({ then: notify });")],
    ["escaped resolver", nativeDelay.replace("settle(true);", "publish(settle); settle(true);")],
    [
      "foreign abort receiver",
      nativeDelay.replace(
        'signal.addEventListener("abort"',
        'otherSignal.addEventListener("abort"',
      ),
    ],
    [
      "missing early abort guard",
      nativeDelay.replace("if (signal.aborted) { settle(false); return; }", ""),
    ],
    ["nonterminal early guard", nativeDelay.replace("settle(false); return;", "settle(false);")],
    [
      "true abort settlement",
      nativeDelay.replace(
        "clearTimeout(timer); settle(false);",
        "clearTimeout(timer); settle(true);",
      ),
    ],
    ["timer is not cleared", nativeDelay.replace("clearTimeout(timer);", "")],
    [
      "wrong listener removed",
      nativeDelay.replace(
        'removeEventListener("abort", cancel)',
        'removeEventListener("abort", otherCallback)',
      ),
    ],
    [
      "spread listener options",
      nativeDelay.replace("{ once: true }", "{ ...options, once: true }"),
    ],
    [
      "getter listener option",
      nativeDelay.replace("{ once: true }", "{ get once() { notify(); return true; } }"),
    ],
    ["exported producer", nativeDelay.replace("const pause", "export const pause")],
    ["async timer callback", nativeDelay.replace("setTimeout(() =>", "setTimeout(async () =>")],
    ["async executor", nativeDelay.replace("new Promise((settle)", "new Promise(async (settle)")],
    ["timer callback parameter", nativeDelay.replace("setTimeout(() =>", "setTimeout((event) =>")],
    [
      "application execution before settlement",
      nativeDelay.replace("settle(true);", "notify(); settle(true);"),
    ],
    [
      "executor finalizer",
      nativeDelay
        .replace("if (signal.aborted)", "try { if (signal.aborted)")
        .replace(
          'signal.addEventListener("abort", cancel, { once: true });',
          'signal.addEventListener("abort", cancel, { once: true }); } finally { notify(); }',
        ),
    ],
  ];

  it.each(unsafeProducers)("refuses %s", (_label, producer) => {
    expect(inspect(producer)).toBe("unknown");
  });

  const contradictions = [
    ["alternate parent window mutation", "parent['set' + 'Timeout'] = schedule;"],
    ["alternate top window mutation", "top['Prom' + 'ise'] = Replacement;"],
    [
      "alternate opener window alias",
      "const otherWindow = opener; otherWindow[unknownKey] = replacement;",
    ],
    ["alternate frames window mutation", "frames[0][unknownKey] = replacement;"],
    ["alternate global member window mutation", "globalThis.parent[unknownKey] = replacement;"],
    [
      "alternate global member window alias",
      "const otherWindow = window.top; otherWindow[unknownKey] = replacement;",
    ],
    ["same-target open window mutation", "open('', '_self')[unknownKey] = replacement;"],
    ["global eval", "eval('patchNativeGlobals()');"],
    ["global Function constructor", "new Function('patchNativeGlobals()')();"],
    ["global eval alias", "const execute = eval; execute('patchNativeGlobals()');"],
    [
      "global Function alias",
      "const Compile = globalThis.Function; new Compile('patchNativeGlobals()')();",
    ],
    ["global eval member", "globalThis.eval('patchNativeGlobals()');"],
    ["indirect global Promise replacement", "document.defaultView.Promise = Replacement;"],
    ["indirect global timer replacement", "frames[0].setTimeout = schedule;"],
    ["indirect global dynamic mutation", "document.defaultView[unknownKey] = replacement;"],
    [
      "computed prototype reader",
      "const read = 'getPrototypeOf'; Object[read](new AbortController()).abort = intercept;",
    ],
    ["Promise prototype assignment", "Promise.prototype.then = intercept;"],
    ["native Promise replacement", "Promise = Replacement;"],
    ["timer replacement", "setTimeout = schedule;"],
    ["global timer replacement", "globalThis.setTimeout = schedule;"],
    ["signal prototype replacement", "AbortSignal.prototype.addEventListener = intercept;"],
    [
      "event target prototype replacement",
      "Object.defineProperty(EventTarget.prototype, 'removeEventListener', { value: intercept });",
    ],
    ["global dynamic assignment", "globalThis[unknownProperty] = replacement;"],
    ["nested global self assignment", "globalThis.globalThis.Promise.prototype.then = intercept;"],
    [
      "native instance prototype mutation",
      "Object.getPrototypeOf(new AbortController()).abort = intercept;",
    ],
    [
      "indirect global prototype mutation",
      "document.defaultView.Promise.prototype.then = intercept;",
    ],
    [
      "legacy prototype mutation",
      "new AbortController().signal.__proto__.addEventListener = intercept;",
    ],
    [
      "indirect global prototype getter mutation",
      "document.defaultView.EventTarget.prototype.__defineGetter__('removeEventListener', () => intercept);",
    ],
    [
      "native instance prototype getter mutation",
      "(new AbortController()).signal.__proto__.__defineGetter__('aborted', () => false);",
    ],
    [
      "indirect global prototype setter mutation",
      "document.defaultView.AbortSignal.prototype.__defineSetter__('aborted', intercept);",
    ],
    [
      "computed prototype getter mutation",
      "const prototypeKey = 'prototype'; document.defaultView.EventTarget[prototypeKey].__defineGetter__('removeEventListener', () => intercept);",
    ],
    [
      "computed legacy mutation",
      "const mutator = '__defineGetter__'; document.defaultView.EventTarget[unknownKey][mutator]('removeEventListener', () => intercept);",
    ],
    [
      "Promise alias mutation",
      "const NativePromise = Promise; NativePromise.prototype.then = intercept;",
    ],
    ["escaped producer", "publish(pause);"],
    ["escaped producer alias", "const waitAgain = pause; publish(waitAgain);"],
    ["exported producer alias", "export const publicPause = pause;"],
    ["mutated producer", "pause = replacement;"],
    ["shadowed Promise", "const Promise = Replacement;"],
    ["shadowed timer", "const setTimeout = schedule;"],
  ];

  it.each(contradictions)("refuses %s", (_label, extra) => {
    expect(inspect(nativeDelay, "pause(24, ownedSignal)", extra)).toBe("unknown");
  });

  it("does not use a supplied foreign signal as the cancellation witness", () => {
    expect(inspect(nativeDelay, "pause(24, new AbortController().signal)")).toBe("unknown");
  });

  it.each([
    [
      "block const shadow",
      "{ const Object = { getPrototypeOf: () => ({}) }; Object.getPrototypeOf({}); }",
    ],
    [
      "ordinary function body declaration",
      "const inspectLocal = () => { function Object() { return {}; } return Object(); }; inspectLocal();",
    ],
    [
      "unreferenced type declarations",
      "interface NativeOptions { value: string } type NativeShape = { ready: boolean };",
    ],
    [
      "readonly reflection namespace alias",
      "const StandardObject = Object; StandardObject.keys({});",
    ],
    ["private own record writer", "const record = {}; record.addEventListener = replacement;"],
    [
      "private own record aliases",
      "const record = {}; const alias = record; alias.then = replacement;",
    ],
    [
      "private own data descriptor",
      "const record = {}; Object.defineProperty(record, 'addEventListener', { value: replacement });",
    ],
    [
      "private own record assignment",
      "const record = {}; Object.assign(record, { then: replacement });",
    ],
    ["disjoint opaque receiver write", "foreign().label = 'ready';"],
  ])("preserves %s", (_label, source) => {
    expect(inspect(nativeDelay, "pause(24, ownedSignal)", source)).toBe("certified");
  });

  it.each([
    [
      "block function hoisting",
      "{ function Object() {} } Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    [
      "conditional block function",
      "if (condition) { function Reflect() {} } Reflect.getPrototypeOf(new AbortController().signal).removeEventListener = foreign;",
    ],
    [
      "switch function",
      "switch (mode) { case 'next': function Object() {} } Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    [
      "loop block function",
      "for (const entry of entries) { function Object() {} } Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    ["unrelated unsupported declaration", "{ function localAction() {} }"],
    [
      "erased type alias",
      "type Object = {}; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    [
      "erased interface",
      "interface Object {} Object.getPrototypeOf(new AbortController().signal).removeEventListener = foreign;",
    ],
    [
      "ambient binding",
      "declare const Object: any; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    ["erased eval", "type eval = {}; eval('patchNativeGlobals()');"],
    ["ambient eval", "declare const eval: any; eval('patchNativeGlobals()');"],
    ["erased Function", "type Function = {}; new Function('patchNativeGlobals()')();"],
    [
      "block enum dynamic code shadow",
      "{ enum Function { Local } } new Function('patchNativeGlobals()')();",
    ],
    [
      "block namespace dynamic code shadow",
      "{ namespace Function { export const local = 1; } } new Function('patchNativeGlobals()')();",
    ],
    [
      "namespace import-equals dynamic code shadow",
      "namespace Container { import Function = Utilities.create; } new Function('patchNativeGlobals()')();",
    ],
    [
      "namespace var dynamic code shadow",
      "namespace Container { var Function = Utilities.create; } new Function('patchNativeGlobals()')();",
    ],
    [
      "static block var dynamic code shadow",
      "class Holder { static { var Function; } } new Function('patchNativeGlobals()')();",
    ],
    [
      "type-only reflection import",
      "import type { Object } from 'native-types'; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    [
      "mixed type reflection import",
      "import { type Object, unused } from 'native-types'; Object.getPrototypeOf(new AbortController().signal).addEventListener = foreign;",
    ],
    [
      "opaque signal method writer",
      "foreign(new AbortController().signal).addEventListener = replacement;",
    ],
    ["opaque Object namespace writer", "foreign().Object = replacement;"],
    ["opaque Reflect namespace writer", "foreign().Reflect = replacement;"],
    ["opaque global self writer", "foreign().globalThis = replacement;"],
    [
      "opaque listener removal writer",
      "foreign(new AbortController().signal).removeEventListener = replacement;",
    ],
    ["opaque controller writer", "foreign(new AbortController()).abort = replacement;"],
    ["opaque adoption constructor", "foreign(new Promise(() => {})).constructor = replacement;"],
    ["opaque then writer", "foreign(new Promise(() => {})).then = replacement;"],
    ["destructuring member writer", "({ next: foreign().addEventListener } = values);"],
    ["iteration member writer", "for (foreign().addEventListener of values) {}"],
    [
      "descriptor writer",
      "Object.defineProperty(foreign(), 'addEventListener', { value: replacement });",
    ],
    [
      "descriptor map writer",
      "Object.defineProperties(foreign(), { then: { value: replacement } });",
    ],
    ["assignment writer", "Object.assign(foreign(), { abort: replacement });"],
    ["reflect writer", "Reflect.set(foreign(), 'removeEventListener', replacement);"],
    [
      "reflect explicit receiver",
      "Reflect.set({}, 'then', replacement, foreign(new Promise(() => {})));",
    ],
    [
      "reflection alias",
      "const change = Object.defineProperty; change(foreign(), 'then', { value: replacement });",
    ],
    [
      "destructured reflection alias",
      "const { defineProperty: change } = Object; change(foreign(), 'addEventListener', { value: replacement });",
    ],
    [
      "contained reflection alias",
      "const holder = [Object]; const [namespace] = holder; namespace.defineProperty(foreign(), 'then', { value: replacement });",
    ],
    ["unknown reflection key", "Reflect.set(foreign(), key, replacement);"],
    ["unknown member key", "foreign()[key] = replacement;"],
    [
      "escaped own record",
      "const record = {}; publish(record); record.addEventListener = replacement;",
    ],
    [
      "own record accessor",
      "const record = {}; Object.defineProperty(record, 'then', { get: replacement }); record.then = replacement;",
    ],
    [
      "own record unknown prototype writer",
      "const record = {}; record[key] = proxy; record.addEventListener = replacement;",
    ],
  ])("refuses native writer or lexical ambiguity: %s", (_label, source) => {
    expect(inspect(nativeDelay, "pause(24, ownedSignal)", source)).toBe("unknown");
  });

  it("refuses duration coercion and unknown duration getters", () => {
    expect(inspect(nativeDelay, "pause({ valueOf() { notify(); return 24; } }, ownedSignal)")).toBe(
      "unknown",
    );
    expect(inspect(nativeDelay, "pause(options.duration, ownedSignal)")).toBe("unknown");
  });

  it("refuses constructor and timer wrappers", () => {
    expect(inspect(nativeDelay.replace("new Promise", "createPromise"))).toBe("unknown");
    expect(inspect(nativeDelay.replace("setTimeout", "scheduleLater"))).toBe("unknown");
  });
});
