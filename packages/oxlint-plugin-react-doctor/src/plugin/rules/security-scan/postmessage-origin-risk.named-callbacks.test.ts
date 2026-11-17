import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { postmessageOriginRisk } from "./postmessage-origin-risk.js";

const cases = [
  {
    name: "named readonly arrow direct payload",
    code: 'const receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: true,
  },
  {
    name: "named function declaration direct payload",
    code: 'function receive(message) { consume(message.data); }\nwindow.addEventListener("message", receive);\n',
    reports: true,
  },
  {
    name: "event object data destructuring",
    code: 'const receive = (event) => { const { data } = event; consume(data); };\nwindow.addEventListener("message", receive);\n',
    reports: true,
  },
  {
    name: "callback validates event origin",
    code: 'const receive = (event) => { if (event.origin !== "https://trusted.example") return; consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "callback validates event source",
    code: 'const receive = (event) => { if (event.source !== window.parent) return; consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "opaque event guard helper before data",
    code: 'const senderAllowed = (message) => message.origin === "https://trusted.example";\nconst receive = (event) => { if (!senderAllowed(event)) return; consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "lexically different shadowed listener",
    code: 'const receive = (event) => consume(event.data);\n{ const receive = () => refresh(); window.addEventListener("message", receive); }\n',
    reports: false,
  },
  {
    name: "reassigned local function identity",
    code: 'let receive = (event) => consume(event.data);\nreceive = () => refresh();\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "shadowed window synchronous imitation",
    code: 'const window = { addEventListener(type, receive) { receive({data:"local"}); } };\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "worker receiver preserves channel exception",
    code: 'const worker = new Worker("worker.js");\nconst receive = (event) => consume(event.data);\nworker.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "data read only in uncalled nested function",
    code: 'const receive = (event) => { const later = () => consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "bound fake first argument is not incoming event",
    code: 'const handle = (event) => consume(event.data);\nconst receive = handle.bind(null, {data:"local"});\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "event parameter replaced before payload read",
    code: 'const receive = (event) => { event = { data: "local" }; consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "transparent direct eval replaces event parameter",
    code: 'const receive = (event) => { (eval as any)("event = { data: \'local\' }"); consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "visible native listener method replacement",
    code: 'window.addEventListener = (_type, callback) => callback({ data: "local" });\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "payload property write without payload read",
    code: 'const receive = (event) => { event.data = "local"; };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "arguments replaces sloppy function event parameter",
    code: 'function receive(event) { arguments[0] = { data: "local" }; consume(event.data); }\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "payload read confined to statically dead branch",
    code: 'const receive = (event) => { if (false) consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "unreachable payload after return",
    code: 'const receive = (event) => { return; consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "payload overwritten before later read",
    code: 'const receive = (event) => { event.data = "local"; consume(event.data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "payload overwritten after direct read",
    code: 'const receive = (event) => { consume(event.data); delete event.data; };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "default parameter can replace event",
    code: 'const receive = (event, reset = (event = { data: "local" })) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "native prototype listener replacement",
    code: 'EventTarget.prototype.addEventListener = (_type, callback) => callback({data:"local"});\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "reflection replaces listener method",
    code: 'Object.defineProperty(window, "addEventListener", {value: (_type, callback) => callback({data:"local"})});\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "computed window provider replacement",
    code: 'const method = "addEventListener";\nwindow[method] = (_type, callback) => callback({data:"local"});\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "data destructuring default opaque guard",
    code: 'const receive = (event) => { const { allowed = senderAllowed(event), data } = event; consume(allowed, data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "const function expression payload",
    code: 'const receive = function (incoming) { consume(incoming.data); };\nwindow.addEventListener("message", receive);\n',
    reports: true,
  },
  {
    name: "arbitrary incoming parameter spelling",
    code: 'const receive = (incoming) => consume(incoming.data);\nwindow.addEventListener("message", receive);\n',
    reports: true,
  },
  {
    name: "origin check after local data acquisition",
    code: 'const receive = (incoming) => { const data = incoming.data; if (incoming.origin !== "https://trusted.example") return; consume(data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "origin check after direct consumption",
    code: 'const receive = (incoming) => { consume(incoming.data); if (incoming.origin !== "https://trusted.example") return; };\nwindow.addEventListener("message", receive);\n',
    reports: true,
  },
  {
    name: "readonly callback declaration reassignment",
    code: 'function receive(event) { consume(event.data); }\nreceive = () => refresh();\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "optional registration declined",
    code: 'const receive = (event) => consume(event.data);\nwindow.addEventListener?.("message", receive);\n',
    reports: false,
  },
  {
    name: "nested arrow arguments replacement",
    code: 'function receive(event) { consume((() => { arguments[0] = {data:"local"}; })(), event.data); }\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "runtime enum direct eval declined",
    code: 'const receive = (event) => { enum Update { Value = eval("event = {data: \'local\'}") } consume(event.data, Update); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "conditional destructuring default read",
    code: 'const receive = (event) => { const { value = event.data } = { value: "local" }; consume(value); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "short circuit assignment payload read",
    code: 'const receive = (event) => { let data = "local"; data ||= event.data; consume(data); };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "computed payload property write",
    code: 'const key = "data";\nconst receive = (event) => { consume(event.data); event[key] = "local"; };\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "direct alias of global window replaces selected method",
    code: 'const nativeWindow = window;\nnativeWindow.addEventListener = (_type, callback) => callback({ data: "local" });\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "native EventTarget prototype alias replaces selected method",
    code: 'const listenerPrototype = EventTarget.prototype;\nlistenerPrototype.addEventListener = (_type, callback) => callback({ data: "local" });\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "globalThis window member alias replaces selected method",
    code: 'const nativeWindow = globalThis.window;\nnativeWindow.addEventListener = (_type, callback) => callback({ data: "local" });\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "window self alias replaces selected method",
    code: 'const nativeWindow = window.self;\nnativeWindow.addEventListener = (_type, callback) => callback({ data: "local" });\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "bare Function alias installs fake incoming payload",
    code: 'const makeCode = Function;\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "window Function member alias installs fake payload",
    code: 'const makeCode = window.Function;\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "globalThis Function member alias installs fake payload",
    code: 'const makeCode = globalThis.Function;\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "computed global Function member alias installs fake payload",
    code: 'const capability = "Function";\nconst makeCode = window[capability];\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "indirect eval alias installs fake incoming payload",
    code: 'const runCode = eval;\nrunCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})");\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "function constructor member alias installs fake payload",
    code: 'const makeCode = (() => {}).constructor;\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "catch binding default hides global window provider escape",
    code: 'try { throw {}; }\ncatch ({ nativeWindow = window }) {\n  nativeWindow.addEventListener = (_type, callback) => callback({ data: "local" });\n}\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "catch binding default in first-call prelude replaces event parameter",
    code: 'const receive = (event) => {\n  consume((() => {\n    try { throw {}; }\n    catch ({ ignored = (event = { data: "local" }) }) {}\n  })(), event.data);\n};\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "catch default replaces named callback binding",
    code: 'function receive(event) { consume(event.data); }\ntry { throw {}; } catch ({ ignored = (receive = () => refresh()) }) {}\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "function constructor destructuring installs fake listener provider",
    code: 'const { constructor: makeCode } = (() => {});\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "native window legacy getter mutator installs fake listener provider",
    code: 'window.__defineGetter__("addEventListener", () => (_type, callback) => callback({ data: "local" }));\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
  {
    name: "Reflect get reads native Function constructor capability",
    code: 'const makeCode = Reflect.get(() => {}, "constructor");\nmakeCode("window.addEventListener = (_type, callback) => callback({data: \'local\'})")();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);\n',
    reports: false,
  },
];

describe("named window message callbacks", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const findings = runScanRule(postmessageOriginRisk, {
        relativePath: "src/synthetic-window-message.ts",
        content: testCase.code,
      });
      expect(findings).toEqual(
        testCase.reports
          ? [
              {
                message:
                  "A message event handler reads cross-window messages without an obvious origin check.",
                line: 2,
                column: 1,
              },
            ]
          : [],
      );
    });
  }
});

