import * as fs from "node:fs";
import os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/core";
import { buildTestProject, setupReactProject } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-server-auth-actions-"));
const RULE_ID = "server-auth-actions";

const NEXTJS_PACKAGE_DEPENDENCIES = {
  next: "^15.0.0",
  react: "^19.0.0",
  "react-dom": "^19.0.0",
};

interface CollectAuthIssuesOptions {
  userConfig?: ReactDoctorConfig | null;
}

const collectAuthActionIssues = async (
  projectDirectory: string,
  options: CollectAuthIssuesOptions = {},
): Promise<Diagnostic[]> => {
  const diagnostics = await runOxlint({
    rootDirectory: projectDirectory,
    project: buildTestProject({
      rootDirectory: projectDirectory,
      framework: "nextjs",
    }),
    userConfig: options.userConfig ?? null,
  });
  return diagnostics.filter((diagnostic) => diagnostic.rule === RULE_ID);
};

const buildServerActionFile = (body: string): string => `"use server";

${body}
`;

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("server-auth-actions", () => {
  it("accepts auth0.getSession() as a top-of-action auth check", async () => {
    const projectDirectory = setupReactProject(tempRoot, "auth0-get-session", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth0 } from "@/lib/auth0";

export async function deleteAccount(accountId: string) {
  const session = await auth0.getSession();
  if (!session) throw new Error("unauthorized");
  return { accountId, deleted: true };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts ctx.auth.getUser() through a nested member receiver", async () => {
    const projectDirectory = setupReactProject(tempRoot, "ctx-auth-get-user", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { ctx } from "@/lib/context";

export async function updateProfile(profile: { name: string }) {
  const user = await ctx.auth.getUser();
  if (!user) throw new Error("unauthorized");
  return { ...profile, userId: user.id };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts clerkClient.getUser() through an auth-related receiver", async () => {
    const projectDirectory = setupReactProject(tempRoot, "clerk-client-get-user", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`import { clerkClient } from "@clerk/nextjs/server";

export async function rotateKey(keyId: string) {
  const user = await clerkClient.getUser();
  if (!user) throw new Error("unauthorized");
  return { keyId, rotatedBy: user.id };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts session.auth() as a member-call auth check", async () => {
    const projectDirectory = setupReactProject(tempRoot, "session-auth", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { session } from "@/lib/session";

export async function archiveProject(projectId: string) {
  const result = await session.auth();
  if (!result.userId) throw new Error("unauthorized");
  return { projectId, archived: true };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("still reports server actions with no auth call at all", async () => {
    const projectDirectory = setupReactProject(tempRoot, "missing-auth-check", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`export async function deleteAccount(accountId: string) {
  return db.account.delete({ where: { id: accountId } });
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteAccount");
  });

  it("does not flag analytics.getUser() as an auth check (false-positive guard)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "analytics-get-user-not-auth", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { analytics } from "@/lib/analytics";

export async function trackVisit(visitId: string) {
  const profile = await analytics.getUser();
  return db.visit.update({ where: { id: visitId }, data: { segment: profile.segment } });
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("trackVisit");
  });

  it("accepts a bare-identifier auth call (regression guard for the original behavior)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "bare-identifier-auth", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";

export async function deleteAccount(accountId: string) {
  const session = await auth();
  if (!session) throw new Error("unauthorized");
  return { accountId, deleted: true };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts custom guards listed in `serverAuthFunctionNames`", async () => {
    const projectDirectory = setupReactProject(tempRoot, "custom-auth-guard", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`import { requireWorkspaceMember } from "@/lib/guards";

export async function inviteMember(workspaceId: string) {
  const member = await requireWorkspaceMember();
  return db.invite.create({ data: { workspaceId, invitedBy: member.id } });
}`),
      },
    });

    const withoutCustomAllowlist = await collectAuthActionIssues(projectDirectory);
    expect(withoutCustomAllowlist).toHaveLength(1);

    const withCustomAllowlist = await collectAuthActionIssues(projectDirectory, {
      userConfig: { serverAuthFunctionNames: ["requireWorkspaceMember"] },
    });
    expect(withCustomAllowlist).toEqual([]);
  });

  it("accepts custom guards even when called through a member expression", async () => {
    const projectDirectory = setupReactProject(tempRoot, "custom-auth-guard-member-call", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { guards } from "@/lib/guards";

export async function publishPost(postId: string) {
  const member = await guards.requireWorkspaceMember();
  return { postId, publishedBy: member.id };
}`),
      },
    });

    const withCustomAllowlist = await collectAuthActionIssues(projectDirectory, {
      userConfig: { serverAuthFunctionNames: ["requireWorkspaceMember"] },
    });
    expect(withCustomAllowlist).toEqual([]);
  });

  it("ignores non-string entries in `serverAuthFunctionNames`", async () => {
    const projectDirectory = setupReactProject(tempRoot, "custom-auth-guard-bad-entries", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`export async function leakData() {
  return db.secret.delete({ where: { id: "all" } });
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory, {
      userConfig: {
        // Cast required to test runtime filtering of malformed config payloads.
        serverAuthFunctionNames: ["", 42 as unknown as string, null as unknown as string],
      },
    });
    expect(issues).toHaveLength(1);
  });

  it("flags `export default async function` missing an auth check", async () => {
    const projectDirectory = setupReactProject(tempRoot, "default-export-named-missing", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`export default async function deleteAccount(accountId: string) {
  return db.account.delete({ where: { id: accountId } });
}`),
      },
    });
    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteAccount");
  });

  it("accepts `export default async function` when an auth check is present", async () => {
    const projectDirectory = setupReactProject(tempRoot, "default-export-named-ok", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";

export default async function deleteAccount(accountId: string) {
  const session = await auth();
  if (!session) throw new Error("unauthorized");
  return { accountId, deleted: true };
}`),
      },
    });
    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("flags anonymous default-export async functions missing an auth check", async () => {
    const projectDirectory = setupReactProject(tempRoot, "default-export-anonymous-missing", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`export default async function (accountId: string) {
  return db.account.delete({ where: { id: accountId } });
}`),
      },
    });
    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("default");
  });

  it("flags `export const fn = async () => {}` missing an auth check", async () => {
    const projectDirectory = setupReactProject(tempRoot, "const-arrow-missing", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`export const deleteAccount = async (accountId: string) => {
  return db.account.delete({ where: { id: accountId } });
};`),
      },
    });
    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteAccount");
  });

  it("accepts `export const fn = async () => {}` when an auth check is present", async () => {
    const projectDirectory = setupReactProject(tempRoot, "const-arrow-ok", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";

export const deleteAccount = async (accountId: string) => {
  const session = await auth();
  if (!session) throw new Error("unauthorized");
  return { accountId, deleted: true };
};`),
      },
    });
    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("flags concise-body arrow exports without an auth call", async () => {
    const projectDirectory = setupReactProject(tempRoot, "const-arrow-concise-missing", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(
          `export const deleteAccount = async (accountId: string) => db.account.delete({ where: { id: accountId } });`,
        ),
      },
    });
    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteAccount");
  });

  it("accepts concise-body arrow exports whose body IS the auth call", async () => {
    const projectDirectory = setupReactProject(tempRoot, "const-arrow-concise-ok", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";

export const refreshSession = async () => auth();`),
      },
    });
    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("flags `export const fn = async function() {}` missing an auth check", async () => {
    const projectDirectory = setupReactProject(tempRoot, "const-function-expression-missing", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`export const deleteAccount = async function (accountId: string) {
  return db.account.delete({ where: { id: accountId } });
};`),
      },
    });
    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteAccount");
  });

  it("does not count auth() inside a nested helper as protecting the action", async () => {
    const projectDirectory = setupReactProject(tempRoot, "nested-helper-not-counted", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";

export async function deleteAccount(accountId: string) {
  async function unusedHelper() {
    return await auth();
  }
  return db.account.delete({ where: { id: accountId } });
}`),
      },
    });
    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteAccount");
  });

  it("accepts optional-chained member auth calls (`auth0?.getSession()`)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "optional-chain-member-call", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth0 } from "@/lib/auth0";

export async function readProfile(profileId: string) {
  const session = await auth0?.getSession();
  if (!session) throw new Error("unauthorized");
  return { profileId, sessionId: session.id };
}`),
      },
    });
    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts auth calls hidden behind a non-null assertion (`auth!()`)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "ts-non-null-assertion-callee", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";

export async function publishPost(postId: string) {
  const session = await auth!();
  if (!session) throw new Error("unauthorized");
  return { postId, publishedBy: session.userId };
}`),
      },
    });
    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts auth calls hidden behind an `as` cast (`(auth as AuthFn)()`)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "ts-as-cast-callee", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { auth } from "@/lib/auth";
