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
});
