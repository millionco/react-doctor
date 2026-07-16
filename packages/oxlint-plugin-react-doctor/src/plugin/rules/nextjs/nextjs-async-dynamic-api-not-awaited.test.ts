import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsAsyncDynamicApiNotAwaited } from "./nextjs-async-dynamic-api-not-awaited.js";

describe("nextjs-async-dynamic-api-not-awaited", () => {
  it("flags immediate member access on headers()", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { headers } from 'next/headers';
       function f() { return headers().get('x-request-id'); }`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags assign-then-member-use on cookies()", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       function f() { const c = cookies(); return c.get('session'); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags optional-chained member access on cookies()", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       function f() { const token = cookies().get('t')?.value; return token; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags a renamed import binding", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { headers as getHeaders } from 'next/headers';
       function f() { return getHeaders().get('x'); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an awaited call", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { headers } from 'next/headers';
       async function f() { return (await headers()).get('x'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag an awaited binding member use", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       async function f() { const c = cookies(); const store = await c; return store.get('t'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag member use after the binding is reassigned from await on itself", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       async function f() { let c = cookies(); c = await c; return c.get('t'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags member use that happens before the awaited reassignment", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       async function f() { let c = cookies(); const value = c.get('t'); c = await c; return value; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag cookies() passed as an argument", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       function f() { return use(cookies()); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a .then() on the returned promise", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       function f() { return cookies().then((c) => c.get('t')); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a sync headers() from another module", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `async function f(response) { return response.headers().location; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag request.cookies member access", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       function handler(request) { return request.cookies.get('t'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-named local not from next/headers", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `function cookies() { return { get() {} }; }
       function f() { return cookies().get('t'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a local const that shadows the import (test-stub factory idiom)", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       async function outer() { return (await cookies()).get('a'); }
       function testHelper() {
         const cookies = () => ({ get: () => 'stub' });
         return cookies().get('t');
       }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a parameter that shadows the import (dependency-injection idiom)", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { headers } from 'next/headers';
       function readRequestId(headers) { return headers().get('x-request-id'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags destructuring off draftMode()", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { draftMode } from 'next/headers';
       function f() { const { isEnabled } = draftMode(); return isEnabled; }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags destructuring off an un-awaited binding", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from 'next/headers';
       function f() { const c = cookies(); const { get } = c; return get('t'); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag destructuring off an awaited call", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { draftMode } from 'next/headers';
       async function f() { const { isEnabled } = await draftMode(); return isEnabled; }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("flags a namespace-import member call", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import * as nextHeaders from 'next/headers';
       function f() { return nextHeaders.headers().get('x'); }`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not flag an awaited namespace-import member call", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import * as nextHeaders from 'next/headers';
       async function f() { return (await nextHeaders.headers()).get('x'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a same-named namespace object not from next/headers", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import * as nextHeaders from './local-headers';
       function f() { return nextHeaders.headers().get('x'); }`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag the codemod escape hatch (UnsafeUnwrappedCookies cast)", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
      const cookieStore = (cookies() as unknown as UnsafeUnwrappedCookies);
      export function getTheme() {
        return cookieStore.get("theme")?.value;
      }`,
      { filename: "app/theme.ts" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag direct member access through an UnsafeUnwrappedHeaders cast", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { headers, type UnsafeUnwrappedHeaders } from "next/headers";
      const userAgent = (headers() as unknown as UnsafeUnwrappedHeaders).get("user-agent");`,
      { filename: "app/ua.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag awaiting through the binding", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies } from "next/headers";
      export async function readTheme() {
        const pending = cookies();
        const store = await pending;
        return store.get("theme");
      }`,
      { filename: "app/read.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag destructuring an awaited draftMode()", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { draftMode } from "next/headers";
      export async function check() {
        const { isEnabled } = await draftMode();
        return isEnabled;
      }`,
      { filename: "app/draft.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag a Promise.all tuple await", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies, headers } from "next/headers";
      export async function readAll() {
        const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
        return cookieStore.get("a") ?? headerList.get("b");
      }`,
      { filename: "app/all.ts" },
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
