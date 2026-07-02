import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoRedirectInTryCatch } from "./nextjs-no-redirect-in-try-catch.js";

describe("nextjs/nextjs-no-redirect-in-try-catch — regressions", () => {
  it("stays silent on redirect() called from the catch block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    await mutate();
  } catch (e) {
    redirect("/login");
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags redirect() inside the try block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    redirect("/login");
  } catch (e) {
    log(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on redirect() inside a deferred handler in the try block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default function Page() {
  try {
    return <button onClick={() => redirect("/login")}>Go</button>;
  } catch (e) {
    return null;
  }
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the catch re-throws the control-flow error", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    await save();
    redirect("/done");
  } catch (e) {
    if (isRedirectError(e)) throw e;
    console.error(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // Bugbot: a catch that throws a FRESH error still swallows the redirect's
  // control-flow error — only re-throwing the caught binding forwards it.
  it("still flags a catch that throws a new error instead of re-throwing", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    await save();
    redirect("/done");
  } catch (e) {
    console.error(e);
    throw new Error("save failed");
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  // fp-review probe A: the inner catch re-throws, but the OUTER catch
  // swallows the forwarded control-flow error — the redirect still fails.
  it("still flags a nested try whose inner catch rethrows into an outer swallowing catch", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    try {
      await save();
      redirect("/done");
    } catch (e) {
      throw e;
    }
  } catch (outer) {
    console.error(outer);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a nested try when every catch on the path rethrows", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    try {
      redirect("/done");
    } catch (e) {
      throw e;
    }
  } catch (outer) {
    throw outer;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review probe B: an IIFE executes synchronously inside the try, so
  // the catch still swallows the redirect's control-flow error.
  it("still flags redirect() inside an IIFE invoked within the try block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    (() => { redirect("/done"); })();
  } catch (e) {
    console.error(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on redirect() inside a deferred setTimeout callback in the try block", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default function Page() {
  try {
    setTimeout(() => { redirect("/done"); }, 1000);
  } catch (e) {
    console.error(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review probe D: the rethrow inside the catch is itself wrapped in a
  // try whose own catch swallows it, so the redirect error never escapes.
  it("still flags when the catch's rethrow is swallowed by a nested try/catch", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    redirect("/done");
  } catch (e) {
    try {
      throw e;
    } catch (inner) {
      console.error(inner);
    }
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent when the catch's nested rethrow is forwarded by the inner catch too", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
export default async function Page() {
  try {
    redirect("/done");
  } catch (e) {
    try {
      throw e;
    } catch (inner) {
      throw inner;
    }
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  // fp-review probe C: INTENDED IMPRECISION — any conditional rethrow of the
  // caught binding suppresses, even when its condition can never match the
  // redirect error; static condition analysis is out of scope.
  it("stays silent on a conditional rethrow unrelated to the redirect error (documented heuristic)", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `import { redirect } from "next/navigation";
class DbError extends Error {}
export default async function Page() {
  try {
    await save();
    redirect("/done");
  } catch (e) {
    if (e instanceof DbError) throw e;
    return null;
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a local redirect function that shadows next/navigation", () => {
    const result = runRule(
      nextjsNoRedirectInTryCatch,
      `export default function Page() {
  const redirect = (url) => { window.location.href = url; };
  try {
    redirect("/done");
  } catch (e) {
    console.error(e);
  }
}`,
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
