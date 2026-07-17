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

  it("does not report an empty or rest-only Promise destructure", () => {
    expectDiagnosticCount(
      `import { cookies } from "next/headers";
       export const read = () => { const pending = cookies(); const { ...ownProperties } = pending; return ownProperties; };`,
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

  it("declares the Next.js 15 capability gate", () => {
    expect(nextjsAsyncDynamicApiNotAwaited.requires).toEqual(["nextjs:15"]);
  });
});
