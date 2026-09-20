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
      name: "a local wrapper calling the same namespace member with const aliases",
      code: `
import * as source from "./context";
const sourceAlias = source;
const format = async (target) => {
  const key = target;
  const value = await sourceAlias["read"](key);
  return String(value);
};
async function load(element) {
  const first = await source.read(element);
  const second = await format(element);
  return [first, second];
}`,
    },
    {
      name: "const callee aliases and all arguments forwarded in order",
      code: `
import { read } from "./context";
const readAlias = read;
const format = async (target, options) => {
  const value = await readAlias(target, options);
  return String(value);
};
async function load(element, options) {
  const first = await read(element, options);
  const second = await format(element, options);
  return [first, second];
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
      name: "a local formatter delegating to the same renamed import",
      code: `
import { read as readValue } from "./context";
const format = async (target) => {
  const value = await readValue(target);
  return String(value);
};
async function load(element) {
  const [first] = await Promise.all([readValue(element).then(value => value ?? [])]);
  const second = await format(element);
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
      name: "independent imported requests sharing a stable user ID",
      code: `
import { getUser, getPermissions } from "./requests";
async function load(userId) {
  const user = await getUser(userId);
  const permissions = await getPermissions(userId);
  return [user, permissions];
}`,
    },
    {
      name: "local wrappers delegating to different imported requests",
      code: `
import { getUser, getPermissions } from "./requests";
const readUser = async (target) => getUser(target);
const readPermissions = async (target) => getPermissions(target);
async function load(userId) {
  const user = await readUser(userId);
  const permissions = await readPermissions(userId);
  return [user, permissions];
}`,
    },
    {
      name: "distinct methods on the same imported namespace",
      code: `
import * as requests from "./requests";
async function load(userId) {
  const user = await requests.getUser(userId);
  const permissions = await requests.getPermissions(userId);
  return [user, permissions];
}`,
    },
    {
      name: "distinct imported receivers with the same method name",
      code: `
import * as users from "./users";
import * as permissions from "./permissions";
async function load(userId) {
  const user = await users.read(userId);
  const permission = await permissions.read(userId);
  return [user, permission];
}`,
    },
    {
      name: "a dynamic method on an imported namespace",
      code: `
import * as requests from "./requests";
async function load(userId, method) {
  const first = await requests.read(userId);
  const second = await requests[method](userId);
  return [first, second];
}`,
    },
    {
      name: "an imported operation with a different second argument",
      code: `
import { read } from "./requests";
const format = async (target, options) => read(target, options);
async function load(userId, userOptions, permissionOptions) {
  const user = await read(userId, userOptions);
  const permission = await format(userId, permissionOptions);
  return [user, permission];
}`,
    },
    {
      name: "an imported operation with arguments in a different order",
      code: `
import { read } from "./requests";
async function load(left, right) {
  const first = await read(left, right);
  const second = await read(right, left);
  return [first, second];
}`,
    },
    {
      name: "an imported operation with different argument counts",
      code: `
import { read } from "./requests";
async function load(userId, options) {
  const first = await read(userId);
  const second = await read(userId, options);
  return [first, second];
}`,
    },
    {
      name: "unresolved arguments to the same imported operation",
      code: `
import { read } from "./requests";
async function load(userId) {
  const first = await read(userId, { table: "users" });
  const second = await read(userId, { table: "permissions" });
  return [first, second];
}`,
    },
    {
      name: "a shadowed imported operation inside a local wrapper",
      code: `
import { read } from "./requests";
const format = async (target) => {
  const read = (key) => fetch("/permissions/" + key);
  return read(target);
};
async function load(userId) {
  const first = await read(userId);
  const second = await format(userId);
  return [first, second];
}`,
    },
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