type AuthFn = () => Promise<{ userId: string } | null>;

export async function archiveProject(projectId: string) {
  const session = await (auth as AuthFn)();
  if (!session) throw new Error("unauthorized");
  return { projectId, archivedBy: session.userId };
}`),
      },
    });
    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  // Issue #829: a project guarded its actions with a custom `requireAdmin()`
  // helper, but the rule only knew the canonical `requireAuth` and fired a
  // false positive on every action. The fix recognizes auth guards by naming
  // CONVENTION (`require`/`ensure`/`assert`/… + an auth noun) so common
  // bespoke guards count without needing `serverAuthFunctionNames` config.
  it("accepts a custom `requireAdmin()` guard at the top of an action (issue #829)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "issue-829-require-admin", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { requireAdmin } from "@/data/auth";

export async function removeMovieRequest(id: string) {
  await requireAdmin();
  return { id, deleted: true };
}

export async function updateMovieRequest(id: string, isAdded: boolean) {
  await requireAdmin();
  return { id, isAdded };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts the issue #829 auth helper file (getAdminSession + requireAdmin)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "issue-829-auth-helper", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/data/auth.ts": buildServerActionFile(`import { headers } from "next/headers";
import { auth } from "./auth";
import { serverEnv } from "./env.server";

export async function getAdminSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  if (session.user.email !== serverEnv.ADMIN_EMAIL) return null;
  return { ...session, isAdmin: true };
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session) {
    throw new Error("Unauthorized");
  }
  return session;
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts other common guard conventions (ensureSignedIn, getCurrentUser)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "issue-829-guard-conventions", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts":
          buildServerActionFile(`import { ensureSignedIn, getCurrentUser } from "@/lib/auth";

export async function publishPost(postId: string) {
  await ensureSignedIn();
  return { postId, published: true };
}

export async function updateBio(bio: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("unauthorized");
  return { userId: user.id, bio };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts an action that only revalidates a cache tag (caching needs no auth)", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-tag-only", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";

export async function refreshPosts() {
  revalidateTag("posts");
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts an action that only revalidates a path", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-path-only", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidatePath } from "next/cache";

export const refreshDashboard = async () => {
  revalidatePath("/dashboard");
};`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts an action that revalidates then redirects", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-then-redirect", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function refresh() {
  revalidatePath("/");
  redirect("/");
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts an action whose only effect is a navigation", async () => {
    const projectDirectory = setupReactProject(tempRoot, "redirect-only", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { redirect } from "next/navigation";

export async function go() {
  redirect("/dashboard");
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("follows an invoked module-local function even when it shares a revalidation name", async () => {
    const projectDirectory = setupReactProject(tempRoot, "local-revalidate-name", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`const revalidatePath = (path: string) => {
  db.cache.delete({ where: { path } });
};

export async function wipeEverything() {
  revalidatePath("/");
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues.some((issue) => issue.message.includes("wipeEverything"))).toBe(true);
  });

  it("accepts a revalidation-only action ending in an explicit return undefined", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-return-undefined", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidatePath } from "next/cache";

export async function refreshDashboard() {
  revalidatePath("/dashboard");
  return undefined;
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts a revalidation-only action importing revalidatePath from a re-export barrel", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-barrel-import", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidatePath } from "@/lib/cache";

export async function refreshDashboard() {
  revalidatePath("/dashboard");
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts a revalidation action that also performs a public database read", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-db-read", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";

export async function refresh(userId: string) {
  const user = await db.user.findUnique({ where: { id: userId } });
  revalidateTag(\`user-\${user.id}\`);
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("still flags an action that mutates data alongside a cache revalidation", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-mutation", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { db } from "@/lib/db";

export async function deletePost(postId: string) {
  await db.post.delete({ where: { id: postId } });
  revalidateTag("posts");
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deletePost");
  });

  it("still flags a raw-SQL tagged-template write next to a revalidation", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-sql-template", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { sql } from "@vercel/postgres";

export async function deleteUser(formData: FormData) {
  await sql\`DELETE FROM users WHERE id = \${formData.get("id")}\`;
  revalidateTag("users");
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("deleteUser");
  });

  it("keeps an unresolved constructor next to a revalidation quiet", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-new", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { AuditLogger } from "@/lib/audit";

export async function refresh() {
  new AuditLogger("secret");
  revalidateTag("posts");
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("still flags a module-state assignment next to a revalidation", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-assignment", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { sessionStore } from "@/lib/store";

export async function grantAdmin(formData: FormData) {
  sessionStore[formData.get("user") as string] = "admin";
  revalidateTag("users");
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("grantAdmin");
  });

  it("flags an action that revalidates then returns a module secret", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-data-return", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { serverConfig } from "@/lib/config";

export async function refresh() {
  revalidateTag("posts");
  return serverConfig.apiSecret;
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("apiSecret");
  });

  it("accepts an action that revalidates then returns a plain status literal", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-literal-return", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";

export async function refresh() {
  revalidateTag("posts");
  return { revalidated: true };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts an action that revalidates then returns an awaited value", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-awaited-return", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { sessionPromise } from "@/lib/session";

export async function refresh() {
  revalidateTag("posts");
  return await sessionPromise;
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("flags an action that revalidates then returns a module secret nested in an object", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-nested-return", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { serverConfig } from "@/lib/config";

export async function refresh() {
  revalidateTag("posts");
  return { token: serverConfig.apiSecret };
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("apiSecret");
  });

  it("accepts an action that revalidates then returns a conditional referencing data", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-conditional-return", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { currentUser } from "@/lib/user";

export async function refresh(flag: boolean) {
  revalidateTag("posts");
  return flag ? currentUser.email : null;
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("still flags a `delete` mutation next to a revalidation", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-delete", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { sessionStore } from "@/lib/store";

export async function evict(key: string) {
  delete sessionStore[key];
  revalidateTag("sessions");
}`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("evict");
  });

  it("accepts an action that revalidates then throws a referenced value", async () => {
    const projectDirectory = setupReactProject(tempRoot, "revalidate-plus-data-throw", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { serverConfig } from "@/lib/config";

export async function refresh() {
  revalidateTag("posts");
  throw serverConfig.apiSecret;
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("accepts a concise-arrow action whose body is a single revalidation", async () => {
    const projectDirectory = setupReactProject(tempRoot, "concise-arrow-revalidate", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";

export const refresh = async () => revalidateTag("posts");`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("flags a concise-arrow action that yields a module secret via a sequence", async () => {
    const projectDirectory = setupReactProject(tempRoot, "concise-arrow-sequence-leak", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { revalidateTag } from "next/cache";
import { serverConfig } from "@/lib/config";

export const refresh = async () => (revalidateTag("posts"), serverConfig.apiSecret);`),
      },
    });

    const issues = await collectAuthActionIssues(projectDirectory);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain("apiSecret");
  });

  it("keeps an unresolved same-named method call quiet", async () => {
    const projectDirectory = setupReactProject(tempRoot, "member-named-redirect", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { emitter } from "@/lib/emitter";

export async function go(payload: string) {
  emitter.redirect(payload);
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });

  it("keeps actions whose only top-level call is an unresolved helper quiet", async () => {
    const projectDirectory = setupReactProject(tempRoot, "issue-829-non-auth-helper", {
      packageJsonExtras: { dependencies: NEXTJS_PACKAGE_DEPENDENCIES },
      files: {
        "src/app/actions.ts": buildServerActionFile(`import { loadConfig } from "@/lib/config";

export async function regenerateCache(scope: string) {
  await loadConfig();
  return { scope, regenerated: true };
}`),
      },
    });

    await expect(collectAuthActionIssues(projectDirectory)).resolves.toEqual([]);
  });
});
