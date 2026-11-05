import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFetchResponseUsedWithoutStatusCheck } from "./no-fetch-response-used-without-status-check.js";

const CAUGHT_JSON = "response.json().catch(() => ({}))";
const CHECKED_USE = "if (!response.ok) return; publish(payload);";

const createSource = (bodyRead = CAUGHT_JSON, use = CHECKED_USE, setup = "") => `
  ${setup}
  export const load = async () => {
    const response = await fetch('/records');
    const payload = await ${bodyRead};
    ${use}
  };
`;

describe("caught JSON before a status guard", () => {
  it("keeps the independent unchecked response warning", () => {
    const source = `${createSource()}
      export const unchecked = async () => {
        const other = await fetch('/other');
        return other.json();
      };
    `;
    const result = runRule(noFetchResponseUsedWithoutStatusCheck, source, {
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([
      source.split("\n").findIndex((line) => line.includes("fetch('/other')")) + 1,
    ]);
  });

  it("does not reuse a qualifying response proof for another scope", () => {
    const source = `${createSource()}
      export const other = async (different) => {
        const response = await fetch('/different');
        const payload = await ${CAUGHT_JSON};
        if (!different.ok) return;
        publish(payload);
      };
    `;
    const result = runRule(noFetchResponseUsedWithoutStatusCheck, source, {
      includeLocations: true,
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.line)).toEqual([
      source.split("\n").findIndex((line) => line.includes("fetch('/different')")) + 1,
    ]);
  });

  it("keeps a warning when a hoisted callback captures the payload", () => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      `export const load = async () => {
        const response = await fetch(scheduleAndGetUrl(() => leak()));
        const payload = await ${CAUGHT_JSON};
        if (!response.ok) return;
        function leak() { publish(payload); }
        publish(payload);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["the same response's success guard", CHECKED_USE],
    ["a braced early return", "if (!(response.ok)) { return; } publish(payload);"],
    ["a literal index after the check", "if (!response.ok) return; publish(payload.items?.[0]);"],
  ])("accepts %s before every payload use", (_label, use) => {
    const result = runRule(noFetchResponseUsedWithoutStatusCheck, createSource(CAUGHT_JSON, use));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["a read before status", "publish(payload); if (!response.ok) return;"],
    [
      "a derived binding that leaks before status",
      "const derived = publish(payload); if (!response.ok) return; return derived;",
    ],
    ["a nonterminating check", "if (!response.ok) logFailure(); publish(payload);"],
    ["an inverted early exit", "if (response.ok) return; publish(payload);"],
    ["another response's status", "if (!other.ok) return; publish(payload);"],
    [
      "an error payload returned from the guard",
      "if (!response.ok) return payload; publish(payload);",
    ],
    ["a captured result", "if (!response.ok) return; return () => publish(payload);"],
    ["a result used in finally", "try { if (!response.ok) return; } finally { publish(payload); }"],
    ["a nested finally use", "if (!response.ok) return; try {} finally { publish(payload); }"],
    ["a computed status property", "if (!response['ok']) return; publish(payload);"],
    [
      "another unguarded body read",
      "publish(await response.text()); if (!response.ok) return; publish(payload);",
    ],
  ])("keeps reporting %s", (_label, use) => {
    const result = runRule(noFetchResponseUsedWithoutStatusCheck, createSource(CAUGHT_JSON, use));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["a nonlocal fallback", "response.json().catch(() => fallback)"],
    ["a rejection callback with effects", "response.json().catch((error) => publish(error))"],
    ["a default parameter", "response.json().catch((error = publish()) => ({}))"],
    ["an asynchronous fallback", "response.json().catch(async () => ({}))"],
    [
      "a fallback with a then getter",
      "response.json().catch(() => ({ get then() { publish(); } }))",
    ],
    ["a transform before catch", "response.json().then(publish).catch(() => ({}))"],
    ["a transform after catch", "response.json().catch(() => ({})).then(publish)"],
    ["an optional body call", "response.json?.().catch(() => ({}))"],
    ["an optional catch call", "response.json().catch?.(() => ({}))"],
    ["a computed body method", "response['json']().catch(() => ({}))"],
    ["a computed catch method", "response.json()['catch'](() => ({}))"],
    ["a non-JSON body read", "response.text().catch(() => ({}))"],
  ])("declines %s", (_label, bodyRead) => {
    const result = runRule(noFetchResponseUsedWithoutStatusCheck, createSource(bodyRead));
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    ["Promise.then interception", "Promise.prototype.then = intercept;"],
    ["Promise.catch interception", "Promise.prototype.catch = intercept;"],
    ["Response.json replacement", "Response.prototype.json = intercept;"],
    ["Response.ok replacement", "Object.defineProperty(Response.prototype, 'ok', descriptor);"],
    ["fallback then assimilation", "Object.prototype.then = intercept;"],
    [
      "a different realm handle",
      "const realm = document.defaultView; realm.Promise.prototype.then = intercept;",
    ],
    ["an unknown provider mutation", "provider[key] = intercept;"],
    ["an unknown provider read", "const method = provider[key]; expose(method);"],
    ["an unknown destructured provider", "const { [key]: method } = provider; expose(method);"],
    ["a destructured prototype", "const { __proto__: proto } = (async () => {})(); expose(proto);"],
    [
      "a destructured provider",
      "const { ['Promise']: nativePromise } = provider; expose(nativePromise);",
    ],
    ["a legacy accessor", "provider['__defineGetter__']('then', getter);"],
    [
      "a legacy accessor lookup",
      "const getter = provider.__lookupGetter__('then'); expose(getter);",
    ],
    [
      "a destructured promise prototype with a legacy getter",
      `const { __proto__: proto } = (async () => {})();
       const original = proto.then;
       proto.__defineGetter__('then', () => function(fulfilled, rejected) {
         return original.call(this, value => {
           if (value?.marker) publish(value);
           return fulfilled ? fulfilled(value) : value;
         }, rejected);
       });`,
    ],
    ["a CommonJS argument frame", "arguments[1]('node:vm').runInThisContext(source);"],
    ["a TypeScript module loader", "import runtime = require('node:vm'); expose(runtime);"],
    ["fetch replacement", "fetch = intercept;"],
  ])("keeps reporting when the source exposes %s", (_label, setup) => {
    const result = runRule(
      noFetchResponseUsedWithoutStatusCheck,
      createSource(CAUGHT_JSON, CHECKED_USE, setup),
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