describe("erased-only window callback identities", () => {
  it("erased-window", () => {
    expect(
      runScanRule(postmessageOriginRisk, {
        relativePath: "src/erased-window.tsx",
        content:
          'interface window { note: string };\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);',
      }),
    ).toHaveLength(1);
  });
  it("erased-handler", () => {
    expect(
      runScanRule(postmessageOriginRisk, {
        relativePath: "src/erased-window.tsx",
        content:
          'interface receive {note:string};\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);',
      }),
    ).toHaveLength(1);
  });
  it("nested-type", () => {
    expect(
      runScanRule(postmessageOriginRisk, {
        relativePath: "src/erased-window.tsx",
        content:
          'type Notes = ({ nested: { constructor } }: {nested:{constructor:string}})=>void;\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);',
      }),
    ).toHaveLength(1);
  });
  it("runtime-param", () => {
    expect(
      runScanRule(postmessageOriginRisk, {
        relativePath: "src/erased-window.tsx",
        content:
          'class Overrides { constructor(public ignored = Function("window.addEventListener = (_type, callback) => callback({data:1})")()) {} }; new Overrides();\nconst receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);',
      }),
    ).toHaveLength(0);
  });
  it("runtime window companion remains opaque", () => {
    expect(
      runScanRule(postmessageOriginRisk, {
        relativePath: "src/erased-window.tsx",
        content:
          'interface window {note:string}; const window={addEventListener(_type,callback){callback({data:1})}}; const receive = event => consume(event.data); window.addEventListener("message", receive);',
      }),
    ).toEqual([]);
  });
});

it("preserves outer ambient value contracts", () => {
  expect(
    runScanRule(postmessageOriginRisk, {
      relativePath: "src/ambient-window.tsx",
      content:
        'declare const window: unknown; { interface window {note:string}; const receive=event=>consume(event.data); window.addEventListener("message",receive); }',
    }),
  ).toHaveLength(0);
});

it("preserves ambient function contract 0", () => {
  expect(
    runScanRule(postmessageOriginRisk, {
      relativePath: "src/ambient-function-window.tsx",
      content:
        'declare function window(): unknown; const receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive);',
    }),
  ).toHaveLength(0);
});

it("preserves ambient function contract 1", () => {
  expect(
    runScanRule(postmessageOriginRisk, {
      relativePath: "src/ambient-function-window.tsx",
      content:
        'interface window {}; function owner(){ declare function window(): unknown; const receive = (event) => consume(event.data);\nwindow.addEventListener("message", receive); }',
    }),
  ).toHaveLength(0);
});

it("declines an inner ambient callback contract", () => {
  expect(
    runScanRule(postmessageOriginRisk, {
      relativePath: "src/ambient-callback.tsx",
      content:
        'const receive = event => consume(event.data); function register(){ declare function receive(event: unknown): void; window.addEventListener("message", receive); }',
    }),
  ).toEqual([]);
});
