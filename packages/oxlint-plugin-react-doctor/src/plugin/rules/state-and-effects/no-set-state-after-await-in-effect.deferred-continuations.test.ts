import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

describe("no-set-state-after-await-in-effect deferred continuations", () => {
  it.each([
    "queueMicrotask(() => setValue(id));",
    "Promise.resolve(id).then((result) => setValue(result));",
    "Promise.resolve(id).then((result) => { return setValue(result); });",
    "Promise.resolve(id)['then'](((result) => setValue(result)) as (value: number) => void);",
    "Promise.reject(id).catch(() => setValue(id));",
    "Promise.resolve(id).finally(() => setValue(id));",
    "Promise.reject(id).then(undefined, () => setValue(id));",
    "const pending = Promise.resolve(id); pending.catch = (callback) => callback(id); pending.then((result) => setValue(result));",
    "const pending = Promise.resolve(id); pending.then((result) => setValue(result));",
    "const pending = Promise.resolve(id); pending.constructor = null; pending.then((result) => setValue(result));",
    "fetch(`/lookup/${id}`).then((response) => setValue(response));",
    'globalThis.fetch(`/lookup/${id}`, { method: "GET", credentials: "same-origin" }).then((response) => setValue(response));',
    'fetch(`/lookup/${id}`, { headers: { Accept: "application/json" } }).then((response) => setValue(response));',
    "const endpoint = `/lookup/${id}`; const pending = fetch(endpoint); const request = pending; request.then((response) => setValue(response));",
    "const requestData = globalThis.fetch; requestData(`/lookup/${id}`).then((response) => setValue(response));",
    "const protocol = Object.getPrototypeOf({}); protocol.localMarker = id; Reflect.getPrototypeOf(Promise.resolve()).then; fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "const readPrototype = Reflect.getPrototypeOf; const readAgain = readPrototype; const protocol = readAgain({}); protocol.localMarker = id; fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "fetch(`/lookup/${id}`).catch(() => setValue(id));",
    "fetch(`/lookup/${id}`).finally(() => setValue(id));",
    "const load = () => queueMicrotask(() => setValue(id)); load();",
    "let ignore = false; if (!ignore) queueMicrotask(() => setValue(id)); return () => { ignore = true; };",
    "let ignore = false; queueMicrotask(() => { ignore = false; if (!ignore) setValue(id); }); return () => { ignore = true; };",
    "let ignore = false; Promise.resolve(id).then(async (result) => { if (ignore) return; await load(); setValue(result); }); return () => { ignore = true; };",
    "const controller = new AbortController(); Promise.resolve(id).finally(() => setValue(id)); return () => controller.abort();",
  ])("reports an unguarded deferred write: %s", (effectBody) => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Component = ({ id }) => {
        const [value, setValue] = useState(null);
        useEffect(() => { ${effectBody} }, [id]);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "queueMicrotask(function* () { setValue(id); });",
    "queueMicrotask(async function* () { setValue(id); });",
    "Promise.resolve(id).then(function* () { setValue(id); });",
    "Promise.reject(id).catch(async function* () { setValue(id); });",
    "Promise.resolve(id).finally(function* () { setValue(id); });",
    "Promise.resolve(id).then(async function* () { await load(); setValue(id); });",
    "Promise.resolve(id).then(function* () { queueMicrotask(() => setValue(id)); });",
    "const pending = Promise.resolve(id); pending.catch = (callback) => callback(id); pending.then(() => {}); pending.catch(() => setValue(id));",
    "const pending = Promise.resolve(id); Object.defineProperty(pending, 'then', { value: (callback) => callback(id) }); pending.then((result) => setValue(result));",
    "const pending = Promise.resolve(id); Object.assign(pending, { then: (callback) => callback(id) }); pending.then((result) => setValue(result));",
    "const pending = Promise.resolve(id); installImmediateThen(pending); pending.then((result) => setValue(result));",
    "Object.defineProperty(Promise, 'resolve', { value: (value) => ({ then(callback) { callback(value); } }) }); Promise.resolve(id).then((result) => setValue(result));",
    "Object.defineProperty(globalThis, 'queueMicrotask', { value: (callback) => callback() }); queueMicrotask(() => setValue(id));",
    "Object.assign(globalThis, { Promise: { resolve: (value) => ({ then(callback) { callback(value); } }) } }); Promise.resolve(id).then((result) => setValue(result));",
    "globalThis.Promise = { resolve: (value) => ({ then(callback) { callback(value); } }) }; Promise.resolve(id).then((result) => setValue(result));",
    "const key = 'queueMicrotask'; globalThis[key] = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "let ignore = false; queueMicrotask(() => { if (!ignore) setValue(id); }); return () => { ignore = true; };",
    "let ignore = false; Promise.resolve(id).then((result) => { if (ignore) return; setValue(result); }); return () => { ignore = true; };",
    "let ignore = false; const pending = Promise.resolve(id); pending.then((result) => { if (!ignore) setValue(result); }); return () => { ignore = true; };",
    "let ignore = false; Promise.resolve(id).then(async (result) => { await load(); if (ignore) return; setValue(result); }); return () => { ignore = true; };",
    "let ignore = false; Promise.resolve(id).finally(() => { if (ignore) return; setValue(id); }); return () => { ignore = true; };",
    "let ignore = false; queueMicrotask(() => { if (ignore) return; return setValue(id); }); return () => { ignore = true; };",
    "const unused = () => queueMicrotask(() => setValue(id));",
    "const unused = () => Promise.resolve(id).then((result) => setValue(result));",
    "unknown.then((result) => setValue(result));",
    "load(id).then((result) => setValue(result));",
    "const load = async () => id; load().then((result) => setValue(result));",
    "const controller = new AbortController(); const load = async () => await fetch(id, { signal: controller.signal }); load().then((result) => setValue(result)); return () => controller.abort();",
    "fetch(id).then((result) => setValue(result));",
    "const lookup = new Request(`/lookup/${id}`); fetch(lookup).then((response) => setValue(response));",
    "const options = makeOptions(id); fetch(`/lookup/${id}`, options).then((response) => setValue(response));",
    "fetch(`/lookup/${id}`, { ...makeOptions(id) }).then((response) => setValue(response));",
    "fetch(`/lookup/${id}`, { [key]: controller.signal }).then((response) => setValue(response));",
    'fetch(`/lookup/${id}`, { get method() { return "GET"; } }).then((response) => setValue(response));',
    "fetch(`/lookup/${id}`, { method: configureMethod() }).then((response) => setValue(response));",
    "fetch(`/lookup/${id}`, { __proto__: { signal: controller.signal } }).then((response) => setValue(response));",
    'const { prototype: optionsPrototype } = Object; optionsPrototype.signal = controller.signal; fetch(`/lookup/${id}`, { method: "GET" }).then((response) => setValue(response));',
    "Object.prototype.signal = controller.signal; fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "const controller = new AbortController(); Object.getPrototypeOf({}).signal = controller.signal; fetch(`/lookup/${id}`, {}).then((response) => setValue(response)); return () => controller.abort();",
    'const controller = new AbortController(); const { getPrototypeOf: getParent } = Reflect; const protocol = getParent({}); const alias = protocol; Reflect.set(alias, "signal", controller.signal); fetch(`/lookup/${id}`).then((response) => setValue(response)); return () => controller.abort();',
    "let readPrototype = Reflect.getPrototypeOf; readPrototype(fetch(`/probe/${id}`)).then = (publish) => publish(id); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "let readPrototype = Object.getPrototypeOf; readPrototype(fetch(`/probe/${id}`)).then = (publish) => publish(id); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "let { getPrototypeOf: readPrototype } = Reflect; readPrototype(fetch(`/probe/${id}`)).then = (publish) => publish(id); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "const controller = new AbortController(); ({}).__proto__.signal = controller.signal; fetch(`/lookup/${id}`).then((response) => setValue(response)); return () => controller.abort();",
    "const protocol = Object.getPrototypeOf(Promise.resolve()); protocol.then = (publish) => publish(id); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    'eval("globalThis.fetch = () => ({ then(callback) { callback(null); } })"); fetch(`/lookup/${id}`).then((response) => setValue(response));',
    'const { eval: evaluate } = globalThis; evaluate("globalThis.fetch = () => ({ then(callback) { callback(null); } })"); fetch(`/lookup/${id}`).then((response) => setValue(response));',
    'const controller = new AbortController(); const getPrototype = Reflect[readMethod()]; getPrototype({}).signal = controller.signal; fetch(`/lookup/${id}`, { method: "GET" }).then((response) => setValue(response)); return () => controller.abort();',
    "fetch(`/lookup/${id}`, { headers: { get Accept() { return configureHeaders(); } } }).then((response) => setValue(response));",
    "fetch(`/lookup/${id}`, { headers: { ...makeHeaders(id) } }).then((response) => setValue(response));",
    "fetch(`/lookup/${id}`, { headers: { __proto__: makeHeaders(id) } }).then((response) => setValue(response));",
    "const controller = new AbortController(); fetch(`/lookup/${id}`, { signal: controller.signal }).then((response) => setValue(response)); return () => controller.abort();",
    "const controller = new AbortController(); fetch(`/lookup/${id}`, { signal: controller.signal }).catch(() => setValue(id)); return () => controller.abort();",
    "const fetch = () => ({ then: (publish) => publish(id) }); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "globalThis.fetch = () => ({ then: (publish) => publish(id) }); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "fetch = () => ({ then: (publish) => publish(id) }); globalThis.fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "const pending = fetch(`/lookup/${id}`); exposeRequest(pending); pending.then((response) => setValue(response));",
    "const pending = fetch(`/lookup/${id}`); pending.then = (publish) => publish(id); pending.then((response) => setValue(response));",
    "const pending = fetch(`/lookup/${id}`); const alias = pending; alias.constructor = null; pending.then((response) => setValue(response));",
    "const pending = fetch(`/lookup/${id}`); pending.then = (_fulfilled, rejected) => rejected(id); pending.catch((error) => setValue(error));",
    "const pending = fetch(`/lookup/${id}`); pending.then = (fulfilled) => fulfilled(id); pending.finally(() => setValue(id));",
    "const protocol = Promise.prototype; protocol.then = (publish) => publish(id); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "Promise.prototype.then = (publish) => publish(id); fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "let ignore = false; fetch(`/lookup/${id}`).then((response) => { if (ignore) return; setValue(response); }); return () => { ignore = true; };",
    "const neverCalled = () => fetch(`/lookup/${id}`).then((response) => setValue(response));",
    "const controller = new AbortController(); fetch(`/lookup/${id}`).then(() => fetch(`/next/${id}`, { signal: controller.signal })).then((response) => setValue(response)); return () => controller.abort();",
    "const controller = new AbortController(); fetch(`/lookup/${id}`).then(async () => await fetch(`/next/${id}`, { signal: controller.signal })).then((response) => setValue(response)); return () => controller.abort();",
    'let inactive = false; fetch(`/lookup/${id}`).then((response) => { if (inactive) throw new Error("Cancelled"); return response; }).then((response) => setValue(response)); return () => { inactive = true; };',
    "fetch(`/lookup/${id}`).then((response) => response.json()).then((payload) => setValue(payload));",
    "const immediate = { then(callback) { callback(id); } }; immediate.then((result) => setValue(result));",
    "const makeImmediate = () => ({ then(callback) { callback(id); } }); makeImmediate().then((result) => setValue(result));",
    "const queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const Promise = { resolve: (value) => ({ then(callback) { callback(value); } }) }; Promise.resolve(id).then((result) => setValue(result));",
    "let pending = Promise.resolve(id); pending = immediate; pending.then((result) => setValue(result));",
    "const pending = Promise.resolve(id); pending.then = (callback) => callback(id); pending.then((result) => setValue(result));",
    "const pending = Promise.resolve(id); const alias = pending; alias.then = (callback) => callback(id); pending.then((result) => setValue(result));",
    "Promise.resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "globalThis.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "Promise.prototype.then = (callback) => callback(id); new Promise((resolve) => resolve(id)).then((result) => setValue(result));",
    "Promise = customPromise; Promise.resolve(id).then((result) => setValue(result));",
    "const { pending } = Promise.resolve(id); pending.then((result) => setValue(result));",
    "let load = async () => id; load = makeImmediate; load().then((result) => setValue(result));",
    "async function* stream() { yield id; } stream().then((result) => setValue(result));",
    "new Promise(() => setValue(id));",
    "if (false) queueMicrotask(() => setValue(id));",
    "queueMicrotask(() => { if (false) setValue(id); });",
    "return; Promise.resolve(id).then((result) => setValue(result));",
    "setTimeout(() => setValue(id));",
  ])("preserves guarded writes and opaque callbacks: %s", (effectBody) => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Component = ({ id }) => {
        const [value, setValue] = useState(null);
        useEffect(() => { ${effectBody} }, [id]);
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["[]", "[setValue]"])("preserves stable dependencies: %s", (dependencies) => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `const Component = () => {
        const [value, setValue] = useState(null);
        useEffect(() => {
          queueMicrotask(() => setValue(1));
          Promise.resolve(1).then((result) => setValue(result));
          fetch("/lookup").then((response) => setValue(response));
        }, ${dependencies});
      };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("uses cleanup lifecycle wording for layout effect microtasks", () => {
    const result = runRule(
      noSetStateAfterAwaitInEffect,
      `import { useLayoutEffect as useCommit, useState as useValue } from "react";
       const Component = ({ id }) => {
         const [value, setValue] = useValue(null);
         useCommit(() => { queueMicrotask(() => setValue(id)); }, [id]);
       };`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("cleaned up");
    expect(result.diagnostics[0]?.message).not.toContain("out of order");
  });
});

const runFetchContinuation = (effectBody: string, dependencies = "[id]") =>
  runRule(
    noSetStateAfterAwaitInEffect,
    `const Component = ({ id }) => {
      const [, setValue] = useState(null);
      useEffect(() => { ${effectBody} }, ${dependencies});
    };`,
  );

describe("no-set-state-after-await-in-effect native fetch fulfillment", () => {
  it.each([
    'fetch("/catalog").then((result) => setValue(result));',
    "fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "let ignore = false; if (!ignore) fetch(`/catalog/${id}`).then((result) => setValue(result)); return () => { ignore = true; };",
    "let ignore = false; fetch(`/catalog/${id}`).then((result) => { ignore = false; if (!ignore) setValue(result); }); return () => { ignore = true; };",
    "const controller = new AbortController(); fetch(`/catalog/${id}`).then((result) => setValue(result)); return () => controller.abort();",
    "const pending = fetch(`/catalog/${id}`); pending.then((result) => setValue(result));",
    "fetch(`/catalog/${id}`).then((result) => setValue(result), reportError);",
    "const load = () => fetch(`/catalog/${id}`).then((result) => setValue(result)); load();",
  ])("reports the unguarded deferred fulfillment: %s", (effectBody) => {
    const result = runFetchContinuation(effectBody);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("cleaned up");
  });

  it.each([
    "let ignore = false; fetch(`/catalog/${id}`).then((result) => { if (ignore) return; setValue(result); }); return () => { ignore = true; };",
    "let active = true; fetch(`/catalog/${id}`).then((result) => { if (active) setValue(result); }); return () => { active = false; };",
    "const fetch = () => ({ then(callback) { callback(id); } }); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "fetch = () => ({ then(callback) { callback(id); } }); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "const host = globalThis; host.fetch = () => ({ then(callback) { callback(id); } }); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "const nativeFetch = fetch; registerFetch(nativeFetch); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "const nativeFetch = fetch; nativeFetch(id).then((result) => setValue(result));",
    "Promise.prototype.then = (callback) => callback(id); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "const prototypeAlias = Promise.prototype; prototypeAlias.then = (callback) => callback(id); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "Reflect.getPrototypeOf(fetch(`/catalog/${id}`)).then = (callback) => callback(id); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "const { constructor: NativePromise } = fetch(`/catalog/${id}`); NativePromise.prototype.then = (callback) => callback(id); fetch(`/catalog/${id}`).then((result) => setValue(result));",
    "const controller = new AbortController(); fetch(id, { signal: controller.signal }).then((result) => setValue(result)); return () => controller.abort();",
    "const controller = new AbortController(); const request = new Request(`/catalog/${id}`, { signal: controller.signal }); fetch(request).then((result) => setValue(result)); return () => controller.abort();",
    "const controller = new AbortController(); fetch(new Request(`/catalog/${id}`, { signal: controller.signal })).then((result) => setValue(result)); return () => controller.abort();",
    "const load = () => { fetch(`/catalog/${id}`).then((result) => setValue(result)); }; if (false) load();",
    "fetch(id).then((result) => setValue(result));",
    "const load = () => fetch(`/catalog/${id}`).then((result) => setValue(result)); const delegate = () => { if (false) load(); }; delegate();",
  ])("preserves guarded or unproved continuations: %s", (effectBody) => {
    const result = runFetchContinuation(effectBody);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["[]", "[setValue]"])("preserves stable dependencies: %s", (dependencies) => {
    const result = runFetchContinuation(
      'fetch("/catalog").then((result) => setValue(result));',
      dependencies,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
