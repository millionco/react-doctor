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
        await db.update(users).set({ locale }).where(eq(users.id, userId));
      }`,
      { filename: "app/actions/locale.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a public database read", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function searchProducts(query) {
        return prisma.product.findMany({ where: { name: { contains: query } } });
      }`,
      { filename: "app/actions/products.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a public read from an external API", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function getPopularMovies() {
        const response = await fetch("https://example.com/popular");
        return response.json();
      }`,
      { filename: "app/actions/movies.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a mutating @vercel/postgres sql tagged template", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { sql as databaseSql } from "@vercel/postgres";
      import { revalidateTag } from "next/cache";
      export async function deleteAccount(accountId) {
        await databaseSql\`DELETE FROM accounts WHERE id = \${accountId}\`;
        revalidateTag("accounts");
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a read-only @vercel/postgres sql tagged template", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { sql } from "@vercel/postgres";
      export async function listAccounts() {
        return sql\`SELECT * FROM accounts\`;
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust a local sql tagged-template helper as a database mutation", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const sql = (parts) => parts.join("");
      export async function renderDeleteExample() {
        return sql\`DELETE FROM examples\`;
      }`,
      { filename: "app/actions/example.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags direct writes to module-scoped state", () => {
    const assignmentResult = runRule(
      serverAuthActions,
      `"use server";
      import { sessionStore as store } from "./store";
      import { revalidateTag } from "next/cache";
      export async function grantAdmin(userId) {
        store[userId] = "admin";
        revalidateTag("users");
      }`,
      { filename: "app/actions/account.ts" },
    );
    const updateResult = runRule(
      serverAuthActions,
      `"use server";
      let requestCount = 0;
      export async function recordRequest() {
        requestCount += 1;
      }`,
      { filename: "app/actions/account.ts" },
    );
    const deleteResult = runRule(
      serverAuthActions,
      `"use server";
      import { sessionStore } from "./store";
      import { revalidateTag } from "next/cache";
      export async function evictSession(sessionId) {
        delete sessionStore[sessionId];
        revalidateTag("sessions");
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(assignmentResult.parseErrors).toEqual([]);
    expect(assignmentResult.diagnostics).toHaveLength(1);
    expect(updateResult.parseErrors).toEqual([]);
    expect(updateResult.diagnostics).toHaveLength(1);
    expect(deleteResult.parseErrors).toEqual([]);
    expect(deleteResult.diagnostics).toHaveLength(1);
  });

  it("keeps request-local assignments and deletions quiet", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function normalizeRequest(values) {
        values.mode = "safe";
        delete values.legacy;
        let count = 0;
        count += 1;
        return { values, count };
      }`,
      { filename: "app/actions/request.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps unresolved helper calls quiet when no mutation is proven", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { lookupCatalog } from "./catalog";
      export async function getCatalog(query) {
        return lookupCatalog(query);
      }`,
      { filename: "app/actions/catalog.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags mutation-shaped imported helpers with alias and namespace provenance", () => {
    const namedResult = runRule(
      serverAuthActions,
      `"use server";
      import { performDelete as removeAccount } from "./account-store";
      export async function deleteAccount(accountId) {
        await removeAccount(accountId);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const namespaceResult = runRule(
      serverAuthActions,
      `"use server";
      import * as accountStore from "./account-store";
      export async function deleteAccount(accountId) {
        await accountStore.performDelete(accountId);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(namedResult.parseErrors).toEqual([]);
    expect(namedResult.diagnostics).toHaveLength(1);
    expect(namespaceResult.parseErrors).toEqual([]);
    expect(namespaceResult.diagnostics).toHaveLength(1);
  });

  it("keeps safe imports and shadowed mutation-shaped names quiet", () => {
    const safeImportResult = runRule(
      serverAuthActions,
      `"use server";
      import { lookupCatalog, deleteIcon } from "./catalog";
      export async function getCatalog(query) {
        deleteIcon();
        return lookupCatalog(query);
      }`,
      { filename: "app/actions/catalog.ts" },
    );
    const shadowedResult = runRule(
      serverAuthActions,
      `"use server";
      import { performDelete } from "./account-store";
      export async function describeDeletion() {
        const performDelete = () => "not a mutation";
        return performDelete();
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(safeImportResult.parseErrors).toEqual([]);
    expect(safeImportResult.diagnostics).toEqual([]);
    expect(shadowedResult.parseErrors).toEqual([]);
    expect(shadowedResult.diagnostics).toEqual([]);
  });

  it("flags direct, aliased, nested, and sequenced module-secret returns", () => {
    const sources = [
      `import { serverConfig } from "@/lib/config";
       export async function refresh() { return serverConfig.apiSecret; }`,
      `import { serverConfig } from "@/lib/config";
       export async function refresh() {
         const credential = serverConfig.apiSecret;
         return credential;
       }`,
      `import { serverConfig } from "@/lib/config";
       export async function refresh() { return { token: serverConfig.apiSecret }; }`,
      `import { revalidateTag } from "next/cache";
       import { serverConfig } from "@/lib/config";
       export const refresh = async () => (revalidateTag("posts"), serverConfig.apiSecret);`,
    ];
    for (const source of sources) {
      const result = runRule(serverAuthActions, `"use server"; ${source}`, {
        filename: "app/actions/config.ts",
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
      expect(result.diagnostics[0]?.message).toContain("apiSecret");
    }
  });

  it("keeps authenticated, local-shadow, and public-metadata returns quiet", () => {
    const authenticatedResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      import { serverConfig } from "@/lib/config";
      export async function refresh() {
        await auth();
        return serverConfig.apiSecret;
      }`,
      { filename: "app/actions/config.ts" },
    );
    const shadowedResult = runRule(
      serverAuthActions,
      `"use server";
      import { serverConfig } from "@/lib/config";
      export async function refresh() {
        const serverConfig = { apiSecret: "display-only fixture" };
        return serverConfig.apiSecret;
      }`,
      { filename: "app/actions/config.ts" },
    );
    const safeMetadataResult = runRule(
      serverAuthActions,
      `"use server";
      import { serverConfig } from "@/lib/config";
      export async function refresh() {
        return {
          publicKey: serverConfig.publicKey,
          tokenEndpoint: serverConfig.tokenEndpoint,
        };
      }`,
      { filename: "app/actions/config.ts" },
    );
    expect(authenticatedResult.parseErrors).toEqual([]);
    expect(authenticatedResult.diagnostics).toEqual([]);
    expect(shadowedResult.parseErrors).toEqual([]);
    expect(shadowedResult.diagnostics).toEqual([]);
    expect(safeMetadataResult.parseErrors).toEqual([]);
    expect(safeMetadataResult.diagnostics).toEqual([]);
  });

  it("flags a billable LangChain action in an App Router tools directory", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function executeTool(input) {
        (async () => {
          const model = new ChatOpenAI({ model: "gpt-4o-mini" });
          const prompt = createPrompt();
          let chain;
          chain = prompt.pipe(model);
          await chain.stream(input);
        })();
        return { started: true };
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer a billable call from an unrelated stream method", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function streamPublicFeed(input) {
        const model = new ChatOpenAI({ model: "gpt-4o-mini" });
        return publicFeed.stream(input);
      }`,
      { filename: "app/actions/feed.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not treat a property derived from a LangChain client as the client", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function readModelName() {
        const model = new ChatOpenAI({ model: "gpt-4o-mini" });
        const modelName = model.modelName;
        return modelName.stream();
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust a shadowed ChatOpenAI import name", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function streamPublicFeed(ChatOpenAI) {
        const model = new ChatOpenAI();
        return model.stream();
      }`,
      { filename: "app/actions/feed.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a LangChain invocation inside an uncalled nested function", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function prepareTool(input) {
        const model = new ChatOpenAI({ model: "gpt-4o-mini" });
        const invokeLater = () => model.invoke(input);
        return { ready: true };
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("ignores a database mutation inside an uncalled nested function", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function prepareDeletion(accountId) {
        const deleteLater = () => db.delete(accounts).where(eq(accounts.id, accountId));
        return { ready: true };
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("flags a database mutation in an invoked same-file helper", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      async function removeAccount(accountId) {
        await db.delete(accounts).where(eq(accounts.id, accountId));
      }
      export async function deleteAccount(accountId) {
        await removeAccount(accountId);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a database mutation in an invoked nested helper", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccount(accountId) {
        const removeAccount = async () => {
          await db.delete(accounts).where(eq(accounts.id, accountId));
        };
        await removeAccount();
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags database and cookie mutations passed through helper parameters", () => {
    const databaseResult = runRule(
      serverAuthActions,
      `"use server";
      const mutate = async (database) => database.delete(accounts);
      export async function deleteAccount() {
        await mutate(db);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const cookieResult = runRule(
      serverAuthActions,
      `"use server";
      import { cookies } from "next/headers";
      const mutate = async (store) => store.set("session", "value");
      export async function writeCookie() {
        const store = await cookies();
        await mutate(store);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(databaseResult.parseErrors).toEqual([]);
    expect(databaseResult.diagnostics).toHaveLength(1);
    expect(cookieResult.parseErrors).toEqual([]);
    expect(cookieResult.diagnostics).toHaveLength(1);
  });

  it("flags mutations in proven synchronous array callbacks", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccounts(accountIds: string[]) {
        accountIds.forEach((accountId) => {
          db.delete(accounts).where(eq(accounts.id, accountId));
        });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags mutations in Array.from callbacks and Promise executors", () => {
    const arrayResult = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccounts(accountIds) {
        Array.from(accountIds, (accountId) => {
          db.delete(accounts).where(eq(accounts.id, accountId));
        });
      }`,
      { filename: "app/actions/account.ts" },
    );
    const promiseResult = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccount(accountId) {
        await new Promise((resolve) => {
          db.delete(accounts).where(eq(accounts.id, accountId));
          resolve();
        });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(arrayResult.parseErrors).toEqual([]);
    expect(arrayResult.diagnostics).toHaveLength(1);
    expect(promiseResult.parseErrors).toEqual([]);
    expect(promiseResult.diagnostics).toHaveLength(1);
  });

  it("keeps callbacks on unresolved receivers quiet", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function prepareDeletion(collection) {
        collection.forEach(() => db.delete(accounts));
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not execute collection thisArg and initial-value functions", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function summarize(values: string[]) {
        const mutate = () => db.delete(accounts);
        values.map((value) => value.length, mutate);
        values.reduce((total, value) => total + value.length, mutate);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag mutations of request-local typed collections", () => {
    const source = `"use server";
      export async function normalizeRequest(
        formData: FormData,
        headers: Headers,
        searchParams: URLSearchParams,
        values: Map<string, string>,
        selected: Set<string>,
      ) {
        formData.set("name", "Ada");
        headers.set("x-request-id", "local");
        searchParams.set("page", "1");
        values.set("name", "Ada");
        selected.delete("primary");
      }`;
    const result = runRule(serverAuthActions, source, {
      filename: "app/actions/request.ts",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not let a safe receiver name suppress a shadowed database binding", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function updateAccount() {
        const values = new Map();
        if (shouldUpdate()) {
          const values = db;
          values.set(accounts, { disabled: true });
        }
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust shadowed mutable constructor names", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function updateAccount(Map) {
        const values = new Map();
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not let reassignment preserve safe receiver provenance", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function updateAccount() {
        let values = new FormData();
        values = db;
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a shadowed request-local intrinsic type", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      interface FormData { set(table: unknown, value: unknown): void }
      export async function updateAccount(values: FormData) {
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not trust a local headers factory", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      const headers = () => db;
      export async function updateAccount() {
        const values = headers();
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("keeps request-local mutations inside executed callbacks quiet", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      export async function normalizeRequest() {
        [new FormData()].forEach((values) => values.set("name", "Ada"));
      }`,
      { filename: "app/actions/request.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("keeps an IIFE-local safe receiver distinct from an outer cookie binding", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { cookies } from "next/headers";
      export async function normalizeRequest() {
        const store = await cookies();
        (() => {
          const store = new FormData();
          store.set("name", "Ada");
        })();
      }`,
      { filename: "app/actions/request.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not flag a LangChain binding reassigned before invocation", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function streamPublicFeed(input) {
        let model = new ChatOpenAI({ model: "gpt-4o-mini" });
        model = publicFeed;
        return model.stream(input);
      }`,
      { filename: "app/actions/feed.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a LangChain invocation before a later reassignment", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function executeTool(input) {
        let model = new ChatOpenAI({ model: "gpt-4o-mini" });
        await model.invoke(input);
        model = publicFeed;
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag a derived LangChain binding reassigned before invocation", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function streamPublicFeed(input) {
        const model = new ChatOpenAI({ model: "gpt-4o-mini" });
        let chain = model.bind({ temperature: 0 });
        chain = publicFeed;
        return chain.stream(input);
      }`,
      { filename: "app/actions/feed.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("invalidates LangChain and safe receiver provenance through executed IIFEs", () => {
    const langchainResult = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function streamPublicFeed(input) {
        let model = new ChatOpenAI({ model: "gpt-4o-mini" });
        (() => { model = publicFeed; })();
        return model.invoke(input);
      }`,
      { filename: "app/actions/feed.ts" },
    );
    const databaseResult = runRule(
      serverAuthActions,
      `"use server";
      export async function updateAccount() {
        let values = new FormData();
        (() => { values = db; })();
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(langchainResult.parseErrors).toEqual([]);
    expect(langchainResult.diagnostics).toEqual([]);
    expect(databaseResult.parseErrors).toEqual([]);
    expect(databaseResult.diagnostics).toHaveLength(1);
  });

  it("flags a LangChain binding assigned from the client before invocation", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      export async function executeTool(input) {
        let model = publicFeed;
        model = new ChatOpenAI({ model: "gpt-4o-mini" });
        return model.invoke(input);
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a LangChain invocation in an invoked helper", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      const invokeModel = async (input) => {
        const model = new ChatOpenAI({ model: "gpt-4o-mini" });
        return model.invoke(input);
      };
      export async function executeTool(input) {
        return invokeModel(input);
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a LangChain client passed through a helper parameter", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { ChatOpenAI } from "@langchain/openai";
      const invokeModel = async (model, input) => model.invoke(input);
      export async function executeTool(input) {
        const model = new ChatOpenAI({ model: "gpt-4o-mini" });
        return invokeModel(model, input);
      }`,
      { filename: "app/ai_sdk/tools/action.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("accepts auth inside an invoked mutation helper", () => {
    const result = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      const removeAccount = async (accountId) => {
        const session = await auth();
        await db.delete(accounts).where(eq(accounts.id, session.user.id));
      };
      export async function deleteAccount(accountId) {
        await removeAccount(accountId);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("does not trust auth guards shadowed by caller-controlled parameters", () => {
    const bareResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      export async function deleteAccount(auth, accountId) {
        await auth();
        await db.delete(accounts).where(eq(accounts.id, accountId));
      }`,
      { filename: "app/actions/account.ts" },
    );
    const memberResult = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccount(ctx, accountId) {
        await ctx.requireAdmin();
        await db.delete(accounts).where(eq(accounts.id, accountId));
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(bareResult.parseErrors).toEqual([]);
    expect(bareResult.diagnostics).toHaveLength(1);
    expect(memberResult.parseErrors).toEqual([]);
    expect(memberResult.diagnostics).toHaveLength(1);
  });

  it("does not accept auth after mutation or conditional auth", () => {
    const afterResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      export async function deleteAccount() {
        await db.delete(accounts);
        await auth();
      }`,
      { filename: "app/actions/account.ts" },
    );
    const conditionalResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      export async function deleteAccount(shouldAuthenticate) {
        if (shouldAuthenticate) await auth();
        await db.delete(accounts);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(afterResult.parseErrors).toEqual([]);
    expect(afterResult.diagnostics).toHaveLength(1);
    expect(conditionalResult.parseErrors).toEqual([]);
    expect(conditionalResult.diagnostics).toHaveLength(1);
  });

  it("requires auth to precede every privileged operation shape", () => {
    const operationSources = [
      {
        setup: `import * as postgres from "@vercel/postgres";`,
        operation: `await postgres.sql\`DELETE FROM accounts\`;`,
      },
      {
        setup: `let requestCount = 0;`,
        operation: `requestCount += 1;`,
      },
      {
        setup: `import { performDelete } from "./account-store";`,
        operation: `await performDelete();`,
      },
      {
        setup: `const performDelete = async () => db.delete(accounts);`,
        operation: `await performDelete();`,
      },
      {
        setup: ``,
        operation: `[accountId].forEach(() => db.delete(accounts));`,
      },
      {
        setup: ``,
        operation: `await new Promise((resolve) => {
          db.delete(accounts);
          resolve();
        });`,
      },
    ];
    for (const operationSource of operationSources) {
      const afterResult = runRule(
        serverAuthActions,
        `"use server";
        import { auth } from "@/auth";
        ${operationSource.setup}
        export async function updateAccount() {
          ${operationSource.operation}
          await auth();
        }`,
        { filename: "app/actions/account.ts" },
      );
      const beforeResult = runRule(
        serverAuthActions,
        `"use server";
        import { auth } from "@/auth";
        ${operationSource.setup}
        export async function updateAccount() {
          await auth();
          ${operationSource.operation}
        }`,
        { filename: "app/actions/account.ts" },
      );
      expect(afterResult.parseErrors).toEqual([]);
      expect(afterResult.diagnostics).toHaveLength(1);
      expect(beforeResult.parseErrors).toEqual([]);
      expect(beforeResult.diagnostics).toEqual([]);
    }
  });

  it("does not trust configured or aliased caller-controlled auth guards", () => {
    const configuredResult = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccount(ensureTenant) {
        await ensureTenant();
        await db.delete(accounts);
      }`,
      {
        filename: "app/actions/account.ts",
        settings: { reactDoctor: { serverAuthFunctionNames: ["ensureTenant"] } },
      },
    );
    const aliasResult = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccount(ctx) {
        const guard = ctx;
        await guard.requireAdmin();
        await db.delete(accounts);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(configuredResult.parseErrors).toEqual([]);
    expect(configuredResult.diagnostics).toHaveLength(1);
    expect(aliasResult.parseErrors).toEqual([]);
    expect(aliasResult.diagnostics).toHaveLength(1);
  });

  it("does not flag exact local auth guards or crypto builders", () => {
    const authResult = runRule(
      serverAuthActions,
      `"use server";
      async function requireAuth() {
        const session = await auth();
        if (!session) throw new Error("unauthorized");
      }
      export async function deleteAccount() {
        await requireAuth();
        await db.delete(accounts);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const cryptoResult = runRule(
      serverAuthActions,
      `"use server";
      import { createHash } from "node:crypto";
      export async function hashValue(input) {
        return createHash("sha256").update(input).digest("hex");
      }`,
      { filename: "app/actions/hash.ts" },
    );
    expect(authResult.parseErrors).toEqual([]);
    expect(authResult.diagnostics).toEqual([]);
    expect(cryptoResult.parseErrors).toEqual([]);
    expect(cryptoResult.diagnostics).toEqual([]);
  });

  it("requires an invoked auth helper to execute unconditionally", () => {
    const conditionalResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      const requireSession = async () => auth();
      export async function deleteAccount(shouldAuthenticate) {
        if (shouldAuthenticate) await requireSession();
        await db.delete(accounts);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const unconditionalResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      const requireSession = async () => auth();
      export async function deleteAccount() {
        await requireSession();
        await db.delete(accounts);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const shortCircuitResult = runRule(
      serverAuthActions,
      `"use server";
      import { auth } from "@/auth";
      const requireSession = async () => auth();
      export async function deleteAccount(shouldAuthenticate) {
        shouldAuthenticate && await requireSession();
        await db.delete(accounts);
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(conditionalResult.parseErrors).toEqual([]);
    expect(conditionalResult.diagnostics).toHaveLength(1);
    expect(unconditionalResult.parseErrors).toEqual([]);
    expect(unconditionalResult.diagnostics).toEqual([]);
    expect(shortCircuitResult.parseErrors).toEqual([]);
    expect(shortCircuitResult.diagnostics).toHaveLength(1);
  });

  it("keeps every reaching receiver definition after a conditional safe write", () => {
    const conditionalResult = runRule(
      serverAuthActions,
      `"use server";
      export async function updateAccount(useRequestLocalValues) {
        let values = db;
        if (useRequestLocalValues) values = new FormData();
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    const unconditionalResult = runRule(
      serverAuthActions,
      `"use server";
      export async function normalizeRequest() {
        let values = db;
        values = new FormData();
        values.set("name", "Ada");
      }`,
      { filename: "app/actions/request.ts" },
    );
    const deadWriteResult = runRule(
      serverAuthActions,
      `"use server";
      export async function normalizeRequest() {
        let values = new FormData();
        if (false) values = db;
        values.set("name", "Ada");
      }`,
      { filename: "app/actions/request.ts" },
    );
    const conditionalUnsafeResult = runRule(
      serverAuthActions,
      `"use server";
      export async function updateAccount(shouldPersist) {
        let values = new FormData();
        if (shouldPersist) values = db;
        values.set(accounts, { disabled: true });
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(conditionalResult.parseErrors).toEqual([]);
    expect(conditionalResult.diagnostics).toHaveLength(1);
    expect(unconditionalResult.parseErrors).toEqual([]);
    expect(unconditionalResult.diagnostics).toEqual([]);
    expect(deadWriteResult.parseErrors).toEqual([]);
    expect(deadWriteResult.diagnostics).toEqual([]);
    expect(conditionalUnsafeResult.parseErrors).toEqual([]);
    expect(conditionalUnsafeResult.diagnostics).toHaveLength(1);
  });

  it("does not trust a spread argument that reaches a proven mutation receiver", () => {
    const mutationResult = runRule(
      serverAuthActions,
      `"use server";
      const persist = async (database) => database.delete(accounts);
      export async function deleteAccount(databases) {
        await persist(new FormData());
        await persist(...databases);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const unresolvedCallResult = runRule(
      serverAuthActions,
      `"use server";
      const read = async (catalog) => catalog.lookup("featured");
      export async function listFeatured(catalogs) {
        return read(...catalogs);
      }`,
      { filename: "app/actions/catalog.ts" },
    );
    const knownMutationResult = runRule(
      serverAuthActions,
      `"use server";
      const persist = async (database) => database.delete(accounts);
      export async function deleteAccount() {
        await persist(...[db]);
      }`,
      { filename: "app/actions/account.ts" },
    );
    const knownSafeResult = runRule(
      serverAuthActions,
      `"use server";
      const normalize = async (values) => values.set("name", "Ada");
      export async function normalizeRequest() {
        await normalize(...[new FormData()]);
      }`,
      { filename: "app/actions/request.ts" },
    );
    const mixedSpreadResult = runRule(
      serverAuthActions,
      `"use server";
      const normalize = async (values) => values.set("name", "Ada");
      export async function normalizeRequest(requestValues) {
        await normalize(new FormData());
        await normalize(...requestValues);
      }`,
      { filename: "app/actions/request.ts" },
    );
    expect(mutationResult.parseErrors).toEqual([]);
    expect(mutationResult.diagnostics).toHaveLength(1);
    expect(unresolvedCallResult.parseErrors).toEqual([]);
    expect(unresolvedCallResult.diagnostics).toEqual([]);
    expect(knownMutationResult.parseErrors).toEqual([]);
    expect(knownMutationResult.diagnostics).toHaveLength(1);
    expect(knownSafeResult.parseErrors).toEqual([]);
    expect(knownSafeResult.diagnostics).toEqual([]);
    expect(mixedSpreadResult.parseErrors).toEqual([]);
    expect(mixedSpreadResult.diagnostics).toHaveLength(1);
  });

  it("ignores mutations in statically unreachable helper invocations", () => {
    const unreachableResult = runRule(
      serverAuthActions,
      `"use server";
      const removeAccount = async () => db.delete(accounts);
      export async function previewDeletion() {
        if (false) await removeAccount();
        return { ready: true };
      }`,
      { filename: "app/actions/account.ts" },
    );
    const reachableResult = runRule(
      serverAuthActions,
      `"use server";
      const removeAccount = async () => db.delete(accounts);
      export async function deleteAccount() {
        await removeAccount();
      }`,
      { filename: "app/actions/account.ts" },
    );
    const unreachableIifeResult = runRule(
      serverAuthActions,
      `"use server";
      export async function previewDeletion() {
        false && (() => db.delete(accounts))();
        return { ready: true };
      }`,
      { filename: "app/actions/account.ts" },
    );
    const reachableIifeResult = runRule(
      serverAuthActions,
      `"use server";
      export async function deleteAccount() {
        (() => db.delete(accounts))();
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(unreachableResult.parseErrors).toEqual([]);
    expect(unreachableResult.diagnostics).toEqual([]);
    expect(reachableResult.parseErrors).toEqual([]);
    expect(reachableResult.diagnostics).toHaveLength(1);
    expect(unreachableIifeResult.parseErrors).toEqual([]);
    expect(unreachableIifeResult.diagnostics).toEqual([]);
    expect(reachableIifeResult.parseErrors).toEqual([]);
    expect(reachableIifeResult.diagnostics).toHaveLength(1);
  });

  it("limits credential exemptions to exact credential operations", () => {
    const unrelatedResult = runRule(
      serverAuthActions,
      `"use server";
      export async function registerWebhook(endpoint) {
        await db.insert(webhooks).values({ endpoint });
      }`,
      { filename: "app/actions/webhook.ts" },
    );
    const registrationResult = runRule(
      serverAuthActions,
      `"use server";
      export async function register(data) {
        const passwordHash = await hash(data.password);
        await db.insert(users).values({ email: data.email, passwordHash });
      }`,
      { filename: "app/actions/auth.ts" },
    );
    const credentialActionResult = runRule(
      serverAuthActions,
      `"use server";
      export async function resetPasswordAction(userId, passwordHash) {
        await db.update(users).set({ passwordHash }).where(eq(users.id, userId));
      }`,
      { filename: "app/actions/auth.ts" },
    );
    const unrelatedCredentialNames = [
      "resetDiscountCode",
      "verifyEmailPreferences",
      "confirmEmailDeletion",
    ];
    for (const actionName of unrelatedCredentialNames) {
      const unrelatedCredentialResult = runRule(
        serverAuthActions,
        `"use server";
        export async function ${actionName}() {
          await db.delete(accounts);
        }`,
        { filename: "app/actions/account.ts" },
      );
      expect(unrelatedCredentialResult.parseErrors).toEqual([]);
      expect(unrelatedCredentialResult.diagnostics).toHaveLength(1);
    }
    expect(unrelatedResult.parseErrors).toEqual([]);
    expect(unrelatedResult.diagnostics).toHaveLength(1);
    expect(registrationResult.parseErrors).toEqual([]);
    expect(registrationResult.diagnostics).toEqual([]);
    expect(credentialActionResult.parseErrors).toEqual([]);
    expect(credentialActionResult.diagnostics).toEqual([]);
  });

  it("recognizes mutating sql tags through @vercel/postgres namespace imports", () => {
    const mutationResult = runRule(
      serverAuthActions,
      `"use server";
      import * as postgres from "@vercel/postgres";
      export async function deleteAccount(accountId) {
        await postgres.sql\`DELETE FROM accounts WHERE id = \${accountId}\`;
      }`,
      { filename: "app/actions/account.ts" },
    );
    const readResult = runRule(
      serverAuthActions,
      `"use server";
      import * as postgres from "@vercel/postgres";
      export async function listAccounts() {
        return postgres.sql\`SELECT * FROM accounts\`;
      }`,
      { filename: "app/actions/account.ts" },
    );
    const commentedMutationResult = runRule(
      serverAuthActions,
      `"use server";
      import * as postgres from "@vercel/postgres";
      export async function deleteAccount(accountId) {
        await postgres.sql\`/* audit */ DELETE FROM accounts WHERE id = \${accountId}\`;
      }`,
      { filename: "app/actions/account.ts" },
    );
    const commentedReadResult = runRule(
      serverAuthActions,
      `"use server";
      import * as postgres from "@vercel/postgres";
      export async function listAccounts() {
        return postgres.sql\`-- audit\nSELECT * FROM accounts\`;
      }`,
      { filename: "app/actions/account.ts" },
    );
    expect(mutationResult.parseErrors).toEqual([]);
    expect(mutationResult.diagnostics).toHaveLength(1);
    expect(readResult.parseErrors).toEqual([]);
    expect(readResult.diagnostics).toEqual([]);
    expect(commentedMutationResult.parseErrors).toEqual([]);
    expect(commentedMutationResult.diagnostics).toHaveLength(1);
    expect(commentedReadResult.parseErrors).toEqual([]);
    expect(commentedReadResult.diagnostics).toEqual([]);
  });

  it("still skips test files and test directories under App Router", () => {
    const source = `"use server";
      export async function deleteAccount(accountId) {
        await db.delete(accounts).where(eq(accounts.id, accountId));
      }`;
    const suffixResult = runRule(serverAuthActions, source, {
      filename: "app/tools/action.test.ts",
    });
    const directoryResult = runRule(serverAuthActions, source, {
      filename: "app/__tests__/tools/action.ts",
    });
    expect(suffixResult.parseErrors).toEqual([]);
    expect(suffixResult.diagnostics).toEqual([]);
    expect(directoryResult.parseErrors).toEqual([]);
    expect(directoryResult.diagnostics).toEqual([]);
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
