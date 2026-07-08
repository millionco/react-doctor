import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { serverAuthActions } from "./server-auth-actions.js";

describe("server/server-auth-actions — regressions", () => {
  it("does not flag a login action (credential-establishing entry point)", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function login(_initialState, formData) {
        const username = formData.get("username");
        const password = formData.get("password");
        const [existingUser] = await db.select().from(userTable).where(eq(userTable.username, username)).limit(1);
        if (!existingUser) return { error: "Incorrect username or password" };
        const validPassword = await verify(existingUser.passwordHash, password);
        if (!validPassword) return { error: "Incorrect username or password" };
        await setSession(existingUser.id);
        redirect("/inbox");
      }`,
      { filename: "lib/auth.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a signup action (no prior session can exist)", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function signup(data) {
        const validatedFields = registerSchema.safeParse(data);
        if (!validatedFields.success) return { error: "Invalid input" };
        const passwordHash = await hash(validatedFields.data.password);
        const res = await db.insert(userTable).values({ username: validatedFields.data.username, passwordHash }).returning({ id: userTable.id });
        await setSession(res[0].id);
        redirect("/inbox");
      }`,
      { filename: "lib/auth.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a password-reset action", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function resetPassword(token, newPassword) {
        const record = await db.query.resetTokens.findFirst({ where: eq(resetTokens.token, token) });
        if (!record) return { error: "Invalid token" };
        await db.update(userTable).set({ passwordHash: await hash(newPassword) }).where(eq(userTable.id, record.userId));
      }`,
      { filename: "lib/auth.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag an action whose name declares it public", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function getPostPublicAction(id) {
        return getPostById({ postId: id });
      }`,
      { filename: "app/actions/post.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a privileged ungated action", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function deletePost(id) {
        await db.delete(postTable).where(eq(postTable.id, id));
      }`,
      { filename: "app/actions/post.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags an ungated action whose name merely contains user", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function updateUserProfile(userId, profile) {
        await db.update(userTable).set(profile).where(eq(userTable.id, userId));
      }`,
      { filename: "app/actions/user.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
