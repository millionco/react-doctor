import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noSetStateAfterAwaitInEffect } from "./no-set-state-after-await-in-effect.js";

describe("no-set-state-after-await-in-effect native function metadata", () => {
  it.each([
    "const labels = [Promise.name]; Promise.resolve(id).then((result) => setValue(result));",
    "const details = { arity: Promise.length }; Promise.resolve(id).then((result) => setValue(result));",
    "const readName = () => Promise.name; Promise.resolve(id).then((result) => setValue(result));",
    "const readLength = () => { return Promise.length; }; Promise.resolve(id).then((result) => setValue(result));",
    "const native = Promise; const labels = [native.name]; Promise.resolve(id).then((result) => setValue(result));",
    "const { Promise: native } = globalThis; const labels = [native.name]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [globalThis.Promise.name]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [Promise['name']]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [Promise[`length`]]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [(Promise.name as string)]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [queueMicrotask.name]; queueMicrotask(() => setValue(id));",
    "const details = { arity: queueMicrotask.length }; queueMicrotask(() => setValue(id));",
    "const readName = () => queueMicrotask.name; queueMicrotask(() => setValue(id));",
    "const schedule = queueMicrotask; const labels = [schedule['name']]; queueMicrotask(() => setValue(id));",
  ])("retains native deferred writes after primitive metadata reads: %s", (effectBody) => {
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
    "Object.defineProperty(Promise, 'name', { value: Promise }); const metadata = [Promise.name]; metadata[0].resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "Object.defineProperty(Promise, 'length', { get: () => Promise }); const metadata = [Promise.length]; metadata[0].resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "const native = Promise; Object.defineProperty(native, 'name', { value: native }); const metadata = [native.name]; metadata[0].resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "Object.defineProperty(queueMicrotask, 'name', { get() { globalThis.queueMicrotask = (callback) => callback(); return 'immediate'; } }); const labels = [queueMicrotask.name]; queueMicrotask(() => setValue(id));",
    "const carrier = { native: Promise }; const labels = [Promise.name]; carrier.native.resolve = (value) => ({ then(callback) { callback(value); } }); Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [Promise.name]; const carrier = { host: globalThis }; carrier.host.queueMicrotask = (callback) => callback(); queueMicrotask(() => setValue(id));",
    "const carrier = [Promise.prototype]; carrier[0].then = (callback) => callback(id); const labels = [Promise.name]; new Promise((resolve) => resolve(id)).then((result) => setValue(result));",
    "const Promise = { name: 'immediate', resolve: (value) => ({ then(callback) { callback(value); } }) }; const labels = [Promise.name]; Promise.resolve(id).then((result) => setValue(result));",
    "const key = 'name'; const labels = [Promise[key]]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [Promise[metadataKey]]; Promise.resolve(id).then((result) => setValue(result));",
    "const labels = [Promise.resolve.name]; Promise.resolve(id).then((result) => setValue(result));",
  ])("keeps replaced or opaque native capabilities quiet: %s", (effectBody) => {
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
});
