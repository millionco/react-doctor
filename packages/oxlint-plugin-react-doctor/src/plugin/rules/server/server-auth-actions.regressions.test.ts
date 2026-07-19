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

  it("flags async actions exported through a later named export", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const saveCompletedTasks = async (userId, tasks) => {
        await db.insert(savedTasks).values({ userId, tasks });
      };
      export { saveCompletedTasks };`,
      { filename: "app/actions/tasks.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toContain("saveCompletedTasks");
  });

  it("flags an aliased later export without duplicating the action", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const deletePost = async (postId) => {
        await db.delete(posts).where(eq(posts.id, postId));
      };
      export { deletePost as removePost, deletePost };`,
      { filename: "app/actions/posts.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags an async binding exported as default", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const updateAccount = async (accountId, input) => {
        await db.update(accounts).set(input).where(eq(accounts.id, accountId));
      };
      export default updateAccount;`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an authenticated action exported later", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const updateAccount = async (input) => {
        const session = await auth();
        await db.update(accounts).set(input).where(eq(accounts.id, session.user.id));
      };
      export { updateAccount };`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not resolve a re-export from another module to a same-named local", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const removeAccount = async (accountId) => {
        await db.delete(accounts).where(eq(accounts.id, accountId));
      };
      export { removeAccount } from "./external-actions";`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a test-only stream action", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { createStreamableUI } from "ai/rsc";
      export async function action() {
        const stream = createStreamableUI("loading");
        const interval = setInterval(() => stream.update("still loading"), 100);
        clearInterval(interval);
        return stream.value;
      }`,
      { filename: "test/src/app/action.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a session-ending action", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { cookies } from "next/headers";
      export async function logout() {
        const cookieStore = await cookies();
        cookieStore.delete("accessToken");
        cookieStore.delete("refreshToken");
      }`,
      { filename: "app/actions/logout.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a session-ending name that performs a privileged mutation", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function logoutAllUsers() {
        await db.delete(sessions);
      }`,
      { filename: "app/actions/logout.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an unauthenticated action that sets a cookie", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { cookies } from "next/headers";
      export async function writeSessionCookie(value) {
        const cookieStore = await cookies();
        cookieStore.set("session", value);
      }`,
      { filename: "app/actions/session.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a caller-scoped locale preference action", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { setUserLocale } from "@/i18n/db";
      import { revalidatePath } from "next/cache";
      export default async function updateLocale(locale) {
        setUserLocale(locale);
        revalidatePath("/");
      }`,
      { filename: "src/components/shared/update-locale.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a locale helper that can target another user", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { setUserLocale } from "@/i18n/db";
      export async function updateLocale(userId, locale) {
        setUserLocale(userId, locale);
      }`,
      { filename: "app/actions/locale.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an async component-shaped JSON-LD renderer", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { withDataBinding } from "../lib/with-data-binding";
      export const JSONLD = async ({ jsonLD, pageData = {} }) => {
        if (!jsonLD) return null;
        const jsonLDString = withDataBinding(jsonLD, pageData);
        return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLDString }} />;
      };`,
      { filename: "frameworks/nextjs/package/rsc/json-ld.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags an uppercase action that does not render JSX", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function DeleteAccount(accountId) {
        await db.delete(accounts).where(eq(accounts.id, accountId));
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an uppercase action that creates JSX without returning it", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function DeleteAccount(accountId) {
        const unusedView = <p>Deleting</p>;
        await db.delete(accounts).where(eq(accounts.id, accountId));
      }`,
      { filename: "app/actions/account.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });
});
