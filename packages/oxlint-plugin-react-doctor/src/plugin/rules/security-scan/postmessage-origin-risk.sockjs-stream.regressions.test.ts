import { describe, expect, it } from "vite-plus/test";
import type { ScannedFile, ScanFinding } from "../../utils/file-scan.js";
import { postmessageOriginRisk } from "./postmessage-origin-risk.js";

interface SockjsStreamCase {
  name: string;
  file: ScannedFile;
  findings: ScanFinding[];
}

const cases: SockjsStreamCase[] = [
  {
    name: "cjs-var-original-shape",
    file: {
      absolutePath: "/synthetic/sockjs-contract/cjs-var-original-shape.js",
      relativePath: "src/cjs-var-original-shape.js",
      content:
        "var SockJS = require('sockjs-client'); var connection = new SockJS('/stream'); connection.onmessage = function(event) { consume(event.data); };",
      isGeneratedBundle: false,
    },
    findings: [],
  },
  {
    name: "cjs-const-renamed",
    file: {
      absolutePath: "/synthetic/sockjs-contract/cjs-const-renamed.js",
      relativePath: "src/cjs-const-renamed.js",
      content:
        "const StreamClient = require('sockjs-client'); const feed = new StreamClient('/stream'); feed.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [],
  },
  {
    name: "cjs-var-onclose-pair",
    file: {
      absolutePath: "/synthetic/sockjs-contract/cjs-var-onclose-pair.js",
      relativePath: "src/cjs-var-onclose-pair.js",
      content:
        "var Client = require('sockjs-client'); var connection = new Client('/stream'); connection.onclose = () => notifyClosed(); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [],
  },
  {
    name: "window-control",
    file: {
      absolutePath: "/synthetic/sockjs-contract/window-control.js",
      relativePath: "src/window-control.js",
      content: "window.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 1,
      },
    ],
  },
  {
    name: "window-alias-control",
    file: {
      absolutePath: "/synthetic/sockjs-contract/window-alias-control.js",
      relativePath: "src/window-alias-control.js",
      content: "const connection = window; connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 28,
      },
    ],
  },
  {
    name: "spoofed-local-constructor",
    file: {
      absolutePath: "/synthetic/sockjs-contract/spoofed-local-constructor.js",
      relativePath: "src/spoofed-local-constructor.js",
      content:
        "const SockJS = function() { return window; }; const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 89,
      },
    ],
  },
  {
    name: "shadowed-require",
    file: {
      absolutePath: "/synthetic/sockjs-contract/shadowed-require.js",
      relativePath: "src/shadowed-require.js",
      content:
        "const make = (require) => { const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data); };",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 112,
      },
    ],
  },
  {
    name: "shadowed-constructor",
    file: {
      absolutePath: "/synthetic/sockjs-contract/shadowed-constructor.js",
      relativePath: "src/shadowed-constructor.js",
      content:
        "const SockJS = require('sockjs-client'); const make = (SockJS) => { const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data); };",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 111,
      },
    ],
  },
  {
    name: "constructor-reassigned",
    file: {
      absolutePath: "/synthetic/sockjs-contract/constructor-reassigned.js",
      relativePath: "src/constructor-reassigned.js",
      content:
        "var SockJS = require('sockjs-client'); SockJS = function() { return window; }; var connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 120,
      },
    ],
  },
  {
    name: "connection-reassigned",
    file: {
      absolutePath: "/synthetic/sockjs-contract/connection-reassigned.js",
      relativePath: "src/connection-reassigned.js",
      content:
        "var SockJS = require('sockjs-client'); var connection = new SockJS('/stream'); connection = window; connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 101,
      },
    ],
  },
  {
    name: "dynamic-require",
    file: {
      absolutePath: "/synthetic/sockjs-contract/dynamic-require.js",
      relativePath: "src/dynamic-require.js",
      content:
        "const moduleName = 'sockjs-client'; const SockJS = require(moduleName); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 115,
      },
    ],
  },
  {
    name: "wrong-module",
    file: {
      absolutePath: "/synthetic/sockjs-contract/wrong-module.js",
      relativePath: "src/wrong-module.js",
      content:
        "const SockJS = require('other-runtime'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 84,
      },
    ],
  },
  {
    name: "prototype-constructor-write",
    file: {
      absolutePath: "/synthetic/sockjs-contract/prototype-constructor-write.js",
      relativePath: "src/prototype-constructor-write.js",
      content:
        "const SockJS = require('sockjs-client'); SockJS.prototype.onmessage = consume; const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 122,
      },
    ],
  },
  {
    name: "instance-alias-escape",
    file: {
      absolutePath: "/synthetic/sockjs-contract/instance-alias-escape.js",
      relativePath: "src/instance-alias-escape.js",
      content:
        "const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); const alias = connection; alias.dispatchEvent(new MessageEvent('message',{data:'local'})); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 175,
      },
    ],
  },
  {
    name: "constructor-escape",
    file: {
      absolutePath: "/synthetic/sockjs-contract/constructor-escape.js",
      relativePath: "src/constructor-escape.js",
      content:
        "const SockJS = require('sockjs-client'); mutate(SockJS); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 100,
      },
    ],
  },
  {
    name: "catch-pattern-write",
    file: {
      absolutePath: "/synthetic/sockjs-contract/catch-pattern-write.js",
      relativePath: "src/catch-pattern-write.js",
      content:
        "var SockJS = require('sockjs-client'); var connection = new SockJS('/stream'); try { throw {}; } catch ({ ignored = (connection = window) }) {} connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 145,
      },
    ],
  },
  {
    name: "typed-enum-write",
    file: {
      absolutePath: "/synthetic/sockjs-contract/typed-enum-write.ts",
      relativePath: "src/typed-enum-write.ts",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); enum Replacement { Value = (connection = window) } connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 133,
      },
    ],
  },
  {
    name: "direct-eval-write",
    file: {
      absolutePath: "/synthetic/sockjs-contract/direct-eval-write.js",
      relativePath: "src/direct-eval-write.js",
      content:
        "var SockJS = require('sockjs-client'); var connection = new SockJS('/stream'); (eval)('connection = window'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 111,
      },
    ],
  },
  {
    name: "import-default-neighbor",
    file: {
      absolutePath: "/synthetic/sockjs-contract/import-default-neighbor.js",
      relativePath: "src/import-default-neighbor.js",
      content:
        "import SockJS from 'sockjs-client'; const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 79,
      },
    ],
  },
  {
    name: "preserves unsupported computed-handler gap: computed-onmessage",
    file: {
      absolutePath: "/synthetic/sockjs-contract/computed-onmessage.js",
      relativePath: "src/computed-onmessage.js",
      content:
        "const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection['onmessage'] = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [],
  },
  {
    name: "simultaneous-window-and-stream",
    file: {
      absolutePath: "/synthetic/sockjs-contract/simultaneous-window-and-stream.js",
      relativePath: "src/simultaneous-window-and-stream.js",
      content:
        "const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data); window.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 137,
      },
    ],
  },
  {
    name: "static-require-member-not-constructor",
    file: {
      absolutePath: "/synthetic/sockjs-contract/static-require-member-not-constructor.js",
      relativePath: "src/static-require-member-not-constructor.js",
      content:
        "const SockJS = require('sockjs-client').other; const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 90,
      },
    ],
  },
  {
    name: "instance-shadow-binding",
    file: {
      absolutePath: "/synthetic/sockjs-contract/instance-shadow-binding.js",
      relativePath: "src/instance-shadow-binding.js",
      content:
        "const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); const run = connection => { connection.onmessage = event => consume(event.data); };",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 112,
      },
    ],
  },
  {
    name: "global-name-only",
    file: {
      absolutePath: "/synthetic/sockjs-contract/global-name-only.js",
      relativePath: "src/global-name-only.js",
      content:
        "const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 43,
      },
    ],
  },
  {
    name: "computed-catch-default-receiver-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/computed-catch-default-receiver-write.js",
      relativePath: "src/computed-catch-default-receiver-write.js",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); try { throw {}; } catch ({ ['ignored']: ignored = (connection = window) }) { consume(ignored); } connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 179,
      },
    ],
  },
  {
    name: "captured-default-parameter-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/captured-default-parameter-write.js",
      relativePath: "src/captured-default-parameter-write.js",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); const replace = (unused = (connection = window)) => consume(unused); replace(); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 162,
      },
    ],
  },
  {
    name: "captured-destructured-parameter-default-write",
    file: {
      absolutePath:
        "/synthetic/sockjs-supplemental/captured-destructured-parameter-default-write.js",
      relativePath: "src/captured-destructured-parameter-default-write.js",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); const replace = ({ ignored = (connection = window) } = {}) => consume(ignored); replace(); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 173,
      },
    ],
  },
  {
    name: "runtime-enum-receiver-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/runtime-enum-receiver-write.ts",
      relativePath: "src/runtime-enum-receiver-write.ts",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); enum Replace { Value = (connection = window, 1) } consume(Replace.Value); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 156,
      },
    ],
  },
  {
    name: "runtime-parameter-property-receiver-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/runtime-parameter-property-receiver-write.ts",
      relativePath: "src/runtime-parameter-property-receiver-write.ts",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); class Replace { constructor(public ignored = (connection = window)) {} } consume(new Replace()); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 179,
      },
    ],
  },
  {
    name: "duplicate-canonical-require-prototype-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/duplicate-canonical-require-prototype-write.js",
      relativePath: "src/duplicate-canonical-require-prototype-write.js",
      content:
        "const OtherSockJS = require('sockjs-client'); OtherSockJS.prototype.dispatchEvent = function(event) { window.onmessage = this.onmessage; consume(event); }; const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 238,
      },
    ],
  },
  {
    name: "direct-duplicate-require-prototype-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/direct-duplicate-require-prototype-write.js",
      relativePath: "src/direct-duplicate-require-prototype-write.js",
      content:
        "const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); require('sockjs-client').prototype.dispatchEvent = function(event) { window.onmessage = this.onmessage; consume(event); }; connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 205,
      },
    ],
  },
  {
    name: "global-require-replaced-before-acquisition",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/global-require-replaced-before-acquisition.js",
      relativePath: "src/global-require-replaced-before-acquisition.js",
      content:
        "require = () => function() { return window; }; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 131,
      },
    ],
  },
  {
    name: "global-require-alias-escape",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/global-require-alias-escape.js",
      relativePath: "src/global-require-alias-escape.js",
      content:
        "const load = require; const OtherSockJS = load('sockjs-client'); OtherSockJS.prototype.dispatchEvent = function() { window.onmessage = this.onmessage; }; const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 236,
      },
    ],
  },
  {
    name: "indirect-function-canonical-provider-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/indirect-function-canonical-provider-write.js",
      relativePath: "src/indirect-function-canonical-provider-write.js",
      content:
        "const makeCode = globalThis['Function']; makeCode('load', \"load('sockjs-client').prototype.dispatchEvent = function() { window.onmessage = this.onmessage; };\")(require); const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 252,
      },
    ],
  },
  {
    name: "constructor-pattern-capability-extraction",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/constructor-pattern-capability-extraction.js",
      relativePath: "src/constructor-pattern-capability-extraction.js",
      content:
        "const { constructor: makeCode } = (() => {}); makeCode('load', \"load('sockjs-client').prototype.dispatchEvent = function() { window.onmessage = this.onmessage; };\")(require); const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 257,
      },
    ],
  },
  {
    name: "reflection-reader-capability-extraction",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/reflection-reader-capability-extraction.js",
      relativePath: "src/reflection-reader-capability-extraction.js",
      content:
        "const readProperty = Reflect.get; const makeCode = readProperty(() => {}, 'constructor'); makeCode('load', \"load('sockjs-client').prototype.dispatchEvent = function() { window.onmessage = this.onmessage; };\")(require); const SockJS = require('sockjs-client'); let connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 301,
      },
    ],
  },
  {
    name: "receiver-duplicate-var-declaration",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/receiver-duplicate-var-declaration.js",
      relativePath: "src/receiver-duplicate-var-declaration.js",
      content:
        "var SockJS = require('sockjs-client'); var connection = new SockJS('/stream'); var connection = window; connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 105,
      },
    ],
  },
  {
    name: "constructor-duplicate-var-declaration",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/constructor-duplicate-var-declaration.js",
      relativePath: "src/constructor-duplicate-var-declaration.js",
      content:
        "var SockJS = require('sockjs-client'); var SockJS = function() { return window; }; var connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 124,
      },
    ],
  },
  {
    name: "handler-before-receiver-initialization",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/handler-before-receiver-initialization.js",
      relativePath: "src/handler-before-receiver-initialization.js",
      content:
        "var SockJS = require('sockjs-client'); connection.onmessage = event => consume(event.data); var connection = new SockJS('/stream');",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 40,
      },
    ],
  },
  {
    name: "instance-before-constructor-initialization",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/instance-before-constructor-initialization.js",
      relativePath: "src/instance-before-constructor-initialization.js",
      content:
        "var connection = new SockJS('/stream'); var SockJS = require('sockjs-client'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 80,
      },
    ],
  },
  {
    name: "compound-handler-assignment",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/compound-handler-assignment.js",
      relativePath: "src/compound-handler-assignment.js",
      content:
        "const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage ||= event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 84,
      },
    ],
  },
  {
    name: "require-cache-member-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/require-cache-member-write.js",
      relativePath: "src/require-cache-member-write.js",
      content:
        "const SockJS = require('sockjs-client'); require.cache[require.resolve('sockjs-client')].exports = function() { return window; }; const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 173,
      },
    ],
  },
  {
    name: "global-require-replaced",
    file: {
      absolutePath: "/synthetic/sockjs-contract-supplement/global-require-replaced.js",
      relativePath: "src/global-require-replaced.js",
      content:
        'require = () => function() { return window; }; const Client = require("sockjs-client"); const connection = new Client("/stream"); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 131,
      },
    ],
  },
  {
    name: "global-require-alias-cache-escape",
    file: {
      absolutePath: "/synthetic/sockjs-contract-supplement/global-require-alias-cache-escape.js",
      relativePath: "src/global-require-alias-cache-escape.js",
      content:
        'const load = require; load.cache[load.resolve("sockjs-client")] = {exports: function() { return window; }}; const Client = require("sockjs-client"); const connection = new Client("/stream"); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 192,
      },
    ],
  },
  {
    name: "duplicate-canonical-require-prototype-setter",
    file: {
      absolutePath:
        "/synthetic/sockjs-contract-supplement/duplicate-canonical-require-prototype-setter.js",
      relativePath: "src/duplicate-canonical-require-prototype-setter.js",
      content:
        'const OtherClient = require("sockjs-client"); Object.defineProperty(OtherClient.prototype,"onmessage",{set(handler){window.onmessage = handler;}}); const Client = require("sockjs-client"); const connection = new Client("/stream"); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 232,
      },
    ],
  },
  {
    name: "constructor-before-initializer",
    file: {
      absolutePath: "/synthetic/sockjs-contract-supplement/constructor-before-initializer.js",
      relativePath: "src/constructor-before-initializer.js",
      content:
        'var connection = new Client("/stream"); var Client = require("sockjs-client"); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 80,
      },
    ],
  },
  {
    name: "parameter-property-captured-binding-write",
    file: {
      absolutePath:
        "/synthetic/sockjs-contract-supplement/parameter-property-captured-binding-write.ts",
      relativePath: "src/parameter-property-captured-binding-write.ts",
      content:
        'const Client = require("sockjs-client"); let connection = new Client("/stream"); class Replacement { constructor(public ignored = (connection = window)) {} } new Replacement(); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 178,
      },
    ],
  },
  {
    name: "wrapped-eval-captured-binding-write",
    file: {
      absolutePath: "/synthetic/sockjs-contract-supplement/wrapped-eval-captured-binding-write.ts",
      relativePath: "src/wrapped-eval-captured-binding-write.ts",
      content:
        'const Client = require("sockjs-client"); let connection = new Client("/stream"); (eval as any)("connection = window"); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 120,
      },
    ],
  },
  {
    name: "require-extra-argument",
    file: {
      absolutePath: "/synthetic/sockjs-contract-supplement/require-extra-argument.js",
      relativePath: "src/require-extra-argument.js",
      content:
        'const Client = require("sockjs-client", window); const connection = new Client("/stream"); connection.onmessage = event => consume(event.data);',
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 92,
      },
    ],
  },
  {
    name: "indirect-window-capability-object-escape",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/indirect-window-capability-object-escape.js",
      relativePath: "src/indirect-window-capability-object-escape.js",
      content:
        "const nativeWindow = window; const makeCode = nativeWindow['Fun' + 'ction']; makeCode('load', \"load('sockjs-client').prototype.dispatchEvent = function() { window.onmessage = this.onmessage; };\")(require); const Client = require('sockjs-client'); const connection = new Client('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 290,
      },
    ],
  },
  {
    name: "shared-prototype-through-get-prototype-of",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/shared-prototype-through-get-prototype-of.js",
      relativePath: "src/shared-prototype-through-get-prototype-of.js",
      content:
        "const Client = require('sockjs-client'); Object.getPrototypeOf(new Client('/stream')).dispatchEvent = function(event) { window.onmessage = this.onmessage; consume(event); }; const connection = new Client('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 217,
      },
    ],
  },
  {
    name: "shared-prototype-through-other-instance",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/shared-prototype-through-other-instance.js",
      relativePath: "src/shared-prototype-through-other-instance.js",
      content:
        "const Client = require('sockjs-client'); const other = new Client('/stream'); other.__proto__.dispatchEvent = function(event) { window.onmessage = this.onmessage; consume(event); }; const connection = new Client('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 225,
      },
    ],
  },
  {
    name: "ordinary-cjs-wrapper-arguments-loader-alias-prototype-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/cjs-arguments-loader-alias.js",
      relativePath: "src/cjs-arguments-loader-alias.js",
      content:
        "arguments[1]('sockjs-client').prototype.dispatchEvent = function() { window.onmessage = this.onmessage; }; const Client = require('sockjs-client'); const connection = new Client('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 191,
      },
    ],
  },
  {
    name: "node-module-direct-loader-prototype-write",
    file: {
      absolutePath: "/synthetic/sockjs-supplemental/node-module-direct-loader-prototype-write.js",
      relativePath: "src/node-module-direct-loader-prototype-write.js",
      content:
        "const NodeModule = require('module'); NodeModule._load('sockjs-client', module).prototype.dispatchEvent = function() { window.onmessage = this.onmessage; }; const Client = require('sockjs-client'); const connection = new Client('/stream'); connection.onmessage = event => consume(event.data);",
      isGeneratedBundle: false,
    },
    findings: [
      {
        message:
          "A message event handler reads cross-window messages without an obvious origin check.",
        line: 1,
        column: 241,
      },
    ],
  },
];

