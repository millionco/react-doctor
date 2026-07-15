import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { asyncParallel } from "./async-parallel.js";

const expectFail = (code: string): void => {
  const result = runRule(asyncParallel, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(asyncParallel, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("js-performance/async-parallel — regressions", () => {
  it("flags awaits when callback parameters shadow earlier results", () => {
    expectFail(
      `declare const loadFirst: () => Promise<number>; declare const loadSecond: (selector: (first: number) => number) => Promise<number>; declare const loadThird: (selector: (second: number) => number) => Promise<number>; export const loadAll = async (): Promise<number[]> => { const first = await loadFirst(); const second = await loadSecond((first) => first + 1); const third = await loadThird((second) => second + 1); return [first, second, third]; };`,
    );
  });

  it.each([
    ["(first) => first + 1", "(second) => second + 1"],
    [
      "({ first }: { first: number }) => first + 1",
      "({ second }: { second: number }) => second + 1",
    ],
    [
      "() => { const first = 1; return first + 1; }",
      "() => { const second = 2; return second + 1; }",
    ],
    [
      "Promise.resolve(1).then((first) => first + 1)",
      "Promise.resolve(2).then((second) => second + 1)",
    ],
    [
      "Promise.reject(1).catch((first) => first + 1)",
      "Promise.reject(2).catch((second) => second + 1)",
    ],
    ["function (first) { return first + 1; }", "function (second) { return second + 1; }"],
  ])("does not fabricate dependencies from nested bindings", (secondArgument, thirdArgument) => {
    expectFail(
      `async function load() { const first = await loadFirst(); const second = await loadSecond(${secondArgument}); const third = await loadThird(${thirdArgument}); return [first, second, third]; }`,
    );
  });

  it.each([
    `async function load() { const first = await loadFirst(); const second = await loadSecond((value) => value + first); const third = await loadThird(); return [first, second, third]; }`,
    `async function load() { const first = await loadFirst(); const second = await loadSecond({ [first]: true }); const third = await loadThird(); return [first, second, third]; }`,
    `async function load() { const first = await loadFirst(); const second = await first.loadSecond(); const third = await loadThird(); return [first, second, third]; }`,
    `async function load() { const first = await loadFirst(); const second = await loadSecond(); const third = await loadThird((value) => value + second); return [first, second, third]; }`,
  ])("retains genuine symbol dependencies", (code) => {
    expectPass(code);
  });

  it("ignores write-only references to earlier results", () => {
    expectFail(
      `async function load() { let first = await loadFirst(); let second = await loadSecond((first = fallback)); const third = await loadThird((second = fallback)); return [first, second, third]; }`,
    );
  });

  it("retains read-write references to earlier results", () => {
    expectPass(
      `async function load() { let first = await loadFirst(); let second = await loadSecond((first += fallback)); const third = await loadThird((second += fallback)); return [first, second, third]; }`,
    );
  });

  it("flags independent visible helpers even when they are named query", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; async function load() { const first = await query(1); const second = await query(2); const third = await query(3); return [first, second, third]; }`,
    );
  });

  it("flags independent bare awaits of a visible commutative Promise<void> helper", () => {
    expectFail(
      `const double = async (cell) => { await Promise.resolve(); cell.value *= 2; }; async function update(first, second, third) { await double(first); await double(second); await double(third); }`,
    );
  });

  it.each([
    `const inspect = async (value: number): Promise<void> => { await Promise.resolve(); }; async function load() { await inspect(1); await inspect(2); await inspect(3); }`,
    `const inspect = async (value: number): Promise<void> => { await Promise.resolve(); return; }; async function load() { await inspect(1); await inspect(2); await inspect(3); }`,
    `const inspect = async (value: number): Promise<void> => { await Promise.resolve(); void value; }; async function load() { await inspect(1); await inspect(2); await inspect(3); }`,
  ])("flags independent bare awaits of a visible pure Promise<void> helper", (code) => {
    expectFail(code);
  });

  it.each([
    `const inspect = async (value: number): Promise<void> => { await Promise.resolve(); }; async function load() { const first = await inspect(1); const second = await inspect(2); const third = await inspect(3); void first; void second; void third; }`,
    `const inspect = async (value: number): Promise<void> => { await Promise.resolve(); return; }; async function load() { const first = await inspect(1); const second = await inspect(2); const third = await inspect(3); void first; void second; void third; }`,
    `const inspect = async (value: number): Promise<void> => { await Promise.resolve(); void value; }; async function load() { const first = await inspect(1); const second = await inspect(2); const third = await inspect(3); void first; void second; void third; }`,
  ])("retains bound-and-discarded pure Promise<void> positives", (code) => {
    expectFail(code);
  });

  it("follows an exact destructured alias to a commutative Promise<void> helper", () => {
    expectFail(
      `const inspect = async (cell: { value: number }): Promise<void> => { await Promise.resolve(); cell.value *= 2; }; const helpers = { inspect }; const { inspect: run } = helpers; async function load(first: { value: number }, second: { value: number }, third: { value: number }) { await run(first); await run(second); await run(third); }`,
    );
  });

  it("retains the bound-and-discarded destructured-alias positive", () => {
    expectFail(
      `const inspect = async (cell: { value: number }): Promise<void> => { await Promise.resolve(); cell.value *= 2; }; const helpers = { inspect }; const { inspect: run } = helpers; async function load(first: { value: number }, second: { value: number }, third: { value: number }) { const firstResult = await run(first); const secondResult = await run(second); const thirdResult = await run(third); void firstResult; void secondResult; void thirdResult; }`,
    );
  });

  it("flags a visible Promise-returning query helper like its alpha rename", () => {
    for (const helperName of ["query", "loadValue"]) {
      expectFail(
        `const ${helperName} = (value: number): Promise<number> => Promise.resolve(value * 2); async function load() { const first = await ${helperName}(1); const second = await ${helperName}(2); const third = await ${helperName}(3); return [first, second, third]; }`,
      );
    }
  });

  it("keeps awaits of a synchronous helper quiet", () => {
    expectPass(
      `const inspect = (value: number): number => value * 2; async function load() { await inspect(1); await inspect(2); await inspect(3); }`,
    );
  });

  it("flags repeated commutative mutations when call arguments alias", () => {
    expectFail(
      `const double = async (cell) => { await Promise.resolve(); cell.value *= 2; }; async function update(cell) { await double(cell); await double(cell); await double(cell); }`,
    );
  });

  it.each(["query", "execute", "wait"])("flags independent pure local %s calls", (helperName) => {
    expectFail(
      `const ${helperName} = async (item) => { await Promise.resolve(); return item * 2; }; async function load() { const first = await ${helperName}(1); const second = await ${helperName}(2); const third = await ${helperName}(3); return [first, second, third]; }`,
    );
  });

  it("follows aliases and statically computed object properties", () => {
    expectFail(
      `const helpers = { query: async (item) => { await Promise.resolve(); return item * 2; } }; const aliasedHelpers = helpers; async function load() { const first = await aliasedHelpers["query"](1); const second = await aliasedHelpers["query"](2); const third = await aliasedHelpers["query"](3); return [first, second, third]; }`,
    );
  });

  it("flags bare awaits through aliases of the same commutative helper", () => {
    expectFail(
      `const double = async (cell) => { await Promise.resolve(); cell.value *= 2; }; const transform = double; async function update(first, second, third) { await transform(first); await transform(second); await transform(third); }`,
    );
  });

  it("flags alternating direct and static calls to the same helper", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; async function load() { await query(1); await helpers.query(2); await helpers["query"](3); }`,
    );
  });

  it("follows multi-hop aliases through a statically named object property", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const aliasedQuery = query; const helpers = { ["run"]: aliasedQuery }; const aliasedHelpers = helpers; async function load() { await query(1); await aliasedHelpers.run(2); await aliasedQuery(3); }`,
    );
  });

  it("recognizes distinct properties that reference the same helper", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query, run: query }; async function load() { await query(1); await helpers.query(2); await helpers.run(3); }`,
    );
  });

  it("uses the last duplicate object property value", () => {
    expectFail(
      `const otherQuery = async (item) => { await Promise.resolve(); return item + 1; }; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query: otherQuery, query }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("follows static object methods through a direct alias", () => {
    expectFail(
      `const helpers = { async query(item) { await Promise.resolve(); return item * 2; } }; const query = helpers.query; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("follows transparent TypeScript wrappers on direct and object helpers", () => {
    expectFail(
      `const query = async (item: number) => { await Promise.resolve(); return item * 2; }; const helpers = { query: query as typeof query }; async function load() { await (query!)(1); await (helpers.query!)(2); await (query)(3); }`,
    );
  });

  it("keeps distinct same-named object helpers serialized", () => {
    expectPass(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query: async (item) => { await Promise.resolve(); return item * 2; } }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("keeps reassigned object helpers serialized", () => {
    expectPass(
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; helpers.query = async (item) => { cursor += item; return cursor; }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("keeps dynamically reassigned object helpers serialized", () => {
    expectPass(
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; const propertyName = getPropertyName(); helpers[propertyName] = async (item) => { cursor += item; return cursor; }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it.each([
    `Object.assign(helpers, { query: async (item) => { const previous = cursor; await Promise.resolve(); cursor = previous + item; return cursor; } });`,
    `Object.defineProperty(helpers, "query", { value: async (item) => { const previous = cursor; await Promise.resolve(); cursor = previous + item; return cursor; } });`,
    `const install = (target) => { target.query = async (item) => { const previous = cursor; await Promise.resolve(); cursor = previous + item; return cursor; }; }; install(helpers);`,
  ])("keeps helpers overwritten through an escaping object reference serialized", (overwrite) => {
    expectPass(
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; ${overwrite} async function load() { const first = await helpers.query(1); const second = await helpers.query(2); const third = await helpers.query(3); return [first, second, third]; }`,
    );
  });

  it("keeps object helpers mutated through mutable aliases serialized", () => {
    expectPass(
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; let holder = helpers; const nestedHolder = holder; nestedHolder.query = async (item) => { cursor += item; return cursor; }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("keeps bound non-heuristic member calls mutated through aliases serialized", () => {
    expectPass(
      `let cursor = 0; const run = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { run }; let holder = helpers; holder.run = async (item) => { cursor += item; return cursor; }; async function load() { const first = await run(1); const second = await helpers.run(2); const third = await run(3); return [first, second, third]; }`,
    );
  });

  it("keeps object helpers mutated through assigned aliases serialized", () => {
    expectPass(
      `let cursor = 0; const query = async (item: number) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; let holder: typeof helpers; holder = helpers as typeof helpers; const nestedHolder = holder!; nestedHolder["query"] = async (item) => { cursor += item; return cursor; }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("keeps object helpers deleted or updated through aliases serialized", () => {
    for (const mutation of ["delete holder.query", "holder.query++"]) {
      expectPass(
        `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; var holder = helpers; ${mutation}; async function load() { await query(1); await helpers.query(2); await query(3); }`,
      );
    }
  });

  it("ignores mutations through aliases of unrelated helper objects", () => {
    expectFail(
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; const otherHelpers = { query }; let holder = otherHelpers; holder.query = async (item) => { cursor += item; return cursor; }; async function load() { await helpers.query(1); await helpers.query(2); await helpers.query(3); }`,
    );
  });

  it("ignores similarly named shadowed mutable aliases", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; { const helpers = { query }; let holder = helpers; holder.query = async (item) => item + 1; } async function load() { await helpers.query(1); await helpers.query(2); await helpers.query(3); }`,
    );
  });

  it("keeps a shadowed direct helper distinct from the outer object helper", () => {
    expectPass(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; async function load() { const query = async (item) => { await Promise.resolve(); return item + 1; }; await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("keeps object spreads and last-property overrides conservative", () => {
    for (const code of [
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const overrides = getOverrides(); const helpers = { query, ...overrides }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const otherQuery = async (item) => { await Promise.resolve(); return item + 1; }; const helpers = { query, query: otherQuery }; async function load() { await query(1); await helpers.query(2); await query(3); }`,
    ]) {
      expectPass(code);
    }
  });

  it("follows an exact destructured object helper read", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; const helpers = { query }; const { query: runQuery } = helpers; async function load() { await query(1); await runQuery(2); await helpers.query(3); }`,
    );
  });

  it("resolves shadowed direct and object helpers to the local binding", () => {
    expectFail(
      `const query = async (item) => { await Promise.resolve(); return item * 2; }; async function load() { const query = async (item) => { await Promise.resolve(); return item + 1; }; const helpers = { query }; await query(1); await helpers.query(2); await query(3); }`,
    );
  });

  it("keeps bare awaits conservative when the local proof does not establish one operation", () => {
    for (const code of [
      `const double = async (cell) => { await Promise.resolve(); if (cell.locked) return; cell.value *= 2; }; async function update(first, second, third) { await double(first); await double(second); await double(third); }`,
      `const Promise = { resolve: async () => undefined }; const double = async (cell) => { await Promise.resolve(); cell.value *= 2; }; async function update(first, second, third) { await double(first); await double(second); await double(third); }`,
      `const double = async (cell) => { await Promise.resolve(); cell.value *= 2; }; const increment = async (cell) => { await Promise.resolve(); cell.value += 1; }; async function update(first, second, third) { await double(first); await increment(second); await double(third); }`,
      `let cursor = 0; const query = async (item) => { await Promise.resolve(); cursor += item; return cursor; }; async function load() { const first = await query(1); const second = await query(2); const third = await query(3); return [first, second, third]; }`,
    ]) {
      expectPass(code);
    }
  });

  it("keeps bare awaits with effectful argument evaluation serialized", () => {
    expectPass(
      `const cell = { value: 1 }; const observed = []; const getCell = () => { observed.push(cell.value); return cell; }; const double = async (target) => { await Promise.resolve(); target.value *= 2; }; async function update() { await double(getCell()); await double(getCell()); await double(getCell()); }`,
    );
  });

  it("flags three genuinely independent sequential awaits", () => {
    expectFail(
      `async function load(){ const a = await getA(); const b = await getB(); const c = await getC(); }`,
    );
  });

  it("does not flag when a bare expression-statement await depends on an earlier result", () => {
    expectPass(
      `async function load(){ const user = await getUser(); await trackVisit(user.id); const posts = await getPosts(); }`,
    );
  });

  it("does not flag a dynamic-import chain whose later awaits consume destructured bindings", () => {
    expectPass(
      `
async function getChannels() {
  const { prepareConfig } = await import("./server/config.server");
  const { databasePlugin } = await prepareConfig();
  const channels = await databasePlugin.getChannels();
  return channels ?? [];
}
`,
    );
  });

  it("does not flag when a later await consumes an array-destructured earlier result", () => {
    expectPass(
      `
async function createAttempt(db, answers) {
  const [attempt] = await db.insert(attempts).values({}).returning();
  const rows = await db.insert(attemptAnswers).values(answers.map((a) => ({ attemptId: attempt.id })));
  const points = await awardPoints(attempt.id);
  return { attempt, rows, points };
}
`,
    );
  });

  it("does not flag a run of bare side-effect awaits ordered by intent", () => {
    expectPass(
      `
async function saveAndReveal(newPath, content) {
  await saveFile(newPath, content);
  await refreshFileTree();
  await openFile(newPath);
}
`,
    );
  });

  it("does not flag write-then-revalidate sequences of bare awaits", () => {
    expectPass(
      `
async function toggleCompletion(patientUuid, task, completed) {
  await setTaskStatusCompleted(patientUuid, task, completed);
  await mutate();
  await mutateList(taskListKey(patientUuid));
}
`,
    );
  });

  it("does not flag awaits inside a database transaction callback", () => {
    expectPass(
      `
async function createGroup(db, name, userId) {
  return db.transaction(async (tx) => {
    const memberships = await tx.select().from(members).where(eq(members.userId, userId));
    const groups = await tx.select().from(groupTable).limit(10);
    const settings = await tx.select().from(settingsTable).limit(1);
    return { memberships, groups, settings };
  });
}
`,
    );
  });

  it("does not flag a run that settles an already-started promise", () => {
    expectPass(
      `
async function buildAll(feManifestPromise) {
  const manifest = await buildManifest();
  const lintResult = await lintEmailsDirectory();
  const feManifest = await feManifestPromise;
  return { manifest, lintResult, feManifest };
}
`,
    );
  });

  it("still flags independent bound awaits on the same client namespace", () => {
    expectFail(
      `
async function loadDashboard(api) {
  const users = await api.getUsers();
  const posts = await api.getPosts();
  const tags = await api.getTags();
  return { users, posts, tags };
}
`,
    );
  });
});
