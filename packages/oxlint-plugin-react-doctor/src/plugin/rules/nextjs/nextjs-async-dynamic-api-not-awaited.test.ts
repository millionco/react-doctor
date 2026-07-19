import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsAsyncDynamicApiNotAwaited } from "./nextjs-async-dynamic-api-not-awaited.js";

const run = (code: string, filename = "app/page.tsx") =>
  runRule(nextjsAsyncDynamicApiNotAwaited, code, { filename });

const expectDiagnosticCount = (code: string, count: number, filename?: string): void => {
  const result = run(code, filename);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(count);
};

describe("nextjs-async-dynamic-api-not-awaited", () => {
  it.each(["cookies", "headers", "draftMode"])(
    "reports immediate property access on %s()",
    (apiName) => {
      expectDiagnosticCount(
        `import { ${apiName} } from "next/headers";
         export const read = () => ${apiName}().value;`,
        1,
      );
    },
  );

  it("reports named-import aliases", () => {
    expectDiagnosticCount(
      `import { headers as requestHeaders } from "next/headers";
       export const read = () => requestHeaders().get("x-request-id");`,
      1,
    );
  });

  it.each(["nextHeaders.headers()", 'nextHeaders["headers"]()'])(
    "reports namespace access through %s",
    (callExpression) => {
      expectDiagnosticCount(
        `import * as nextHeaders from "next/headers";
         export const read = () => ${callExpression}.get("x-request-id");`,
        1,
      );
    },
  );

  it("reports namespace access through a const property alias", () => {
    expectDiagnosticCount(
      `import * as nextHeaders from "next/headers";
       const apiName = "cookies";
       export const read = () => nextHeaders[apiName]().get("session");`,
      1,
    );
  });

  it("reports optional member access", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => cookies()?.get("session")?.value;`,
      1,
    );
  });

  it("reports member access through a local binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pendingCookies = cookies(); return pendingCookies.get("session"); };`,
      1,
    );
  });

  it("reports wrapped member access through a local binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pendingCookies = cookies(); return (pendingCookies as any)!.get("session"); };`,
      1,
    );
  });

  it("reports member access through const aliases", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         const pendingCookies = cookies();
         const samePendingCookies = pendingCookies;
         const finalAlias = samePendingCookies as Promise<unknown>;
         return finalAlias.get("session");
       };`,
      1,
    );
  });

  it("reports direct object destructuring", () => {
    expectDiagnosticCount(
      `import { draftMode } from "next/headers";
       export const read = () => { const { isEnabled } = draftMode(); return isEnabled; };`,
      1,
    );
  });

  it("reports object destructuring through a binding", () => {
    expectDiagnosticCount(
      `import { draftMode } from "next/headers";
       export const read = () => { const pending = draftMode(); const { isEnabled } = pending; return isEnabled; };`,
      1,
    );
  });

  it("reports destructuring assignment from a direct call", () => {
    expectDiagnosticCount(
      `import { draftMode } from "next/headers";
       let isEnabled;
       export const read = () => ({ isEnabled } = draftMode());`,
      1,
    );
  });

  it("does not report destructuring only Promise settlement methods", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const { then } = cookies(); return then; };`,
      0,
    );
  });

  it("does not report Promise-method destructuring through a binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pending = cookies(); const { ["catch"]: catchPromise } = pending; return catchPromise; };`,
      0,
    );
  });

  it("reports a rest-only Promise destructure", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pending = cookies(); const { ...ownProperties } = pending; return ownProperties; };`,
      1,
    );
  });

  it("does not report an empty object destructure", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const {} = cookies(); };`,
      0,
    );
  });

  it.each([
    "const [firstCookie] = cookies(); return firstCookie;",
    "const pending = cookies(); const [] = pending;",
  ])("reports iterable destructuring through %s", (statement) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { ${statement} };`,
      1,
    );
  });

  it.each([
    "return [...headers()];",
    "return { ...headers() };",
    "const pending = headers(); return consume(...pending);",
  ])("reports synchronous spread through %s", (statement) => {
    expectDiagnosticCount(
      `import { headers } from "next/headers";
       export const read = () => { ${statement} };`,
      1,
    );
  });

  it.each([
    "for (const header of headers()) consume(header);",
    "const pending = headers(); for (const key in pending) consume(key);",
    "const pending = headers(); yield* pending;",
  ])("reports synchronous iteration through %s", (statement) => {
    expectDiagnosticCount(
      `import { headers } from "next/headers";
       export function* read() { ${statement} }`,
      1,
    );
  });

  it.each([
    "Object.keys(cookies())",
    "Object.values(cookies())",
    "Object.entries(cookies())",
    "Object.getOwnPropertyNames(cookies())",
    "Reflect.ownKeys(cookies())",
    "Object.fromEntries(cookies())",
    "Object.assign({}, cookies())",
    "Array.from(cookies())",
  ])("reports synchronous enumeration through %s", (expression) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => ${expression};`,
      1,
    );
  });

  it.each(["new Map(headers())", "const pending = headers(); return new Set(pending);"])(
    "reports synchronous iterable construction through %s",
    (statement) => {
      expectDiagnosticCount(
        `import { headers } from "next/headers";
         export const read = () => { ${statement} };`,
        1,
      );
    },
  );

  it("does not treat a shadowed iterable constructor as built-in consumption", () => {
    expectDiagnosticCount(
      `import { headers } from "next/headers";
       export const read = (Map) => new Map(headers());`,
      0,
    );
  });

  it("reports synchronous enumeration through a binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pending = cookies(); return Object.keys(pending); };`,
      1,
    );
  });

  it("does not treat a shadowed Object helper as built-in enumeration", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = (Object) => Object.keys(cookies());`,
      0,
    );
  });

  it("reports mixed Promise and dynamic-API destructuring", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const { then, get } = cookies(); return { then, get }; };`,
      1,
    );
  });

  it("reports access before an unconditional reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const value = pending.get("session");
         pending = await pending;
         return value;
       };`,
      1,
    );
  });

  it("reports access after a conditional awaited reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldAwait) => {
         let pending = cookies();
         if (shouldAwait) pending = await pending;
         return pending.get("session");
       };`,
      1,
    );
  });

  it("does not let a deferred nested write hide an outer access", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         const replaceLater = () => { pending = getFallback(); };
         const value = pending.get("session");
         return { replaceLater, value };
       };`,
      1,
    );
  });

  it("reports access after an unconditional same-API reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { let pending = cookies(); pending = cookies(); return pending.get("session"); };`,
      1,
    );
  });

  it("reports independent pending phases of the same binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const first = pending.get("first");
         pending = await pending;
         pending = cookies();
         const second = pending.get("second");
         return { first, second };
       };`,
      2,
    );
  });

  it("reports access when an unconditional assignment can preserve the pending value", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldAwait) => {
         let pending = cookies();
         pending = shouldAwait ? await pending : pending;
         return pending.get("session");
       };`,
      1,
    );
  });

  it("does not report an awaited direct call", () => {
    expectDiagnosticCount(
      `import { headers } from "next/headers";
       export const read = async () => (await headers()).get("x-request-id");`,
      0,
    );
  });

  it("does not report an awaited binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => { const pending = cookies(); const store = await pending; return store.get("session"); };`,
      0,
    );
  });

  it("does not report access after an unconditional awaited self-reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => { let pending = cookies(); pending = await pending; return pending.get("session"); };`,
      0,
    );
  });

  it("does not report module access after an awaited self-reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       let pending = cookies();
       pending = await pending;
       export const session = pending.get("session");`,
      0,
    );
  });

  it("reports module access after a conditional awaited reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       let pending = cookies();
       if (shouldAwait) pending = await pending;
       export const session = pending.get("session");`,
      1,
    );
  });

  it("does not report access after an unconditional unknown reassignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { let pending = cookies(); pending = getCookieStore(); return pending.get("session"); };`,
      0,
    );
  });

  it("does not report when every branch clears the pending provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (useRequestCookies) => {
         let pending = cookies();
         if (useRequestCookies) pending = await pending;
         else pending = getFallbackCookieStore();
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report when every conditional-expression branch clears pending provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (useRequestCookies) => {
         let pending = cookies();
         useRequestCookies ? (pending = await pending) : (pending = getFallbackCookieStore());
         return pending.get("session");
       };`,
      0,
    );
  });

  it("reports when only one conditional-expression branch clears pending provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (useRequestCookies) => {
         let pending = cookies();
         useRequestCookies ? (pending = await pending) : observe();
         return pending.get("session");
       };`,
      1,
    );
  });

  it("reports on an exceptional path through conditional-expression clearing writes", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         try {
           shouldUseRequestCookies() ? (pending = getRequestCookies()) : (pending = getFallbackCookieStore());
         } catch {}
         return pending.get("session");
       };`,
      1,
    );
  });

  it("reports after a possibly skipped clearing loop", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldAwait) => {
         let pending = cookies();
         while (shouldAwait) { pending = await pending; shouldAwait = false; }
         return pending.get("session");
       };`,
      1,
    );
  });

  it("does not report after a clearing loop that runs at least once", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldRepeat) => {
         let pending = cookies();
         do { pending = await pending; shouldRepeat = false; } while (shouldRepeat);
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report after a clearing write on every path that reaches the access", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldRead) => {
         let pending = cookies();
         if (!shouldRead) return null;
         pending = await pending;
         return pending.get("session");
       };`,
      0,
    );
  });

  it.each(["({ pending } = { pending: await pending });", "[pending] = [await pending];"])(
    "does not report after the destructured clearing write in %s",
    (assignment) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         ${assignment}
         return pending.get("session");
       };`,
        0,
      );
    },
  );

  it.each([
    "({ pending } = {});",
    "[pending] = [];",
    "({ pending = await pending } = {});",
    "[pending = await pending] = [];",
  ])("does not report after an absent destructured value clears pending in %s", (assignment) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         ${assignment}
         return pending?.get("session");
       };`,
      0,
    );
  });

  it("reports when an absent destructured value defaults to the pending promise", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         ({ pending = pending } = {});
         return pending.get("session");
       };`,
      1,
    );
  });

  it("reports after a conditional destructured clearing write", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldAwait) => {
         let pending = cookies();
         if (shouldAwait) ({ pending } = { pending: await pending });
         return pending.get("session");
       };`,
      1,
    );
  });

  it("reports after a destructured write that retains the pending value", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         ({ pending } = { pending });
         return pending.get("session");
       };`,
      1,
    );
  });

  it("does not preserve request-API provenance through a fresh object assignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         pending = { original: pending };
         return pending.get("session");
       };`,
      0,
    );
  });

  it.each(["use(cookies())", "React.use(cookies())"])(
    "does not report React promise unwrapping through %s",
    (expression) => {
      expectDiagnosticCount(
        `import React, { use } from "react";
         import { cookies } from "next/headers";
         export const read = () => ${expression}.get("session");`,
        0,
      );
    },
  );

  it("does not report React promise unwrapping through a binding", () => {
    expectDiagnosticCount(
      `import { use } from "react";
       import { cookies } from "next/headers";
       export const read = () => { const pending = cookies(); return use(pending).get("session"); };`,
      0,
    );
  });

  it.each(["then", "catch", "finally"])(
    "does not report direct .%s() promise handling",
    (methodName) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
         export const read = () => cookies().${methodName}(handle);`,
        0,
      );
    },
  );

  it.each([
    'cookies().catch(handle).get("session")',
    'cookies().then(handle).finally(cleanup).get("session")',
  ])("reports synchronous access after Promise settlement chaining through %s", (expression) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => ${expression};`,
      1,
    );
  });

  it("reports synchronous access through a Promise settlement-chain binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         const pending = cookies().catch(handle);
         return pending.get("session");
       };`,
      1,
    );
  });

  it.each([
    'const alias = shouldRead ? pending : getFallback(); return alias.get("session");',
    'const alias = pending ?? getFallback(); return alias.get("session");',
    'let alias; alias = pending; return alias.get("session");',
    'return (shouldRead ? pending : getFallback()).get("session");',
  ])("reports retained pending provenance through %s", (statement) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = (shouldRead) => {
         const pending = cookies();
         ${statement}
       };`,
      1,
    );
  });

  it("does not retain provenance from a non-final sequence expression", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const store = (cookies(), getFallback()); return store.get("session"); };`,
      0,
    );
  });

  it.each([
    'const store = false && cookies(); return store.get("session");',
    'const store = true || cookies(); return store.get("session");',
    'const store = true ? getFallback() : cookies(); return store.get("session");',
    'const store = cookies() && getFallback(); return store.get("session");',
    'const pending = cookies(); const store = pending && getFallback(); return store.get("session");',
  ])("does not retain unreachable or short-circuited provenance through %s", (statement) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { ${statement} };`,
      0,
    );
  });

  it.each([
    'const store = cookies() || getFallback(); return store.get("session");',
    'const store = cookies() ?? getFallback(); return store.get("session");',
  ])("retains truthy Promise provenance through %s", (statement) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { ${statement} };`,
      1,
    );
  });

  it.each(["then", "catch", "finally"])(
    "does not report computed binding access to %s",
    (methodName) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
         export const read = () => { const pending = cookies(); return pending["${methodName}"](handle); };`,
        0,
      );
    },
  );

  it("does not report a promise passed through an unknown function", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => consumePromise(cookies());`,
      0,
    );
  });

  it("does not report Promise.all unwrapping", () => {
    expectDiagnosticCount(
      `import { cookies, headers } from "next/headers";
       export const read = async () => {
         const [cookieStore, headerList] = await Promise.all([cookies(), headers()]);
         return cookieStore.get("session") ?? headerList.get("x-request-id");
       };`,
      0,
    );
  });

  it("does not report unrelated modules or request properties", () => {
    expectDiagnosticCount(
      `import { cookies } from "./local-headers";
       export const read = (request) => cookies().get("session") ?? request.cookies.get("session");`,
      0,
    );
  });

  it("does not report a local binding that shadows a named import", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const cookies = () => ({ get: () => "stub" }); return cookies().get("session"); };`,
      0,
    );
  });

  it("does not report a parameter that shadows a namespace import", () => {
    expectDiagnosticCount(
      `import * as nextHeaders from "next/headers";
       export const read = (nextHeaders) => nextHeaders.headers().get("x-request-id");`,
      0,
    );
  });

  it("does not report a dynamic namespace property", () => {
    expectDiagnosticCount(
      `import * as nextHeaders from "next/headers";
       export const read = (apiName) => nextHeaders[apiName]().get("value");`,
      0,
    );
  });

  it("does not report testlike files", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => cookies().get("session");`,
      0,
      "app/page.test.tsx",
    );
  });

  it.each(["UnsafeUnwrappedCookies", "UnsafeUnwrappedHeaders", "UnsafeUnwrappedDraftMode"])(
    "does not report the official %s compatibility cast",
    (typeName) => {
      const apiName = typeName
        .replace("UnsafeUnwrapped", "")
        .replace("Cookies", "cookies")
        .replace("Headers", "headers")
        .replace("DraftMode", "draftMode");
      expectDiagnosticCount(
        `import { ${apiName}, type ${typeName} } from "next/headers";
       export const read = () => (${apiName}() as unknown as ${typeName}).value;`,
        0,
      );
    },
  );

  it("does not report an aliased official compatibility type", () => {
    expectDiagnosticCount(
      `import { cookies, type UnsafeUnwrappedCookies as LegacyCookies } from "next/headers";
       export const read = () => (cookies() as unknown as LegacyCookies).get("session");`,
      0,
    );
  });

  it("does not report a namespace compatibility type", () => {
    expectDiagnosticCount(
      `import * as nextHeaders from "next/headers";
       export const read = () => (nextHeaders.cookies() as unknown as nextHeaders.UnsafeUnwrappedCookies).get("session");`,
      0,
    );
  });

  it("reports compatibility casts when Next.js 16 removes synchronous access", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
       export const read = () => (cookies() as unknown as UnsafeUnwrappedCookies).get("session");`,
      {
        filename: "app/page.tsx",
        settings: { "react-doctor": { capabilities: ["nextjs:15", "nextjs:16"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not report an angle-bracket compatibility cast", () => {
    expectDiagnosticCount(
      `import { headers, type UnsafeUnwrappedHeaders } from "next/headers";
       export const read = () => (<UnsafeUnwrappedHeaders><unknown>headers()).get("x-request-id");`,
      0,
      "app/request.ts",
    );
  });

  it("does not report an alias created through the compatibility cast", () => {
    expectDiagnosticCount(
      `import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
       export const read = () => {
         const pending = cookies();
         const store = pending as unknown as UnsafeUnwrappedCookies;
         return store.get("session");
       };`,
      0,
    );
  });

  it("does not report access after assigning a compatibility-cast call", () => {
    expectDiagnosticCount(
      `import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         pending = cookies() as unknown as UnsafeUnwrappedCookies;
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report access after compatibility-casting the pending binding", () => {
    expectDiagnosticCount(
      `import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         pending = pending as unknown as UnsafeUnwrappedCookies;
         return pending.get("session");
       };`,
      0,
    );
  });

  it("reports a same-named local type used as a cast", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       interface UnsafeUnwrappedCookies { get(name: string): string }
       export const read = () => (cookies() as unknown as UnsafeUnwrappedCookies).get("session");`,
      1,
    );
  });

  it("reports a nested type alias that shadows an imported compatibility type", () => {
    expectDiagnosticCount(
      `import { cookies, type UnsafeUnwrappedCookies as LegacyCookies } from "next/headers";
       export const read = () => {
         interface LegacyCookies { get(name: string): string }
         return (cookies() as unknown as LegacyCookies).get("session");
       };`,
      1,
    );
  });

  it("does not let an optional call conditionally clear pending provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (maybeConsume) => {
         let pending = cookies();
         maybeConsume?.(pending = await pending);
         return pending.get("session");
       };`,
      1,
    );
  });

  it("does not let a logical assignment conditionally clear pending provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (state) => {
         let pending = cookies();
         state.store ||= (pending = await pending);
         return pending.get("session");
       };`,
      1,
    );
  });

  it("reports when a catch path can reach access without clearing provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         try { mayThrow(); pending = await pending; } catch {}
         return pending.get("session");
       };`,
      1,
    );
  });

  it("does not report when a finally block clears provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         try { mayThrow(); } finally { pending = await pending; }
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report when a catch path always exits", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         try { mayThrow(); pending = await pending; } catch { return null; }
         return pending.get("session");
       };`,
      0,
    );
  });

  it("reports a generic cast that does not use the official escape hatch", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => (cookies() as any).get("session");`,
      1,
    );
  });

  it("reports through a satisfies wrapper", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => (cookies() satisfies Promise<unknown>).get("session");`,
      1,
    );
  });

  it("reports deferred nested reads of a stable pending binding", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const makeReader = () => { const pending = cookies(); return () => pending.get("session"); };`,
      1,
    );
  });

  it("handles a long alias chain without recursive traversal", () => {
    const aliasCount = 1_500;
    const aliasDeclarations = Array.from(
      { length: aliasCount },
      (_, aliasIndex) => `const pending${aliasIndex + 1} = pending${aliasIndex};`,
    ).join("\n");
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         const pending0 = cookies();
         ${aliasDeclarations}
         return pending${aliasCount}.get("session");
       };`,
      1,
    );
  });

  it("does not attribute an earlier read to a later request API source", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const first = pending.get("first");
         pending = cookies();
         pending = await pending;
         return first;
       };`,
      1,
    );
  });

  it("accepts a local alias of an official compatibility type", () => {
    expectDiagnosticCount(
      `import { cookies, type UnsafeUnwrappedCookies } from "next/headers";
       type LegacyCookieStore = UnsafeUnwrappedCookies;
       export const read = () => (cookies() as unknown as LegacyCookieStore).get("session");`,
      0,
    );
  });

  it("accepts a local alias of a namespace compatibility type", () => {
    expectDiagnosticCount(
      `import * as nextHeaders from "next/headers";
       type LegacyHeaderStore = nextHeaders.UnsafeUnwrappedHeaders;
       export const read = () => (nextHeaders.headers() as unknown as LegacyHeaderStore).get("x-request-id");`,
      0,
    );
  });

  it("does not trust a local type alias with an official-looking name", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       type UnsafeUnwrappedCookies = { get(name: string): string };
       export const read = () => (cookies() as unknown as UnsafeUnwrappedCookies).get("session");`,
      1,
    );
  });

  it("does not report when both the try and continuing catch paths clear provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         try { pending = await pending; }
         catch { pending = getFallbackCookieStore(); }
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report when every continuing catch branch clears provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (usePrimaryFallback) => {
         let pending = cookies();
         try { pending = await pending; }
         catch {
           if (usePrimaryFallback) pending = getPrimaryCookieStore();
           else pending = getSecondaryCookieStore();
         }
         return pending.get("session");
       };`,
      0,
    );
  });

  it("reports a catch read when the clearing assignment right side throws", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         let pending = cookies();
         try { pending = getCookieStoreOrThrow(); }
         catch { return pending.get("session"); }
       };`,
      1,
    );
  });

  it("reports a mutable pending binding read by an immediately invoked closure", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const value = (() => pending.get("session"))();
         pending = await pending;
         return value;
       };`,
      1,
    );
  });

  it("reports a mutable pending binding read by a directly called local closure", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         const value = readPending();
         pending = await pending;
         return value;
       };`,
      1,
    );
  });

  it("does not report a mutable closure that is called only after provenance clears", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         pending = await pending;
         return readPending();
       };`,
      0,
    );
  });

  it("does not report after nested branches all clear provenance", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (useRequestCookies, usePrimaryFallback) => {
         let pending = cookies();
         if (useRequestCookies) pending = await pending;
         else if (usePrimaryFallback) pending = getPrimaryCookieStore();
         else pending = getSecondaryCookieStore();
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report after a do-while body clears provenance on every branch", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (useRequestCookies) => {
         let pending = cookies();
         do {
           if (useRequestCookies) pending = await pending;
           else pending = getFallbackCookieStore();
         } while (false);
         return pending.get("session");
       };`,
      0,
    );
  });

  it("does not report after a do-while body clears before a possible continue", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldContinue) => {
         let pending = cookies();
         do {
           pending = await pending;
           if (shouldContinue) continue;
         } while (false);
         return pending.get("session");
       };`,
      0,
    );
  });

  it.each([
    'const store = ({ get: (name) => name }) || cookies(); return store.get("session");',
    "const store = [] || cookies(); return store.length;",
    "const store = `ready` || cookies(); return store.length;",
    "const store = `ready-${value}` || cookies(); return store.length;",
    "const store = !1 && cookies(); return store.valueOf();",
    "const store = !!null ?? cookies(); return store.valueOf();",
    "const store = Infinity || cookies(); return store.valueOf();",
  ])("does not retain a request API from a statically unreachable branch in %s", (statement) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { ${statement} };`,
      0,
    );
  });

  it.each(["new Headers(headers())", "new URLSearchParams(headers())"])(
    "reports synchronous iterable construction through %s",
    (expression) => {
      expectDiagnosticCount(
        `import { headers } from "next/headers";
         export const read = () => ${expression};`,
        1,
      );
    },
  );

  it("reports a mutable pending binding read by a directly invoked closure alias", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         const readAlias = readPending;
         const value = readAlias();
         pending = await pending;
         return value;
       };`,
      1,
    );
  });

  it("does not report a closure alias invoked only after provenance clears", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         const readAlias = readPending;
         pending = await pending;
         return readAlias();
       };`,
      0,
    );
  });

  it("does not report a closure alias overwritten before invocation", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         let readAlias = readPending;
         readAlias = () => null;
         readAlias();
         pending = await pending;
       };`,
      0,
    );
  });

  it("reports a closure alias invoked before it is overwritten", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         let readAlias = readPending;
         readAlias();
         readAlias = () => null;
         pending = await pending;
       };`,
      1,
    );
  });

  it("reports a closure alias that is only conditionally overwritten before invocation", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldReplace) => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         let readAlias = readPending;
         if (shouldReplace) readAlias = () => null;
         readAlias();
         pending = await pending;
       };`,
      1,
    );
  });

  it("does not report a closure alias overwritten on the only branch that invokes it", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (shouldCall) => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         let readAlias = readPending;
         if (shouldCall) {
           readAlias = () => null;
           readAlias();
         }
         pending = await pending;
       };`,
      0,
    );
  });

  it.each(["[0].map(() => pending.get('session'))", "new Promise(() => pending.get('session'))"])(
    "reports a mutable pending binding read by the synchronous callback in %s",
    (expression) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const value = ${expression};
         pending = await pending;
         return value;
       };`,
        1,
      );
    },
  );

  it.each([
    "[0].map(readPending)",
    "Array.of(0).map(readPending)",
    "new Array(0, 1).map(readPending)",
    "new Promise(readPending)",
  ])("reports a named synchronous callback passed through %s", (expression) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
         export const read = async () => {
           let pending = cookies();
           const readPending = () => pending.get("session");
           const value = ${expression};
           pending = await pending;
           return value;
         };`,
      1,
    );
  });

  it("reports a named callback on an immutable array alias", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const values = [0];
         const readPending = () => pending.get("session");
         const result = values.map(readPending);
         pending = await pending;
         return result;
       };`,
      1,
    );
  });

  it("reports a named callback on an immutable global Array call alias", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async () => {
         let pending = cookies();
         const values = Array.of(0);
         const readPending = () => pending.get("session");
         const result = values.map(readPending);
         pending = await pending;
         return result;
       };`,
      1,
    );
  });

  it.each(["A(1).map(readPending)", "new A(1).map(readPending)"])(
    "reports a named callback through an immutable global Array constructor alias in %s",
    (invocation) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
         export const read = async () => {
           let pending = cookies();
           const A = Array;
           const readPending = () => pending.get("session");
           const result = ${invocation};
           pending = await pending;
           return result;
         };`,
        1,
      );
    },
  );

  it.each([
    "let values = [0]; values.map(readPending);",
    "const values = scheduler.values; values.map(readPending);",
    "const values = [0]; values.map = scheduler.map; values.map(readPending);",
    "const Array = scheduler.Array; Array.of(0).map(readPending);",
    "const Array = scheduler.Array; Array(1).map(readPending);",
    "const Array = scheduler.Array; new Array(1).map(readPending);",
    "const A = scheduler.Array; A(1).map(readPending);",
    "let A = Array; A(1).map(readPending);",
  ])("fails closed for an unproven synchronous callback host through %s", (invocation) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (scheduler) => {
         let pending = cookies();
         const readPending = () => pending.get("session");
         ${invocation}
         pending = await pending;
       };`,
      0,
    );
  });

  it("does not treat an arbitrary receiver's map callback as synchronously invoked", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (scheduler) => {
         let pending = cookies();
         scheduler.map(() => pending.get("session"));
         pending = await pending;
         scheduler.flush();
       };`,
      0,
    );
  });

  it.each([
    "while (true)",
    "while (1)",
    'while ("run")',
    "while (1n)",
    "while (!false)",
    "for (;;)",
  ])("recognizes provenance clearing before a break from %s", (loopHeader) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
         export const read = async () => {
           let pending = cookies();
           ${loopHeader} {
             pending = await pending;
             break;
           }
           return pending.get("session");
         };`,
      0,
    );
  });

  it.each(["then", "catch", "finally"])(
    "does not report a Promise settlement method selected through const %s",
    (methodName) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
         const settleMethod = "${methodName}";
         export const read = () => cookies()[settleMethod](handle);`,
        0,
      );
    },
  );

  it.each([
    'Reflect.get(pending, "get")',
    'Reflect.getOwnPropertyDescriptor(pending, "get")',
    'Reflect.has(pending, "get")',
    'Object.getOwnPropertyDescriptor(pending, "get")',
    '"get" in pending',
  ])("reports reflective property access through %s", (expression) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         const pending = cookies();
         return ${expression};
       };`,
      1,
    );
  });

  it.each([
    'Reflect.get(pending, "then")',
    'Reflect.getOwnPropertyDescriptor(pending, "catch")',
    'Reflect.has(pending, "finally")',
    'Object.getOwnPropertyDescriptor(pending, "then")',
  ])("does not report reflective Promise settlement access through %s", (expression) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pending = cookies(); return ${expression}; };`,
      0,
    );
  });

  it.each(["!pending", "typeof pending"])(
    "does not report non-consuming unary access through %s",
    (expression) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
         export const read = () => { const pending = cookies(); return ${expression}; };`,
        0,
      );
    },
  );

  it.each([
    `import { cookies } from "next/headers";
     const readCookies = cookies;
     export const read = () => readCookies().get("session");`,
    `import * as nextHeaders from "next/headers";
     const requestHeaders = nextHeaders;
     export const read = () => requestHeaders.headers().get("x-request-id");`,
    `import * as nextHeaders from "next/headers";
     const readCookies = nextHeaders.cookies;
     export const read = () => readCookies().get("session");`,
    `import * as nextHeaders from "next/headers";
     const key = "cookies";
     const readCookies = nextHeaders[key];
     export const read = () => readCookies().get("session");`,
    `import * as nextHeaders from "next/headers";
     const { headers: readHeaders } = nextHeaders;
     export const read = () => readHeaders().get("x-request-id");`,
    `import { draftMode } from "next/headers";
     const readDraftMode = () => draftMode();
     export const read = () => readDraftMode().isEnabled;`,
  ])("reports bounded aliases and wrappers of next/headers APIs", (code) => {
    expectDiagnosticCount(code, 1);
  });

  it.each(["let pending; pending ??= cookies();", "const { pending } = { pending: cookies() };"])(
    "reports pending values introduced through %s",
    (declaration) => {
      expectDiagnosticCount(
        `import { cookies } from "next/headers";
       export const read = () => {
         ${declaration}
         return pending.get("session");
       };`,
        1,
      );
    },
  );

  it.each([
    {
      code: `export default function Page({ params }) { return params.slug; }`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { return props.searchParams.query; }`,
      filename: "src/app/search/page.tsx",
    },
    {
      code: `export default function Page(props) { const routeProps = props; return routeProps.params.slug; }`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { const { params: routeParams } = props; return routeParams.slug; }`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Page({ params: { slug } }) { return slug; }`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Layout({ params: routeParams }) { return routeParams.team; }`,
      filename: "app/[team]/layout.tsx",
    },
    {
      code: `export const GET = (request, { params }) => Response.json({ slug: params.slug });`,
      filename: "app/api/[slug]/route.ts",
    },
    {
      code: `export const generateMetadata = ({ searchParams }) => ({ title: searchParams.query });`,
      filename: "app/search/page.tsx",
    },
    {
      code: `export const generateViewport = ({ params }) => ({ themeColor: params.theme });`,
      filename: "app/[theme]/layout.tsx",
    },
    {
      code: `export default function Default({ params }) { return params.slug; }`,
      filename: "app/blog/[slug]/default.tsx",
    },
  ])("reports synchronous official async request props in $filename", ({ code, filename }) => {
    expectDiagnosticCount(code, 1, filename);
  });

  it.each(["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])(
    "reports route params in the %s handler context",
    (methodName) => {
      expectDiagnosticCount(
        `export const ${methodName} = (request, context) => Response.json(context.params.slug);`,
        1,
        "app/api/[slug]/route.ts",
      );
    },
  );

  it.each([
    `const Page = ({ params }) => params.slug; export { Page as default };`,
    `const Page = ({ params }) => params.slug; const Exported = Page; export default Exported;`,
    `export default function Page({ ["params"]: routeParams }) { return routeParams.slug; }`,
    `export const generateMetadata = ({ params }) => ({ title: params.slug });`,
    `export const generateViewport = ({ searchParams }) => ({ colorScheme: searchParams.scheme });`,
  ])("reports official async props through supported export and pattern forms", (code) => {
    expectDiagnosticCount(code, 1, "app/[slug]/page.tsx");
  });

  it.each([
    `export default function Page({ params }) { return { ...params }; }`,
    `export default function Page({ params }) { return Object.keys(params); }`,
    `export default function Page({ params }) { const { slug } = params; return slug; }`,
    `export default function Page({ ...props }) { return props.params.slug; }`,
    `export default function Page(props) { const { ...routeProps } = props; return routeProps.params.slug; }`,
  ])("reports official async props through synchronous consumption forms", (code) => {
    expectDiagnosticCount(code, 1, "app/[slug]/page.tsx");
  });

  it.each([
    `export default function Page({ params, ...props }) { return props.searchParams.query; }`,
    `export default function Page({ searchParams, ...props }) { return props.params.slug; }`,
    `export default function Page(props) { const { params, ...rest } = props; return rest.searchParams.query; }`,
    `export default function Page(props) { let rest; ({ params, ...rest } = props); return rest.searchParams.query; }`,
  ])("reports official props that remain in an object rest binding", (code) => {
    expectDiagnosticCount(code, 1, "app/[slug]/page.tsx");
  });

  it("reports a nested consumed prop and a separate prop retained by object rest", () => {
    expectDiagnosticCount(
      `export default function Page(props) { const { params: { slug }, ...rest } = props; return slug + rest.searchParams.query; }`,
      2,
      "app/[slug]/page.tsx",
    );
  });

  it.each([
    {
      code: `export default function Page({ params, ...props }) { return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page({ params, searchParams, ...props }) { return props.params?.slug ?? props.searchParams?.query; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { const { params, ...rest } = props; return rest.params.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { let rest; ({ params, ...rest } = props); return rest.params.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { const { params: routeParams = fallback, ...rest } = props; return rest.params.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { const { ["params"]: routeParams, ...rest } = props; return rest.params.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { const { [propertyName]: consumed, ...rest } = props; return rest.params.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Layout({ params, ...props }) { return props.params.slug; }`,
      filename: "app/[slug]/layout.tsx",
    },
    {
      code: `export default function Default({ params, ...props }) { return props.params.slug; }`,
      filename: "app/[slug]/default.tsx",
    },
    {
      code: `export const GET = (request, { params, ...context }) => Response.json(context.params.slug);`,
      filename: "app/api/[slug]/route.ts",
    },
  ])(
    "does not report official props removed from an object rest binding in $filename",
    ({ code, filename }) => {
      expectDiagnosticCount(code, 0, filename);
    },
  );

  it("does not add a rest diagnostic for a nested prop removed from object rest", () => {
    expectDiagnosticCount(
      `export default function Page(props) { const { params: { slug }, ...rest } = props; return slug + rest.params.slug; }`,
      1,
      "app/[slug]/page.tsx",
    );
  });

  it.each(["params", "id"])("reports metadata image %s in Next.js 16", (propertyName) => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `export default function Image({ ${propertyName} }) { return new ImageResponse(${propertyName}.value); }`,
      {
        filename: "app/blog/[slug]/opengraph-image.tsx",
        settings: { "react-doctor": { capabilities: ["nextjs:15", "nextjs:16"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      code: `export default function Image({ id }) { return new ImageResponse(String(id * 50000)); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return <div>{id}</div>; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return new ImageResponse(String(id)); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { const imageId = id; return new ImageResponse(String(imageId * 50000)); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return id ? 1 : 0; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { if (id) return 1; return 0; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { while (id) break; return 0; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return id && 1; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { switch (id) { case 1: return 1; default: return 0; } }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return values[id]; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return (null?.foo)[id]; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return (undefined?.foo)[id]; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return (null?.foo).bar[id]; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return (false && {})?.[id]; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return (null?.foo)(id + 1); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return { [id]: true }; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return "value" in id; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return parseInt(id, 10); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return parseFloat(id); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return isNaN(id); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return isFinite(id); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return encodeURIComponent(id); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { return JSON.stringify(id); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: "export default function Image({ id }) { return String.raw`/${id}`; }",
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: "const raw = String.raw; export default function Image({ id }) { return raw`/${id}`; }",
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { id++; return null; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Image({ id }) { id += 1; return null; }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export default function Sitemap({ id }) { return [{ url: String(id * 50000) }]; }`,
      filename: "app/sitemap.ts",
    },
    {
      code: "export default function Sitemap({ id }) { return [{ url: `/product/${id}` }]; }",
      filename: "app/sitemap.ts",
    },
  ])("reports direct Next.js 16 id consumption in $filename", ({ code, filename }) => {
    const result = runRule(nextjsAsyncDynamicApiNotAwaited, code, {
      filename,
      settings: { "react-doctor": { capabilities: ["nextjs:15", "nextjs:16"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    `export default async function Image({ id }) { const imageId = await id; return new ImageResponse(String(imageId * 50000)); }`,
    `import { use } from "react"; export default function Image({ id }) { const imageId = use(id); return new ImageResponse(String(imageId * 50000)); }`,
    `export default function Image({ id }) { return id; }`,
    `export default function Image({ id }) { return { id }; }`,
    `export default function Image({ id }) { return [id]; }`,
    `export default function Image({ id }) { return consume(id); }`,
    `export default function Image({ id }) { return Promise.resolve(id); }`,
    "export default function Image({ id }) { return consume`/${id}`; }",
    `export default function Image({ id }) { return null?.[id]; }`,
    `export default function Image({ id }) { return undefined?.[id]; }`,
    `export default function Image({ id }) { return (void 0)?.[id]; }`,
    `export default function Image({ id }) { return null?.foo[id]; }`,
    `export default function Image({ id }) { return null?.foo.bar[id]; }`,
    `export default function Image({ id }) { return null?.foo?.[id]; }`,
    `export default function Image({ id }) { return undefined?.foo?.[id]; }`,
    `export default function Image({ id }) { return (null?.foo)?.[id]; }`,
    `export default function Image({ id }) { return (null?.foo)?.bar[id]; }`,
    `export default function Image({ id }) { return (true ? null : {})?.[id]; }`,
    `export default function Image({ id }) { return (false ? {} : undefined)?.[id]; }`,
    `export default function Image({ id }) { return (null ?? undefined)?.[id]; }`,
    `export default function Image({ id }) { return (null || undefined)?.[id]; }`,
    `export default function Image({ id }) { return (0, null)?.[id]; }`,
    `export default function Image({ id }) { let value; return (value = null)?.[id]; }`,
    `export default function Image({ id }) { return null?.(id + 1); }`,
    `export default function Image({ id }) { return null?.foo(id + 1); }`,
    `export default function Image({ id }) { return null?.foo?.(id + 1); }`,
    `export default function Image({ id }) { return (null?.foo)?.(id + 1); }`,
    `export default function Image({ id }) { return false && values[id]; }`,
    `export default function Image({ id }) { return true ? null : values[id]; }`,
    `export default function Image({ id }) { const parseInt = consume; return parseInt(id); }`,
    "export default function Image({ id }) { const String = consume; return String.raw`/${id}`; }",
    "let raw = String.raw; export default function Image({ id }) { return raw`/${id}`; }",
    `export default function Image({ id }) { return id.then((imageId) => imageId * 50000); }`,
  ])("does not report safe or propagating Next.js 16 id usage", (code) => {
    const result = runRule(nextjsAsyncDynamicApiNotAwaited, code, {
      filename: "app/blog/[slug]/opengraph-image.tsx",
      settings: { "react-doctor": { capabilities: ["nextjs:15", "nextjs:16"] } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      code: `export default async function Page(props) { props.params = await props.params; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page({ ...props }) { props.params = await props.params; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page(props) { const alias = props; alias.params = await alias.params; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page(props) { const alias = props; alias.params = await alias.params; return alias.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page(props, other) { props.params = await other.params; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `import { use } from "react"; export default function Page(props, other) { props.params = use(other.params); return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default function Page(props) { props.params = { slug: "local" }; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page(props) { try { props.params = await props.params; } catch { props.params = { slug: "fallback" }; } return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page(props) { props.searchParams = await props.searchParams; return props.searchParams.query; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `import { cookies } from "next/headers"; export default async function Page(props) { let pending = cookies(); pending = await pending; props.params = pending; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Page(props) { let pending = props.params; pending = await pending; props.params = pending; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); pending = { slug: "safe" }; props.params = pending; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `import { cookies } from "next/headers"; export default async function Page(props) { let pending = { slug: "safe" }; pending = cookies(); pending = await pending; props.params = pending; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `import { cookies } from "next/headers"; export default function Page(props) { let other = { slug: "safe" }; let pending = other; other = cookies(); props.params = pending; return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `import { use } from "react"; export default function Page(props) { props.params = use(props.params); return props.params.slug; }`,
      filename: "app/[slug]/page.tsx",
      capabilities: ["nextjs:15"],
    },
    {
      code: `export default async function Image(props) { props.id = await props.id; return new ImageResponse(String(props.id * 50000)); }`,
      filename: "app/[slug]/opengraph-image.tsx",
      capabilities: ["nextjs:15", "nextjs:16"],
    },
  ])(
    "does not report an official prop after unconditional self-unwrapping",
    ({ code, filename, capabilities }) => {
      const result = runRule(nextjsAsyncDynamicApiNotAwaited, code, {
        filename,
        settings: { "react-doctor": { capabilities } },
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    },
  );

  it.each([
    `export default async function Page(props, shouldAwait) { if (shouldAwait) props.params = await props.params; return props.params.slug; }`,
    `export default async function Page(props) { props.searchParams = await props.searchParams; return props.params.slug; }`,
    `export default function Page(props, condition) { props.params = condition ? props.params : { slug: "fallback" }; return props.params.slug; }`,
    `export default function Page(props) { props.params = props.params || fallback; return props.params.slug; }`,
    `export default function Page(props) { props.params = props.params ?? fallback; return props.params.slug; }`,
    `export default function Page(props) { props.params = (observe(), props.params); return props.params.slug; }`,
    `export default function Page(props) { const pending = props.params; props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { const pending = cookies(); props.params = pending; return props.params.slug; }`,
    `export default function Page(props) { let pending = props.params; props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, condition) { let pending = cookies(); if (condition) pending = { slug: "fallback" }; props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default async function Page(props) { let pending = cookies(); pending = await pending; pending = cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = { slug: "safe" }; pending = cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default async function Page(props, condition) { let pending = cookies(); pending = await pending; if (condition) pending = cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default async function Page(props) { let { params: pending } = props; pending = await pending; pending = cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending; pending ??= cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = null; pending ||= cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = { slug: "safe" }; pending &&= cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let other = { slug: "safe" }; let pending = other; other = cookies(); pending = other; props.params = pending; return props.params.slug; }`,
    `export default function Page(props) { const { params: pending } = props; props.params = pending; return props.params.slug; }`,
    `export default function Page(props) { const alias = props; const { params: pending } = alias; props.params = pending; return props.params.slug; }`,
    `export default function Page(props) { props.params = props.searchParams; return props.params.slug; }`,
    `export default async function Page(props) { try { props.params = await props.params; } catch {} return props.params.slug; }`,
    `export default async function Page(props, shouldFallback) { try { props.params = await props.params; } catch { if (shouldFallback) props.params = { slug: "fallback" }; } return props.params.slug; }`,
  ])("reports an official prop without unconditional matching self-unwrapping %#", (code) => {
    expectDiagnosticCount(code, 1, "app/[slug]/page.tsx");
  });

  it("reports a compound official prop write and clears the following read", () => {
    expectDiagnosticCount(
      `export default function Page(props) { props.params += fallback; return props.params.slug; }`,
      1,
      "app/[slug]/page.tsx",
    );
  });

  it.each(["||=", "??="])(
    "reports a retaining %s official prop write and the following read",
    (operator) => {
      expectDiagnosticCount(
        `export default function Page(props) { props.params ${operator} fallback; return props.params.slug; }`,
        2,
        "app/[slug]/page.tsx",
      );
    },
  );

  it("reports an &&= official prop write and clears the following read", () => {
    expectDiagnosticCount(
      `export default function Page(props) { props.params &&= fallback; return props.params.slug; }`,
      1,
      "app/[slug]/page.tsx",
    );
  });

  it.each([
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; if (false) pending = cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; false && (pending = cookies()); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; true || (pending = cookies()); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; false ? (pending = cookies()) : 0; props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; pending ||= cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = { slug: "safe" }; pending ??= cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = null; pending &&= cookies(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = () => { pending = cookies(); }; props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default async function Page(props) { let pending = cookies(); const clear = async () => { pending = await pending; }; await clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default async function Page(props) { let pending = cookies(); await (async () => { pending = await pending; })(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const update = () => { pending = cookies(); pending = {}; }; update(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = () => { return; pending = cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = async () => { await 0; pending = cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = () => { pending = cookies(); }; if (false) taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = async () => { if (false) await 0; pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = async () => { if (true) await 0; pending = cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = () => { pending = {}; throw new Error(); }; try { clear(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0].map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); new Promise(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldThrow) { let pending = cookies(); const clear = () => { if (shouldThrow) throw new Error(); pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = () => { try { throw new Error(); } catch {} pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = () => { try { throw new Error(); } finally { pending = {}; } }; try { clear(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, condition) { let pending = cookies(); const clear = () => { if (condition) pending = {}; else pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `export default function Page(props, condition) { const clear = () => { if (condition) props.params = {}; else props.params = {}; }; clear(); return props.params.slug; }`,
    `export default function Page(props, condition) { const read = () => { if (condition) props.params = { slug: "first" }; else props.params = { slug: "second" }; return props.params.slug; }; return read(); }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = async () => { while (false) await 0; pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = async () => { for (; false; ) await 0; pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [...[]].map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [0].reduce(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [0].sort(() => { pending = cookies(); return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = []; values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.of().map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.from([], () => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = [0]; values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array.of(0).map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array.from([0], () => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [undefined].map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array.of(undefined).map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0].reduce(() => { pending = {}; return 0; }, 0); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0, 1].reduce(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0, 1].sort(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0, 1].toSorted(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array.from([,], () => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, first, second) { let pending = cookies(); const clear = () => { if (first) { if (second) pending = {}; else pending = {}; } else pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `export default function Page(props, first, second) { const read = () => { if (first) { if (second) props.params = {}; else props.params = {}; } else props.params = {}; return props.params.slug; }; return read(); }`,
    `import { cookies } from "next/headers"; export default function Page(props, condition) { let pending = cookies(); try { throw new Error(); } catch { if (condition) pending = {}; else pending = {}; } props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, condition) { let pending = {}; const update = () => { pending = cookies(); throw new Error(); }; try { update(); } catch { if (condition) pending = {}; else pending = {}; } props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [..."💩"].reduce(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.from("💩").reduce(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [..."ab"].reduce(() => { pending = {}; return ""; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = [0]; if (false) values.pop(); values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = [0]; false && values.pop(); values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = [0]; const mutate = () => values.pop(); values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = []; if (false) values.push(0); values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = [0]; values.pop(); values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = []; values.length = 1; values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = []; values.push(0); values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const noop = () => {}; const clear = () => { noop(); pending = {}; }; try { clear(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const update = () => { pending = cookies(); pending = {}; throw new Error(); }; try { update(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const update = () => { pending = cookies(); pending = {}; }; if (false) { try { update(); } catch {} } update(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldThrow) { let pending = {}; const update = () => { pending = cookies(); if (shouldThrow) throw new Error(); pending = {}; }; try { update(); } catch { return null; } props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldThrow) { let pending = {}; const update = () => { pending = cookies(); if (shouldThrow) throw new Error(); pending = {}; }; try { update(); } catch { throw new Error(); } props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldThrow) { let pending = {}; const update = () => { pending = cookies(); if (shouldThrow) throw new Error(); pending = {}; }; try { update(); } catch { pending = {}; } props.params = pending; return props.params.slug; }`,
  ])("ignores unreachable taint and honors invoked clearing %#", (code) => {
    expectDiagnosticCount(code, 0, "app/[slug]/page.tsx");
  });

  it.each([
    `import { cookies } from "next/headers"; export default function Page(props) { let first = cookies(); let second = first; first = second; props.params = first; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = () => { pending = cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; (() => { pending = cookies(); })(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const update = () => { pending = {}; pending = cookies(); }; update(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const taint = async () => { pending = cookies(); await 0; }; taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default async function Page(props) { let pending = {}; const taint = async () => { await 0; pending = cookies(); }; await taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldWait) { let pending = {}; const taint = async () => { if (shouldWait) await 0; pending = cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldThrow) { let pending = {}; const update = () => { pending = cookies(); if (shouldThrow) throw new Error(); pending = {}; }; try { update(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [0].map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; new Promise(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [...[]].map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0].reduce(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0].sort(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
    `export default function Page(props) { const read = () => { try { props.params = getSafeOrThrow(); } catch {} return props.params.slug; }; return read(); }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = []; values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array.of().map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array.from([], () => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = [0]; values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.of(0).map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.from([0], () => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { useMemo } from "react"; import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; useMemo(() => { pending = cookies(); }, []); props.params = pending; return props.params.slug; }`,
    `import { useState } from "react"; import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; useState(() => { pending = cookies(); return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [,].map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); Array(1).map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [undefined].map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.of(undefined).map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [].reduce(() => { pending = {}; return 0; }, 0); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0, undefined].sort(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [0, undefined].toSorted(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; Array.from([,], () => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = []; values.push(0); values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = [0]; values.pop(); values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const values = [0]; values.length = 0; values.map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const values = []; values[0] = 0; values.map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = () => { mayThrow(); pending = {}; }; try { clear(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const update = () => { pending = cookies(); mayThrow(); pending = {}; }; try { update(); } catch {} props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [..."💩"].reduce(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [..."💩"].sort(() => { pending = {}; return 0; }); props.params = pending; return props.params.slug; }`,
  ])("retains reachable aliases and invoked taint %#", (code) => {
    expectDiagnosticCount(code, 1, "app/[slug]/page.tsx");
  });

  it.each(["||=", "??="])("reports pending local %s retention and the later read", (operator) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers"; export const read = () => { let pending = cookies(); pending ${operator} { get: () => "safe" }; return pending.get("x"); };`,
      2,
    );
  });

  it("reports pending local &&= consumption and clears the later read", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers"; export const read = () => { let pending = cookies(); pending &&= { get: () => "safe" }; return pending.get("x"); };`,
      1,
    );
  });

  it("reports pending local &&= unwrapping and clears the later read", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers"; export const read = async () => { let pending = cookies(); pending &&= await pending; return pending.get("x"); };`,
      1,
    );
  });

  it.each([
    `import { cookies } from "next/headers"; export const read = () => { let pending = { get: () => "safe" }; if (false) pending = cookies(); return pending.get("x"); };`,
    `import { cookies } from "next/headers"; export const read = () => { let pending = { get: () => "safe" }; false && (pending = cookies()); return pending.get("x"); };`,
    `import { cookies } from "next/headers"; export const read = () => { let pending = { get: () => "safe" }; pending ||= cookies(); return pending.get("x"); };`,
    `import { cookies } from "next/headers"; export const read = () => { let pending = { get: () => "safe" }; pending ??= cookies(); return pending.get("x"); };`,
    `import { cookies } from "next/headers"; export const read = () => { let pending = null; pending &&= cookies(); return pending?.get("x"); };`,
  ])("ignores a statically skipped local taint", (code) => {
    expectDiagnosticCount(code, 0);
  });

  it.each([
    `import { cookies } from "next/headers"; export default function Page(props, shouldClear) { let pending = cookies(); const clear = () => { if (shouldClear) pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = () => { return; pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); const clear = async () => { await 0; pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldWait) { let pending = cookies(); const clear = async () => { if (shouldWait) await 0; pending = {}; }; clear(); props.params = pending; return props.params.slug; }`,
  ])("retains pending state when an invoked clear is not guaranteed before return %#", (code) => {
    expectDiagnosticCount(code, 1, "app/[slug]/page.tsx");
  });

  it("accepts an official prop cleared by a directly invoked closure", () => {
    expectDiagnosticCount(
      `export default function Page(props) { const read = () => { props.params = { slug: "safe" }; return props.params.slug; }; return read(); }`,
      0,
      "app/[slug]/page.tsx",
    );
  });

  it.each([
    `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; const outer = () => { const taint = () => { pending = cookies(); }; taint(); pending = {}; }; outer(); props.params = pending; return props.params.slug; }`,
    `import { cookies } from "next/headers"; export default function Page(props, shouldThrow) { let pending = {}; const update = () => { pending = cookies(); if (shouldThrow) throw new Error(); pending = {}; }; update(); props.params = pending; return props.params.slug; }`,
  ])("tracks ordered effects through directly invoked closures %#", (code) => {
    expectDiagnosticCount(code, 0, "app/[slug]/page.tsx");
  });

  it("uses the call-site value for a captured logical assignment", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers"; export default function Page(props) { let pending = null; pending = {}; const taint = () => { pending ??= cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
      0,
      "app/[slug]/page.tsx",
    );
  });

  it("taints from a captured logical assignment enabled at the call site", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; pending = null; const taint = () => { pending ??= cookies(); }; taint(); props.params = pending; return props.params.slug; }`,
      1,
      "app/[slug]/page.tsx",
    );
  });

  it.each([
    [`&&=`, 1],
    [`||=`, 2],
  ])("reports invoked pending local %s consumption", (operator, count) => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers"; export const read = () => { let pending = cookies(); const update = () => { pending ${operator} { get: () => "safe" }; }; update(); return pending.get("x"); };`,
      count,
    );
  });

  it.each([
    [
      `import { cookies } from "next/headers"; export default function Page(props) { let pending = cookies(); [].map(() => { pending = {}; }); props.params = pending; return props.params.slug; }`,
      1,
    ],
    [
      `import { cookies } from "next/headers"; export default function Page(props) { let pending = {}; [].map(() => { pending = cookies(); }); props.params = pending; return props.params.slug; }`,
      0,
    ],
  ])("does not project effects from a callback that may never run", (code, count) => {
    expectDiagnosticCount(code, count, "app/[slug]/page.tsx");
  });

  it("accepts self-unwrapping in a try when the catch cannot reach the read", () => {
    expectDiagnosticCount(
      `export default async function Page(props) { try { props.params = await props.params; } catch { throw new Error("failed"); } return props.params.slug; }`,
      0,
      "app/[slug]/page.tsx",
    );
  });

  it("reports sitemap id in Next.js 16", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `export default function Sitemap({ id }) { return [{ url: id.value }]; }`,
      {
        filename: "app/sitemap.ts",
        settings: { "react-doctor": { capabilities: ["nextjs:15", "nextjs:16"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it.each([
    {
      code: `export default function Sitemap({ id }) { return [{ url: id.value }]; }`,
      capabilities: ["nextjs:15"],
    },
    {
      code: `export const generateSitemaps = ({ id }) => [{ id: id.value }];`,
      capabilities: ["nextjs:15", "nextjs:16"],
    },
  ])("does not report a synchronous sitemap producer", ({ code, capabilities }) => {
    const result = runRule(nextjsAsyncDynamicApiNotAwaited, code, {
      filename: "app/sitemap.ts",
      settings: { "react-doctor": { capabilities } },
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not report generateImageMetadata in Next.js 16", () => {
    const result = runRule(
      nextjsAsyncDynamicApiNotAwaited,
      `export const generateImageMetadata = ({ params, id }) => [{ id: params.slug + id.value }];`,
      {
        filename: "app/blog/[slug]/opengraph-image.tsx",
        settings: { "react-doctor": { capabilities: ["nextjs:15", "nextjs:16"] } },
      },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it.each([
    {
      code: `export default async function Page({ params }) { const route = await params; return route.slug; }`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `import { use } from "react"; export default function Page({ searchParams }) { return use(searchParams).query; }`,
      filename: "app/search/page.tsx",
    },
    {
      code: `import { use as unwrap } from "react"; export default function Page({ params }) { return unwrap(params).slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page({ params }) { return params.then((route) => route.slug); }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export const helper = ({ params }) => params.slug;`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `function Page({ params }) { return params.slug; } export { Page };`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Card({ params }) { return params.slug; }`,
      filename: "src/components/page.tsx",
    },
    {
      code: `export default function Layout({ searchParams }) { return searchParams.query; }`,
      filename: "app/layout.tsx",
    },
    {
      code: `export default function Loading({ params }) { return params.slug; }`,
      filename: "app/loading.tsx",
    },
    {
      code: `export default function Template({ params }) { return params.slug; }`,
      filename: "app/template.tsx",
    },
    {
      code: `export default function LegacyPage({ params }) { return params.slug; }`,
      filename: "pages/page.tsx",
    },
    {
      code: `export default withPage(function Page({ params }) { return params.slug; });`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Page(props) { return props[propertyName].slug; }`,
      filename: "app/blog/[slug]/page.tsx",
    },
    {
      code: `export default function Route(request) { return request.params.slug; }`,
      filename: "app/api/[slug]/route.ts",
    },
    {
      code: `export const handler = (request, { params }) => params.slug;`,
      filename: "app/api/[slug]/route.ts",
    },
    {
      code: `export default function Route(request, { params }) { return params.slug; }`,
      filename: "app/api/[slug]/route.ts",
    },
    {
      code: `export const generateStaticParams = ({ params }) => [{ slug: params.slug }];`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page({ [propertyName]: routeParams }) { return routeParams.slug; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Page({ params }) { return <div />; }`,
      filename: "app/[slug]/page.tsx",
    },
    {
      code: `export default function Image({ params }) { return new ImageResponse(params.slug); }`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export const generateImageMetadata = ({ params }) => [{ id: params.slug }];`,
      filename: "app/blog/[slug]/opengraph-image.tsx",
    },
    {
      code: `export async function Page({ params }) { params = await params; return params.slug; } export default Page;`,
      filename: "app/blog/[slug]/page.tsx",
    },
  ])("does not report safe or non-contract request props in $filename", ({ code, filename }) => {
    expectDiagnosticCount(code, 0, filename);
  });

  it("reports request props after only a conditional await", () => {
    expectDiagnosticCount(
      `export async function Page({ params }, shouldAwait) {
         if (shouldAwait) params = await params;
         return params.slug;
       }
       export default Page;`,
      1,
      "app/blog/[slug]/page.tsx",
    );
  });

  it("handles a deeply nested logical source without recursive traversal", () => {
    const logicalBranchCount = 1_200;
    const pendingExpression = `cookies()${" || getFallbackCookieStore()".repeat(logicalBranchCount)}`;
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         const pending = ${pendingExpression};
         return pending.get("session");
       };`,
      1,
    );
  });

  it("handles a deeply nested logical alias without recursive traversal", () => {
    const logicalBranchCount = 1_200;
    const pendingExpression = `pending${" || getFallbackCookieStore()".repeat(logicalBranchCount)}`;
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => {
         const pending = cookies();
         const alias = ${pendingExpression};
         return alias.get("session");
       };`,
      1,
    );
  });

  it("analyzes many reconverging branches without path explosion", () => {
    const branchCount = 40;
    const reconvergingBranches = Array.from(
      { length: branchCount },
      (_, branchIndex) =>
        `if (flags[${branchIndex}]) observe(${branchIndex}); else observe(-${branchIndex});`,
    ).join("\n");
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = async (flags) => {
         let pending = cookies();
         pending = await pending;
         ${reconvergingBranches}
         return pending.get("session");
       };`,
      0,
    );
  });

  it("declares the Next.js 15 capability gate", () => {
    expect(nextjsAsyncDynamicApiNotAwaited.requires).toEqual(["nextjs:15"]);
  });
});
