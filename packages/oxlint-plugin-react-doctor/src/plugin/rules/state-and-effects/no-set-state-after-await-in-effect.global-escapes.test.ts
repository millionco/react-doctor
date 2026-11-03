import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

describe("no-set-state-after-await-in-effect global capability escapes", () => {
  it.each([
    "const carrier = { host: globalThis }; carrier.host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const carrier = [globalThis]; carrier[0].queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const getHost = () => globalThis; getHost().queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const getHost = () => { return globalThis; }; getHost().queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "let host = globalThis; host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const carrier = { native: Promise }; carrier.native.resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "const carrier = [Promise]; carrier[0].resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "const getPromise = () => Promise; getPromise().resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "const carrier = { host: globalThis }; carrier.host.Promise = { resolve: (value) => ({ then(callback) { callback(value); } }) }; Promise.resolve(id).then((result) => setValue(result));",
    "const carrier = [globalThis]; carrier[0].Promise = { resolve: (value) => ({ then(callback) { callback(value); } }) }; Promise.resolve(id).then((result) => setValue(result));",
    "let native = Promise; native.resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "class Immediate { constructor(host) { host.queueMicrotask = (callback) => callback(); } } new Immediate(globalThis); queueMicrotask(() => setValue(id));",
    "const carrier = { native: Promise }; carrier.native.prototype.then = (callback) => callback(id); new Promise((resolve) => resolve(id)).then((result) => setValue(result));",
    "const carrier = {}; carrier.host = globalThis; carrier.host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const host = id ? globalThis : {}; host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const host = id && globalThis; host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const host = (id, globalThis); host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const carrier = [...[globalThis]]; carrier[0].queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const carrier = { native: (Promise as PromiseConstructor) }; carrier.native.resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "const getHost = async () => await globalThis; getHost().then((host) => { host.queueMicrotask = (callback) => callback(); }); queueMicrotask(() => setValue(id));",
    "function* hosts() { yield globalThis; } hosts().next().value.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
  ])("declines an indirectly replaceable deferred API: %s", (effectBody) => {
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

  it.each([
    "const host = globalThis; queueMicrotask(() => setValue(id));",
    "const host = globalThis; const nextHost = host; queueMicrotask(() => setValue(id));",
    "const native = Promise; Promise.resolve(id).then((result) => setValue(result));",
    "const { Promise: native } = globalThis; Promise.resolve(id).then((result) => setValue(result));",
    "const { globalThis: host } = globalThis; queueMicrotask(() => setValue(id));",
    "const carrier = { host: {} }; carrier.host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const carrier = [() => {}]; queueMicrotask(() => setValue(id));",
  ])("retains proven native continuations: %s", (effectBody) => {
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
});
