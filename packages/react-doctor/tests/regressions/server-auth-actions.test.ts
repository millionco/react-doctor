import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ReactDoctorConfig } from "@react-doctor/types";
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
  return { accountId, deleted: true };
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
  return { visitId, segment: profile.segment };
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
  return { workspaceId, invitedBy: member.id };
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
  return { ok: true };
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
  return { accountId, deleted: true };
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
  return { accountId, deleted: true };
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
  return { accountId, deleted: true };
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
        "src/app/actions.ts": buildServerActionFile(`import { performDelete } from "@/lib/delete";

export const deleteAccount = async (accountId: string) => performDelete(accountId);`),
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
  return { accountId, deleted: true };
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
  return { accountId, deleted: true };
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
});