describe("security-scan/postmessage-origin-risk closed CJS stream receivers", () => {
  it.each(cases)("$name", ({ file, findings }) => {
    expect(postmessageOriginRisk.scan?.(file)).toEqual(findings);
  });
});

describe("erased-only require provider", () => {
  it("nominal", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          "const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      }),
    ).toHaveLength(0);
  });
  it("erased-require", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          "interface require {note:string}; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      }),
    ).toHaveLength(0);
  });
  it("erased-constructor", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          "interface SockJS {note:string}; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      }),
    ).toHaveLength(0);
  });
  it("erased-receiver", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          "interface connection {note:string}; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      }),
    ).toHaveLength(0);
  });
  it("nested-type", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          "type Notes = ({nested:{constructor}}:{nested:{constructor:string}})=>void; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      }),
    ).toHaveLength(0);
  });
  it("runtime-loader", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          "class Overrides { constructor(public ignored = Function(\"globalThis.require = () => function(){ return window; }\")()) {} }; new Overrides(); const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
      }),
    ).toHaveLength(1);
  });
  it("runtime require companion", () => {
    expect(
      postmessageOriginRisk.scan?.({
        absolutePath: "/synthetic/erased-require.tsx",
        relativePath: "src/erased-require.tsx",
        isGeneratedBundle: false,
        content:
          'interface require {note:string}; const require=()=>function(){return window}; const SockJS = require("sockjs-client"); const connection = new SockJS("/stream"); connection.onmessage = event => consume(event.data);',
      }),
    ).toHaveLength(1);
  });
});

