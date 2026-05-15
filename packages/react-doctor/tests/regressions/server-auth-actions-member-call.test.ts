/**
 * Regression tests for `server-auth-actions` — issue #239.
 *
 * The rule used to recognise auth calls ONLY when the callee was a bare
 * `Identifier` (`auth()`, `getSession()`, `getUser()`, …). Every
 * member-expression flavour — `auth0.getSession()`, `clerkClient.getUser()`,
 * `supabase.auth.getSession()`, `request.auth()` — slipped through and
 * fired a false positive on the whole server action. One repo reported 139
 * false positives, essentially every server action.
 *
 * After the fix, `containsAuthCheck` delegates to `getCalleeName`, which
 * resolves the final property name of a `MemberExpression` callee the same
 * way it resolves an `Identifier` callee. This file pins down:
 *   - false-negative shapes the rule MUST now accept as an auth check
 *     (zero hits),
 *   - true-positive shapes the rule MUST still flag as missing auth
 *     (exactly one hit, on the right function).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vite-plus/test";

import { runOxlint } from "@react-doctor/core";
import type { Diagnostic, ProjectInfo } from "@react-doctor/types";
import { buildTestProject, setupReactProject, writeFile } from "./_helpers.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-server-auth-actions-member-"));

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

const RULE_NAME = "server-auth-actions";

const buildNextjsProject = (caseId: string): { rootDirectory: string; project: ProjectInfo } => {
  const rootDirectory = setupReactProject(tempRoot, caseId);
  return {
    rootDirectory,
    project: buildTestProject({ rootDirectory, framework: "nextjs" }),
  };
};

const writeActionAndLint = async (
  caseId: string,
  source: string,
  filename = "src/app/actions.ts",
): Promise<Diagnostic[]> => {
  const { rootDirectory, project } = buildNextjsProject(caseId);
  writeFile(path.join(rootDirectory, filename), source);
  return runOxlint({ rootDirectory, project });
};

const filterRule = (diagnostics: Diagnostic[]): Diagnostic[] =>
  diagnostics.filter((diagnostic) => diagnostic.rule === RULE_NAME);

describe("issue #239: server-auth-actions accepts member-expression auth calls", () => {
  describe("does NOT fire when the auth check is", () => {
    it("a bare `await auth0.getSession()` — the verbatim repro", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-auth0-direct",
        `"use server";

declare const auth0: { getSession: () => Promise<{ user: { id: string } } | null> };
declare const db: { post: { create: (input: unknown) => Promise<unknown> } };

export async function createPost(input: { title: string }) {
  const session = await auth0.getSession();
  if (!session) throw new Error("unauthorized");
  return db.post.create({ data: { title: input.title, userId: session.user.id } });
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("a non-awaited `auth0.getSession()` returning a value", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-auth0-sync",
        `"use server";

declare const auth0: { getSession: () => { user: { id: string } } | null };

export async function deletePost(postId: string) {
  const session = auth0.getSession();
  if (!session) throw new Error("unauthorized");
  return { ok: true, postId };
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("a chained `supabase.auth.getSession()`", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-supabase-chain",
        `"use server";

declare const supabase: { auth: { getSession: () => Promise<{ data: { session: unknown } }> } };

export async function refreshDashboard() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("unauthorized");
  return { ok: true };
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("a `clerkClient.getUser(userId)` call", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-clerk",
        `"use server";

declare const clerkClient: { getUser: (id: string) => Promise<{ id: string } | null> };

export async function updateProfile(userId: string, name: string) {
  const user = await clerkClient.getUser(userId);
  if (!user) throw new Error("unauthorized");
  return { ok: true, userId, name };
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("an optional-chained `auth0?.getSession()`", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-optional-chain",
        `"use server";

declare const auth0: { getSession: () => Promise<{ user: { id: string } } | null> } | null;

export async function archiveAccount() {
  const session = await auth0?.getSession();
  if (!session) throw new Error("unauthorized");
  return { ok: true };
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });

    it("a bare `await auth()` (NextAuth v5) — regression for the original Identifier path", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-nextauth-direct",
        `"use server";

declare const auth: () => Promise<{ user: { id: string } } | null>;

export async function publishDraft(draftId: string) {
  const session = await auth();
  if (!session) throw new Error("unauthorized");
  return { ok: true, draftId };
}
`,
      );
      expect(filterRule(diagnostics)).toHaveLength(0);
    });
  });

  describe("STILL fires when", () => {
    it("a server action has no auth-related call at all", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-no-auth",
        `"use server";

declare const db: { post: { update: (input: unknown) => Promise<unknown> } };

export async function publish(postId: string) {
  return db.post.update({ where: { id: postId }, data: { published: true } });
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("publish");
    });

    it("a server action calls an unrelated `.something()` method that is not in AUTH_FUNCTION_NAMES", async () => {
      const diagnostics = await writeActionAndLint(
        "issue-239-unrelated-member-call",
        `"use server";

declare const logger: { info: (message: string) => void };

export async function track(eventName: string) {
  logger.info(eventName);
  return { ok: true };
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("track");
    });

    it("the auth call comes AFTER the lookahead window (10 statements in)", async () => {
      const noopStatements = Array.from(
        { length: 10 },
        (_unused, index) => `  const x${index} = ${index};`,
      ).join("\n");
      const diagnostics = await writeActionAndLint(
        "issue-239-after-lookahead",
        `"use server";

declare const auth0: { getSession: () => Promise<{ user: { id: string } } | null> };

export async function lateAuth() {
${noopStatements}
  const session = await auth0.getSession();
  if (!session) throw new Error("unauthorized");
  return { ok: true };
}
`,
      );
      const hits = filterRule(diagnostics);
      expect(hits).toHaveLength(1);
      expect(hits[0].message).toContain("lateAuth");
    });
  });
});
