import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverSequentialIndependentAwait } from "./server-sequential-independent-await.js";

describe("server-sequential-independent-await — regressions", () => {
  it("flags an independent visible helper even when its name starts with initialize", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `const initializeProfile = async (value) => { await Promise.resolve(); return value * 2; }; const loadPreferences = async (value) => { await Promise.resolve(); return value * 3; }; export async function load() { const profile = await initializeProfile(2); const preferences = await loadPreferences(3); return { profile, preferences }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a visible Promise-returning initialize helper like its alpha rename", () => {
    for (const helperName of ["initializeProfile", "loadProfile"]) {
      const result = runRule(
        serverSequentialIndependentAwait,
        `const ${helperName} = (value: number): Promise<number> => Promise.resolve(value * 2); const loadPreferences = (value: number): Promise<number> => Promise.resolve(value * 3); export async function load() { const profile = await ${helperName}(2); const preferences = await loadPreferences(3); return { profile, preferences }; }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    }
  });

  it("keeps an awaited synchronous initialize helper as a gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `const initializeProfile = (value: number): number => value * 2; const loadPreferences = async (): Promise<number> => 3; export async function load() { const profile = await initializeProfile(2); const preferences = await loadPreferences(); return { profile, preferences }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(["initializeProfile", "setupProfile", "requireProfile"])(
    "flags the pure local %s helper without trusting its leading verb",
    (helperName) => {
      const result = runRule(
        serverSequentialIndependentAwait,
        `const ${helperName} = async (value) => { await Promise.resolve(); return value * 2; }; const loadPreferences = async (value) => { await Promise.resolve(); return value * 3; }; export async function load() { const profile = await ${helperName}(2); const preferences = await loadPreferences(3); return { profile, preferences }; }`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics.length).toBeGreaterThan(0);
    },
  );

  it("follows an alias to a pure local helper whose original name is a gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `const initializeProfile = async (value) => { await Promise.resolve(); return value * 2; }; const initializeAlias = initializeProfile; export async function load() { const profile = await initializeAlias(2); const preferences = await loadPreferences(3); return { profile, preferences }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("follows an object shorthand alias to a pure local helper gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `const initializeProfile = async (value) => { await Promise.resolve(); return value * 2; }; const helpers = { initializeProfile }; export async function load() { const profile = await helpers.initializeProfile(2); const preferences = await loadPreferences(3); return { profile, preferences }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps a reassigned object shorthand helper gate sequential", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `let initialized = false; const initializeProfile = async (value) => { await Promise.resolve(); return value * 2; }; const helpers = { initializeProfile }; helpers.initializeProfile = async (value) => { initialized = true; return value; }; export async function load() { const profile = await helpers.initializeProfile(2); const preferences = await loadPreferences(3); return { profile, preferences, initialized }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    `Object.assign(helpers, { initializeProfile: async (value) => { await Promise.resolve(); initialized = true; return value; } });`,
    `Object.defineProperty(helpers, "initializeProfile", { value: async (value) => { await Promise.resolve(); initialized = true; return value; } });`,
    `const install = (target) => { target.initializeProfile = async (value) => { await Promise.resolve(); initialized = true; return value; }; }; install(helpers);`,
  ])("keeps an escaped and overwritten initialize helper sequential", (overwrite) => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `let initialized = false; const initializeProfile = async (value) => { await Promise.resolve(); return value * 2; }; const helpers = { initializeProfile }; ${overwrite} const loadPreferences = async () => initialized; export async function load() { const profile = await helpers.initializeProfile(2); const preferences = await loadPreferences(); return { profile, preferences }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an object shorthand helper gate mutated through a mutable alias sequential", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `let initialized = false; const initializeProfile = async (value) => { await Promise.resolve(); return value * 2; }; const helpers = { initializeProfile }; let holder = helpers; holder.initializeProfile = async (value) => { initialized = true; return value; }; export async function load() { const profile = await helpers.initializeProfile(2); const preferences = await loadPreferences(3); return { profile, preferences, initialized }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps a mutated non-heuristic object helper sequential", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `let initialized = false; const run = async (value) => { await Promise.resolve(); return value * 2; }; const helpers = { run }; let holder = helpers; holder.run = async (value) => { initialized = true; return value; }; export async function load() { const profile = await helpers.run(2); const preferences = await loadPreferences(3); return { profile, preferences, initialized }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags object helpers when only an unrelated alias is mutated", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `const run = async (value) => { await Promise.resolve(); return value * 2; }; const helpers = { run }; const otherHelpers = { run }; let holder = otherHelpers; holder.run = async (value) => value + 1; export async function load() { const profile = await helpers.run(2); const preferences = await loadPreferences(3); return { profile, preferences }; }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("keeps opaque and visibly stateful initialization gates sequential", () => {
    for (const code of [
      `export async function load(database) { const connection = await database.initialize(); const rows = await database.loadRows(); return { connection, rows }; }`,
      `let session; const initializeSession = async (value) => { await Promise.resolve(); session = value; return session; }; export async function load() { const current = await initializeSession(2); const rows = await loadRows(); return { current, rows }; }`,
      `const initializeSession = async (value) => { await Promise.resolve(); if (!value) throw new Error("missing"); return value; }; export async function load() { const current = await initializeSession(2); const rows = await loadRows(); return { current, rows }; }`,
    ]) {
      const result = runRule(serverSequentialIndependentAwait, code);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toEqual([]);
    }
  });

  it("stays silent when the first await is an auth/permission gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export async function load() {
  const session = await requireSession();
  const orders = await getOrders();
  return orders;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the first await is a connection/side-effect gate", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export async function load() {
  const conn = await connectDatabase();
  const rows = await fetchRows();
  return rows;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when both awaits are on promises started earlier (already parallel)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `async function load() {
  const userPromise = fetchUser();
  const postsPromise = fetchPosts();
  const user = await userPromise;
  const posts = await postsPromise;
  return { user, posts };
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when one await is a Next.js request-scoped API (headers)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `import { headers } from "next/headers";
export default async function Page() {
  const headersList = await headers();
  const rows = await fetchRows();
  return rows;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the first await is a next-intl server helper", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `import { getTranslations } from "next-intl/server";
export default async function Page() {
  const t = await getTranslations("Home");
  const session = await getSession();
  return session;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when awaiting Next.js 15 promise props (params/searchParams)", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export default async function Page(props) {
  const searchParams = await props.searchParams;
  const { segments } = await props.params;
  return segments;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a fetch pair when a same-named local headers() is not the Next.js API", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `import { headers } from "./my-io.js";
export default async function Page() {
  const headersList = await headers();
  const rows = await fetchRows();
  return rows;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags two genuinely independent data fetches", () => {
    const result = runRule(
      serverSequentialIndependentAwait,
      `export default async function Page() {
  const user = await fetchUser();
  const posts = await fetchPosts();
  return null;
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
