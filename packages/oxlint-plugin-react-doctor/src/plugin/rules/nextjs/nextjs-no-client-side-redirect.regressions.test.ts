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

  it("stays silent on same-page canonicalization via { pathname: router.pathname }", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `import { useEffect } from "react";
import { useRouter } from "next/router";
export default function SourcesList({ sources }) {
  const router = useRouter();
  useEffect(() => {
    if (!router.isReady) return;
    const { source: _omit, ...rest } = router.query;
    void router.replace(
      { pathname: router.pathname, query: rest, hash: "sources" },
      undefined,
      { shallow: true },
    );
  }, [router, sources]);
  return null;
}`,
      { filename: "src/components/SourcesList.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent when the destination variable is built from the current pathname", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function StatusPane({ orderId }) {
  const router = useRouter();
  useEffect(() => {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.has("statusToken")) {
      currentUrl.searchParams.delete("statusToken");
      const nextSearch = currentUrl.searchParams.toString();
      const nextUrl = nextSearch
        ? \`\${currentUrl.pathname}?\${nextSearch}\`
        : currentUrl.pathname;
      router.replace(nextUrl, { scroll: false });
    }
  }, [router, orderId]);
  return null;
}`,
      { filename: "app/checkout/success/StatusPane.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a literal redirect to the page's own route (param cleanup)", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
export default function ContactsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    const contactId = searchParams.get("contact");
    if (contactId) selectContact(contactId);
    router.replace("/contacts");
  }, [searchParams, router]);
  return null;
}`,
      { filename: "app/(main)/[locale]/contacts/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on a redirect inside a setTimeout-rescheduled polling loop", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function ReturnStatus({ orderId }) {
  const router = useRouter();
  useEffect(() => {
    let timer;
    let cancelled = false;
    const poll = async () => {
      const status = await fetchStatus(orderId);
      if (cancelled) return;
      if (status.paymentStatus === "paid") {
        router.replace(\`/shop/checkout/success?orderId=\${orderId}\`);
        return;
      }
      timer = setTimeout(poll, 2000);
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [orderId, router]);
  return null;
}`,
      { filename: "app/checkout/return/ReturnStatus.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a literal redirect to a different route from a page file", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
export default function SetupPage() {
  const router = useRouter();
  useEffect(() => {
    checkSetup().then((done) => {
      if (done) router.replace("/");
    });
  }, [router]);
  return null;
}`,
      { filename: "app/setup/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags a redirect that merely passes the current path as a query param", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `import { useEffect } from "react";
import { useRouter } from "next/router";
export default function GuardedPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace({ pathname: "/login", query: { from: router.asPath } });
  }, [router]);
  return null;
}`,
      { filename: "pages/settings.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
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
