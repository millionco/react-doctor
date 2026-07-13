import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSyncXhr } from "./no-sync-xhr.js";

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
