import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverNoMutableModuleState } from "./server-no-mutable-module-state.js";

describe("server-no-mutable-module-state — regressions", () => {
  it("stays silent on a read-only const lookup table", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const ALLOWED_ROLES = ["admin", "user", "guest"];
export async function setRole(id, role) {
  if (!ALLOWED_ROLES.includes(role)) throw new Error("bad");
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a const container that is mutated", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const cache = new Map();
export async function remember(id, value) {
  cache.set(id, value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a mutation when the container receiver is wrapped in `as any`", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const cache = new Map();
export async function remember(id, value) {
  (cache as any).set(id, value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a mutable let regardless of mutation", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
let counter = 0;
export async function bump() { counter = counter + 1; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a nested-property mutating call (store.users.push)", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const store = { users: [] };
export async function addUser(user) {
  store.users.push(user);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a nested-property member assignment (store.users[0] = x)", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const store = { users: [] };
export async function replaceFirst(user) {
  store.users[0] = user;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a mutation through a module-level alias (const byId = cache)", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const cache = new Map();
const byId = cache;
export async function remember(id, value) {
  byId.set(id, value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('flags a computed string-literal mutating call (cache["set"])', () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const cache = new Map();
export async function remember(id, value) {
  cache["set"](id, value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it('flags a computed Object mutating call (Object["assign"](state, …))', () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = {};
export async function merge(patch) {
  Object["assign"](state, patch);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a container passed to a same-file helper that mutates its parameter", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const cache = new Map();
const writeThrough = (target, id, value) => {
  target.set(id, value);
};
export async function remember(id, value) {
  writeThrough(cache, id, value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when a shadowed local of the same name is mutated", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const items = ["a", "b"];
export async function listItems(extra) {
  const items = [];
  items.push(extra);
  return items;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a parameter of the same name is mutated", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const registry = new Map([["a", 1]]);
export async function update(registry, id, value) {
  registry.set(id, value);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the container is passed to a same-file read-only helper", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const registry = new Map([["a", 1]]);
const snapshot = (source) => Array.from(source.entries());
export async function list() {
  return snapshot(registry);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the container is passed to an imported helper", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
import { serialize } from "./serialize";
const registry = new Map([["a", 1]]);
export async function dump() {
  return serialize(registry);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on read-only nested access (config.roles.includes)", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const config = { roles: ["admin"] };
export async function isAdmin(role) {
  return config.roles.includes(role);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not claim a leak for a never-written let, only that a write would leak", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
let apiVersion = "v1";
export async function getVersion() {
  return apiVersion;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("any write to it leaks");
  });

  it("still flags a reassigned module-scoped let", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
let lastUserId = null;
export async function track(userId) {
  lastUserId = userId;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each(["seal", "preventExtensions"])(
    "flags a write to an existing Object.%s property",
    (methodName) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = Object.${methodName}({ count: 0 });
export async function increment() {
  state.count++;
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0].message).toContain('"state = {}"');
    },
  );

  it.each(["Object as any", "Object!"])(
    "flags a write when the integrity call receiver is wrapped as %s",
    (objectReceiver) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = (${objectReceiver}).seal({ count: 0 });
export async function increment() {
  state.count++;
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each(["seal", "preventExtensions"])(
    "stays silent on a rejected new property write through Object.%s",
    (methodName) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = Object.${methodName}({ count: 0 });
export async function addLabel() {
  state.label = "active";
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("stays silent on a rejected delete from a sealed object", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function removeCount() {
  delete state.count;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a permitted delete from a non-extensible object", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.preventExtensions({ count: 0 });
export async function removeCount() {
  delete state.count;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a descriptor update to an existing sealed property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function reset() {
  Object.defineProperty(state, "count", { value: 1 });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a frozen object", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.freeze({ count: 0 });
export async function increment() {
  state.count++;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["seal", "preventExtensions"])(
    "stays silent on a rejected write to a getter-only Object.%s property",
    (methodName) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = Object.${methodName}({ get count() { return 0; } });
export async function increment() {
  state.count++;
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("stays silent when a dynamic patch cannot update any non-extensible property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.preventExtensions({ get count() { return 0; } });
export async function update(patch) {
  Object.assign(state, patch);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when a sealed setter delegates without storing state", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ set count(value) { persist(value); } });
export async function update() {
  state.count = 1;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a mutator-shaped call below a scalar sealed property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function update() {
  state.count.set(1);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on an opaque nested method whose name resembles a mutator", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ service: getService() });
export async function update() {
  state.service.set("status", "active");
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags nested writes through statically mutable sealed properties", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ users: [], nested: { count: 0 }, cache: new Map() });
export async function update(user) {
  state.users[0] = user;
  state.nested.count++;
  state.cache.set(user.id, user);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a custom mutator-shaped method in a nested object literal", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ service: { set(value) { persist(value); } } });
export async function update() {
  state.service.set("active");
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a shadowed Object.seal implementation", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const Object = { seal: () => sharedState };
const state = Object.seal({ count: 0 });
export async function increment() {
  state.count++;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a sealed object passed to a helper that mutates an existing property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
const increment = (target) => { target.count++; };
export async function update() {
  increment(state);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a helper only attempts to add a sealed property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
const addLabel = (target) => { target.label = "active"; };
export async function update() {
  addLabel(state);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a dynamic Object.assign that may update existing sealed properties", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function update(patch) {
  Object.assign(state, patch);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    "const state = { count: 0 };",
    "const state = Object.seal({ count: 0 });",
    "const state = Object.preventExtensions({ count: 0 });",
  ])(
    "stays silent when a const container is only populated during module initialization",
    (declaration) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
${declaration}
state.count = 1;
export async function read() {
  return state.count;
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("still flags a mutation inside a module-initialized scheduled callback", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
setInterval(() => {
  state.count++;
}, 1000);`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a shadowed Object.assign lookalike", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function update() {
  const Object = { assign: () => null };
  Object.assign(state, { count: 1 });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["const state = { count: 0 };", "const state = new Map();"])(
    "stays silent on a shadowed Object.assign over a plain container (%s)",
    (declaration) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
${declaration}
export async function update() {
  const Object = { assign: () => null };
  Object.assign(state, { count: 1 });
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["async () => { target.count++; }", "() => { target.count++; }"])(
    "flags a module-scope factory call whose returned closure (%s) mutates the container",
    (closureSource) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = { count: 0 };
const makeIncrementer = (target) => ${closureSource};
export const increment = makeIncrementer(state);`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("stays silent when a module-scope helper call only mutates its parameter at initialization", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = { count: 0 };
const seed = (target) => {
  target.count = 1;
};
seed(state);
export async function read() {
  return state.count;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["new Map()", 'state.set("a", 1)'],
    ["new Set()", 'state.add("a")'],
    ["[0]", "state[0]++"],
  ])("flags a mutated sealed non-object container (%s)", (containerSource, mutation) => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal(${containerSource});
export async function update() {
  ${mutation};
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a sealed Map is only populated during module initialization", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal(new Map());
state.set("a", 1);
export async function read() {
  return state.get("a");
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["new Map()", 'state.set("a", 1)'],
    ["[]", "state.push(1)"],
  ])(
    "stays silent when a const %s container is only populated during module initialization",
    (containerSource, mutation) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = ${containerSource};
${mutation};
export async function read() {
  return state;
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(["const state = { count: 0 };", "const state = Object.seal({ count: 0 });"])(
    "stays silent on a module-scope IIFE that writes during initialization",
    (declaration) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
${declaration}
(() => {
  state.count = 1;
})();
export async function read() {
  return state.count;
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("still flags a write inside an IIFE that runs per request", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function update() {
  (() => {
    state.count = 1;
  })();
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags a deferred callback registered inside a module-scope IIFE", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
(() => {
  setInterval(() => {
    state.count++;
  }, 1000);
})();`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an all-spread Object.assign source over a sealed container", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function update(patch) {
  Object.assign(state, { ...patch });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when a spread patch cannot update any getter-only sealed property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ get count() { return 0; } });
export async function update(patch) {
  Object.assign(state, { ...patch });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a defineProperties descriptor that updates an existing sealed property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function reset() {
  Object.defineProperties(state, { count: { value: 1 } });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent when defineProperties only targets missing sealed properties", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function label() {
  Object.defineProperties(state, { label: { value: "active" } });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when defineProperty targets a missing sealed property", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function label() {
  Object.defineProperty(state, "label", { value: "active" });
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["users: []", "state.users.push(entry)"],
    ["cache: new Map()", 'state.cache.set("id", entry)'],
    ["tags: new Set()", "state.tags.add(entry)"],
    ["registry: new WeakMap()", "state.registry.set(entry, 1)"],
    ["seen: new WeakSet()", "state.seen.add(entry)"],
    ["nested: { count: 0 }", "state.nested.count = 1"],
  ])(
    "flags an isolated nested mutation on a sealed { %s } property",
    (propertySource, mutation) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = Object.seal({ ${propertySource} });
export async function update(entry) {
  ${mutation};
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it.each([
    ["registry: new WeakMap()", "state.registry.clear()"],
    ["seen: new WeakSet()", "state.seen.clear()"],
  ])(
    "stays silent on a nested method the sealed { %s } container does not support",
    (propertySource, mutation) => {
      const result = runRule(
        serverNoMutableModuleState,
        `"use server";
const state = Object.seal({ ${propertySource} });
export async function update() {
  ${mutation};
}`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    },
  );

  it("flags a mutation through a module-level alias of a sealed container", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
const alias = state;
export async function increment() {
  alias.count++;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a sealed-property write when the container receiver is wrapped in `as any`", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function increment() {
  (state as any).count++;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a delete under chained preventExtensions + seal wrappers", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.preventExtensions(Object.seal({ count: 0 }));
export async function removeCount() {
  delete state.count;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags an existing-property write under chained integrity wrappers", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.preventExtensions(Object.seal({ count: 0 }));
export async function increment() {
  state.count++;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on Object.setPrototypeOf over a sealed container", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = Object.seal({ count: 0 });
export async function detach(proto) {
  Object.setPrototypeOf(state, proto);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags Object.setPrototypeOf over a plain container", () => {
    const result = runRule(
      serverNoMutableModuleState,
      `"use server";
const state = { count: 0 };
export async function detach(proto) {
  Object.setPrototypeOf(state, proto);
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
