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
