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

  it("flags draftMode().isEnabled", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { draftMode } from 'next/headers';
       function f() { if (draftMode().isEnabled) { return true; } }`,
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
});
