import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

const cachedReader = `
const cache = new WeakMap();
const read = (key) => {
  const cached = cache.get(key);
  if (cached) return cached;
  const promise = fetchValue(key);
  cache.set(key, promise);
  return promise;
};
const format = async (key) => {
  const value = await read(key);
  return String(value);
};
`;

describe("server-sequential-independent-await cached-async-work", () => {
  it.each([
    {
      name: "opaque helpers sharing the same input in the pinned Promise.all/then shape",
      code: `
import { read, format, snippet } from "./context";
async function load(element) {
  const [html, stack] = await Promise.all([snippet(element), read(element).then(value => value ?? [])]);
  const text = await format(element);
  return [html, stack, text];
}`,
    },
    {
      name: "a local formatter awaiting the same cached reader",
      code: `${cachedReader}
async function load(element) {
  const [stack] = await Promise.all([read(element).then(value => value ?? [])]);
  const text = await format(element);
  return [stack, text];
}`,
    },
    {
      name: "function and input aliases through transparent TypeScript wrappers",
      code: `${cachedReader}
const readAlias = read;
const formatAlias = format;
async function load(element) {
  const key = element;
  const first = await readAlias((element as Element)!);
  const second = await formatAlias(key);
  return [first, second];
}`,
    },
    {
      name: "two local wrappers sharing the reader",
      code: `${cachedReader}
const summary = async (target) => {
  const value = await read(target);
  return value.length;
};
async function load(element) {
  const first = await summary(element);
  const second = await format(element);
  return [first, second];
}`,
    },
    {
      name: "an imported namespace and renamed import sharing an input",
      code: `
import * as source from "./context";
import { format as formatValue } from "./context";
async function load(element) {
  const first = await source.read(element);
  const second = await formatValue(element);
  return [first, second];
}`,
    },
  ])("does not assert independence for $name", ({ code }) => {
    const result = runRule(serverSequentialIndependentAwait, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    {
      name: "direct fetch requests even with the same URL binding",
      code: `
async function load(url) {
  const first = await fetch(url);
  const second = await fetch(url);
  return [first, second];
}`,
    },
    {
      name: "repeated calls to a local helper that always starts a fresh request",
      code: `
const read = (key) => fetch("/value/" + key);
async function load(key) {
  const first = await read(key);
  const second = await read(key);
  return [first, second];
}`,
    },
    {
      name: "separate cache instances with matching key names",
      code: `
const firstCache = new WeakMap();
const secondCache = new WeakMap();
const read = (key) => firstCache.get(key) ?? fetchValue(key);
const format = (key) => secondCache.get(key) ?? fetchValue(key);
async function load(key) {
  const first = await read(key);
  const second = await format(key);
  return [first, second];
}`,
    },
    {
      name: "fresh caches created inside each invocation",
      code: `
const read = (key) => {
  const cache = new WeakMap();
  return cache.get(key) ?? fetchValue(key);
};
async function load(key) {
  const first = await read(key);
  const second = await read(key);
  return [first, second];
}`,
    },
    {
      name: "distinct opaque input bindings",
      code: `
import { read, format } from "./context";
async function load(firstKey, secondKey) {
  const first = await read(firstKey);
  const second = await format(secondKey);
  return [first, second];
}`,
    },
    {
      name: "different arguments passed to the same cached reader",
      code: `${cachedReader}
async function load(firstKey, secondKey) {
  const first = await read(firstKey);
  const second = await format(secondKey);
  return [first, second];
}`,
    },
    {
      name: "local fetch wrappers using the same input",
      code: `
const readUser = (key) => fetch("/user/" + key);
const readPosts = (key) => fetch("/posts/" + key);
async function load(key) {
  const first = await readUser(key);
  const second = await readPosts(key);
  return [first, second];
}`,
    },
    {
      name: "a shadowed callable with the same spelling",
      code: `${cachedReader}
async function load(element) {
  const read = (key) => fetch("/fresh/" + key);
  const first = await read(element);
  const second = await format(element);
  return [first, second];
}`,
    },
    {
      name: "a shadowed parameter with the same spelling",
      code: `
import { read, format } from "./context";
const formatOther = async (other) => {
  const element = {};
  return format(element);
};
async function load(element) {
  const first = await read(element);
  const second = await formatOther(element);
  return [first, second];
}`,
    },
    {
      name: "a deferred function containing a coincidental shared call",
      code: `${cachedReader}
const later = async (element) => {
  const deferred = () => read(element);
  return fetch("/fresh");
};
async function load(element) {
  const first = await read(element);
  const second = await later(element);
  return [first, second];
}`,
    },
    {
      name: "a reassigned local callable",
      code: `${cachedReader}
let replacement = read;
replacement = (key) => fetch("/fresh");
async function load(element) {
  const first = await replacement(element);
  const second = await format(element);
  return [first, second];
}`,
    },
    {
      name: "a bound function with a different cache key",
      code: `${cachedReader}
const other = {};
const readOther = read.bind(null, other);
async function load(element) {
  const first = await readOther(element);
  const second = await format(element);
  return [first, second];
}`,
    },
    {
      name: "an input written by the earlier helper",
      code: `
import { read, format } from "./context";
let key = {};
const change = async () => {
  const result = await read(key);
  key = {};
  return result;
};
async function load() {
  const first = await change();
  const second = await format(key);
  return [first, second];
}`,
    },
    {
      name: "independent requests with a recursive local helper",
      code: `
const repeat = (key) => repeat(key);
async function load(key) {
  const first = await repeat(key);
  const second = await fetch("/fresh");
  return [first, second];
}`,
    },
  ])("retains the warning for $name", ({ code }) => {
    const result = runRule(serverSequentialIndependentAwait, code);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
