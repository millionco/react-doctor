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
});
