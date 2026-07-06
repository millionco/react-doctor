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
