import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSyncXhr } from "./no-sync-xhr.js";

describe("copied parameter body-var mutation", () => {
  it.each([
    ["separate body var", "receiver, ignored = 0", "var receiver; receiver.open = customOpen;", 0],
    ["simple parameters", "receiver", "var receiver; receiver.open = customOpen;", 0],
    ["direct parameter", "receiver, ignored = 0", "receiver.open = customOpen;", 0],
    ["no method replacement", "receiver, ignored = 0", "var receiver;", 1],
    [
      "nested block var hoisting",
      "receiver, ignored = 0",
      "if (enabled) { var receiver; } receiver.open = customOpen;",
      0,
    ],
    [
      "initializer reads incoming value",
      "receiver, ignored = 0",
      "var receiver = (receiver.open = customOpen, {});",
      0,
    ],
    [
      "distinct block binding",
      "receiver, ignored = 0",
      "{ const receiver = {}; receiver.open = customOpen; }",
      1,
    ],
    ["forwarded body var", "receiver, ignored = 0", "var receiver; mutate(receiver);", 0],
  ])("%s", (_, parameters, body, diagnosticCount) => {
    const result = runRule(
      noSyncXhr,
      `function mutate(value) { value.open = customOpen; }
       function replace(${parameters}) { ${body} }
       const request = new XMLHttpRequest();
       replace(request);
       request.open("GET", "/", false);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(diagnosticCount);
  });

  it("tracks returned body-var values forwarded to a mutating helper", () => {
    const result = runRule(
      noSyncXhr,
      `function copy(receiver, ignored = 0) { var receiver; return receiver; }
       function replace(receiver) { receiver.open = customOpen; }
       const request = new XMLHttpRequest();
       const alias = copy(request);
       replace(alias);
       request.open("GET", "/", false);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("js-performance/no-sync-xhr — regressions", () => {
  // Docs-validation FP wave: vendored emscripten output under `public/`
  // (FreeCut moss-tts shape) runs its sync-XHR paths only inside web-worker
  // guards, and rewriting generated third-party assets is not an applicable
  // fix.
  it("stays silent on vendored static assets under public/", () => {
    const { diagnostics } = runRule(
      noSyncXhr,
      `if (ENVIRONMENT_IS_WORKER) {\n  readBinary = (url) => {\n    var xhr = new XMLHttpRequest();\n    xhr.open("GET", url, false);\n    xhr.send(null);\n    return new Uint8Array(xhr.response);\n  };\n}`,
      { filename: "/repo/public/moss-tts/tokenizer_sandbox.js" },
    );
    expect(diagnostics).toEqual([]);
  });

  it("still flags a synchronous XHR in app source", () => {
    const { diagnostics } = runRule(
      noSyncXhr,
      `const xhr = new XMLHttpRequest();\nxhr.open("GET", url, false);\nxhr.send(null);`,
      { filename: "/repo/src/lib/fetch-sync.ts" },
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("still flags a synchronous XHR on an un-reassigned let receiver", () => {
    const { diagnostics } = runRule(
      noSyncXhr,
      `let request = new XMLHttpRequest();\nrequest.open("GET", "/api", false);\nrequest.send(null);`,
      { filename: "/repo/src/lib/fetch-sync.ts" },
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("still flags a synchronous XHR on an un-reassigned var receiver", () => {
    const { diagnostics } = runRule(
      noSyncXhr,
      `var request = new XMLHttpRequest();\nrequest.open("GET", "/api", false);\nrequest.send(null);`,
      { filename: "/repo/src/lib/fetch-sync.ts" },
    );
    expect(diagnostics).toHaveLength(1);
  });

  it("does not trust a reassigned let receiver", () => {
    const { diagnostics } = runRule(
      noSyncXhr,
      `let request = new XMLHttpRequest();\nrequest = createTransport();\nrequest.open("GET", "/api", false);\nrequest.send(null);`,
      { filename: "/repo/src/lib/fetch-sync.ts" },
    );
    expect(diagnostics).toEqual([]);
  });
});