it("preserves outer ambient value contracts", () => {
  expect(
    postmessageOriginRisk.scan?.({
      absolutePath: "/synthetic/ambient-require.tsx",
      relativePath: "src/ambient-require.tsx",
      isGeneratedBundle: false,
      content:
        'declare const require: unknown; { interface require {note:string}; const SockJS=require("sockjs-client");const connection=new SockJS("/stream");connection.onmessage=event=>consume(event.data); }',
    }),
  ).toHaveLength(1);
});

it("preserves ambient function contract 0", () => {
  expect(
    postmessageOriginRisk.scan?.({
      absolutePath: "/synthetic/ambient-function-require.tsx",
      relativePath: "src/ambient-function-require.tsx",
      isGeneratedBundle: false,
      content:
        "declare function require(name: string): unknown; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
    }),
  ).toHaveLength(1);
});

it("preserves ambient function contract 1", () => {
  expect(
    postmessageOriginRisk.scan?.({
      absolutePath: "/synthetic/ambient-function-require.tsx",
      relativePath: "src/ambient-function-require.tsx",
      isGeneratedBundle: false,
      content:
        "interface require {}; declare function require(name: string): unknown; const SockJS = require('sockjs-client'); const connection = new SockJS('/stream'); connection.onmessage = event => consume(event.data);",
    }),
  ).toHaveLength(1);
});
