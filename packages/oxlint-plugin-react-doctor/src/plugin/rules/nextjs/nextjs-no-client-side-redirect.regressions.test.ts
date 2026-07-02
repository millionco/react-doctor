import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoClientSideRedirect } from "./nextjs-no-client-side-redirect.js";

describe("nextjs/nextjs-no-client-side-redirect — regressions", () => {
  it("stays silent on router.push inside an event handler registered in the effect", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const button = document.getElementById("go");
    const onClick = () => { router.push("/next"); };
    button.addEventListener("click", onClick);
    return () => button.removeEventListener("click", onClick);
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a direct router.push on mount", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => { router.push("/x"); }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a synchronously-invoked inner function that redirects on mount", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const go = () => { router.push("/next"); };
    go();
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags an async IIFE auth-guard redirect on mount", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    (async () => {
      const session = await fetch("/api/session").then((response) => response.json());
      if (!session.user) router.push("/login");
    })();
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("flags a redirect inside a promise .then() rooted in the effect body", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    checkAuth().then((isAuthed) => {
      if (!isAuthed) router.push("/login");
    });
  }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a direct location.href assignment on mount", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => { location.href = "/x"; }, []);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("stays silent on a keydown handler that redirects, with a cleanup return", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    const onKey = (event) => { if (event.key === "Escape") router.push("/home"); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a redirect inside the returned cleanup function", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function Page() {
  const router = useRouter();
  useEffect(() => {
    return () => { router.push("/goodbye"); };
  }, [router]);
  return null;
}`,
      { filename: "app/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });
});
