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

  it("still flags a router.push on mount when the `router` receiver is wrapped in `as any`", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `"use client";
import { useEffect } from "react";
export default function Page() {
  useEffect(() => { (router as any).push("/x"); }, []);
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

  it("stays silent for browser-owned completion input, control, and dynamic saved destination", () => {
    const fixtures = [
      {
        filename: "app/oauth/callback/page.tsx",
        source: `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce_verifier");
  exchange(verifier).then((success) => {
    if (success) router.replace("/inbox");
  });
}, []);`,
      },
      {
        filename: "app/auth/callback/page.tsx",
        source: `useEffect(() => {
  let resume = false;
  resume = sessionStorage.getItem("resume") === "1";
  if (resume && state) {
    (async () => {
      const response = await complete(state);
      if (!response.ok) return;
      router.push("/settings");
    })();
  }
}, []);`,
      },
      {
        filename: "app/oauth/callback/page.tsx",
        source: `useEffect(() => {
  complete(code).then((success) => {
    if (success) {
      let destination = "/";
      try {
        const saved = sessionStorage.getItem("after_login");
        if (saved) destination = saved;
      } catch {}
      router.push(destination);
    }
  });
}, []);`,
      },
      {
        filename: "pages/oauth/callback/index.tsx",
        source: `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce_verifier");
  exchange(verifier).then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
      },
    ];

    for (const fixture of fixtures) {
      const result = runRule(nextjsNoClientSideRedirect, fixture.source, {
        filename: fixture.filename,
      });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics, fixture.source).toEqual([]);
    }
  });

  it("stays silent for the three authentic Bulwark callback branches", () => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `import { toRouterPath } from "@/lib/browser-navigation";
useEffect(() => {
  let pairReauthResume = false;
  try {
    pairReauthResume = sessionStorage.getItem("pair_reauth_resume") === "1";
  } catch {}
  if (pairReauthResume && state) {
    (async () => {
      const response = await apiFetch("/api/auth/reauth/sso/complete", {
        body: JSON.stringify({ code, state }),
      });
      if (!response.ok) return;
      router.push(toRouterPath("/settings"));
    })();
    return;
  }

  const savedState = sessionStorage.getItem("oauth_state");
  if (savedState) {
    const codeVerifier = sessionStorage.getItem("oauth_code_verifier");
    const serverUrl = sessionStorage.getItem("oauth_server_url");
    loginWithOAuth(serverUrl, code, codeVerifier)
      .then((success) => {
        if (success) {
          let redirectTo = "/";
          try {
            const saved = sessionStorage.getItem("redirect_after_login");
            if (saved) {
              sessionStorage.removeItem("redirect_after_login");
              redirectTo = saved;
            }
          } catch {}
          router.push(toRouterPath(redirectTo));
        }
      })
      .catch(handleError);
  } else if (state) {
    loginWithServerSso(code, state)
      .then((success) => {
        if (success) {
          let redirectTo = "/";
          try {
            const saved = sessionStorage.getItem("redirect_after_login");
            if (saved) {
              sessionStorage.removeItem("redirect_after_login");
              redirectTo = saved;
            }
          } catch {}
          router.push(toRouterPath(redirectTo));
        }
      })
      .catch(handleError);
  }
}, []);`,
      { filename: "app/(main)/[locale]/auth/callback/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it.each([
    ["missing marker", 'sessionStorage.getItem("resume") === null'],
    ["inverted marker", 'sessionStorage.getItem("resume") !== "1"'],
    ["string coercion", 'sessionStorage.getItem("resume") + ""'],
    ["two missing keys", 'sessionStorage.getItem("resume") === sessionStorage.getItem("other")'],
    ["relational comparison", 'sessionStorage.getItem("resume") > ""'],
  ])("reports a false-initialized control using $0", (_label, markerExpression) => {
    const result = runRule(
      nextjsNoClientSideRedirect,
      `useEffect(() => {
  let resume = false;
  resume = ${markerExpression};
  if (resume && state) {
    (async () => {
      const response = await complete(state);
      if (!response.ok) return;
      router.push("/settings");
    })();
  }
}, []);`,
      { filename: "app/auth/callback/page.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it.each([
    [
      "an unrelated toRouterPath import",
      `import { toRouterPath } from "other-navigation";
useEffect(() => {
  complete(code).then((success) => {
    if (success) {
      let destination = "/";
      try {
        const saved = sessionStorage.getItem("after");
        if (saved) destination = saved;
      } catch {}
      router.push(toRouterPath(destination));
    }
  });
}, []);`,
    ],
    [
      "a locally shadowed toRouterPath import",
      `import { toRouterPath } from "@/lib/browser-navigation";
useEffect(() => {
  complete(code).then((success) => {
    if (success) {
      const toRouterPath = (value) => value;
      let destination = "/";
      try {
        const saved = sessionStorage.getItem("after");
        if (saved) destination = saved;
      } catch {}
      router.push(toRouterPath(destination));
    }
  });
}, []);`,
    ],
    [
      "an arbitrary statement before the saved override",
      `useEffect(() => {
  complete(code).then((success) => {
    if (success) {
      let destination = "/";
      try {
        const saved = sessionStorage.getItem("after");
        if (saved) {
          mightThrow();
          destination = saved;
        }
      } catch {}
      router.push(destination);
    }
  });
}, []);`,
    ],
    [
      "cleanup for a different storage key",
      `useEffect(() => {
  complete(code).then((success) => {
    if (success) {
      let destination = "/";
      try {
        const saved = sessionStorage.getItem("after");
        if (saved) {
          sessionStorage.removeItem("different");
          destination = saved;
        }
      } catch {}
      router.push(destination);
    }
  });
}, []);`,
    ],
  ])("reports $0", (_label, source) => {
    const result = runRule(nextjsNoClientSideRedirect, source, {
      filename: "app/auth/callback/page.tsx",
    });
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("preserves findings for dead, dormant, or possibly skipped storage writes", () => {
    const fixtureGroups = [
      {
        label: "required storage input and result gating",
        sources: [
          `useEffect(() => { router.replace("/inbox"); }, []);`,
          `useEffect(() => {
  fetch("/api/session").then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  const verifier = condition ? sessionStorage.getItem("pkce") : serverToken;
  exchange(verifier).then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  exchange((sessionStorage.getItem("ignored"), serverToken)).then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  exchange(void sessionStorage.getItem("ignored")).then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  fetch("/api/session").then((response) => {
    if (response.ok) {
      router.replace((sessionStorage.getItem("ignored"), "/inbox"));
    }
  });
}, []);`,
          `const sessionStorage = { getItem: () => "fake" };
useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).catch(() => ({ ok: true })).then((response) => {
    if (response.ok) router.replace("/failed");
  });
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  (async () => {
    const response = await exchange(verifier).catch(() => ({ ok: true }));
    if (response.ok) router.replace("/failed");
  })();
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    response.ok++;
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    mutate(response);
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    Object.assign(response, { ok: true });
    if (response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    if (true || response.ok) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    if ((response, true)) router.replace("/inbox");
  });
}, []);`,
          `useEffect(() => {
  complete(code).then((response) => {
    if (response.ok) router.replace(false && sessionStorage.getItem("after"));
  });
}, []);`,
        ],
      },
      {
        label: "saved destination override",
        sources: [
          `useEffect(() => {
  let destination = "/";
  const readLater = () => { destination = sessionStorage.getItem("after"); };
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  if (condition) destination = sessionStorage.getItem("after");
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  while (false) destination = sessionStorage.getItem("after");
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  for (; false;) destination = sessionStorage.getItem("after");
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  switch (kind) {
    case "saved": destination = sessionStorage.getItem("after");
  }
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try { completePreparation(); }
  catch { destination = sessionStorage.getItem("after"); }
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    mightThrow();
    destination = sessionStorage.getItem("after");
  } catch {}
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    const prior = mightThrow(), saved = sessionStorage.getItem("after");
    if (saved) destination = saved;
  } catch {}
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    const saved = sessionStorage.getItem("after");
    if (saved) {
      while (false) destination = saved;
    }
  } catch {}
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    const saved = sessionStorage.getItem("after");
    if (saved) {
      destination = saved;
    }
  } catch {}
  complete(code).then((response) => {
    if (response.ok) router.replace((destination, "/fixed"));
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    const saved = sessionStorage.getItem("after");
    if (saved) destination = saved;
  } catch {}
  destination = "/fixed";
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    const saved = sessionStorage.getItem("after");
    if (saved) {
      throw error;
      destination = saved;
    }
  } catch {}
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
          `useEffect(() => {
  let destination = "/";
  try {
    const saved = sessionStorage.getItem("after");
    if (saved) {
      if (condition) destination = saved;
    }
  } catch {}
  complete(code).then((response) => {
    if (response.ok) router.replace(destination);
  });
}, []);`,
        ],
      },
      {
        label: "false-initialized storage control",
        sources: [
          `useEffect(() => {
  if (false && sessionStorage.getItem("resume")) {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  let resume = false;
  if (false) resume = sessionStorage.getItem("resume");
  if (resume) {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  const resume = sessionStorage.getItem("resume");
  if (resume || true) {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  const resume = sessionStorage.getItem("resume");
  if (!resume) {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  const resume = sessionStorage.getItem("resume");
  if (resume) {} else {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  const resume = sessionStorage.getItem("resume");
  if (resume || state) {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  const resume = sessionStorage.getItem("resume");
  if (resume === false) {
    (async () => {
      const response = await complete();
      if (response.ok) router.replace("/inbox");
    })();
  }
}, []);`,
          `useEffect(() => {
  const resume = sessionStorage.getItem("resume");
  if (!resume) return;
  (async () => {
    const response = await complete();
    if (response.ok) router.replace("/inbox");
  })();
}, []);`,
          `useEffect(() => {
  fetch("/api/session").then((response) => {
    if (response.ok) router.replace("/inbox", { state: sessionStorage.getItem("x") });
  });
}, []);`,
        ],
      },
    ];

    for (const fixtureGroup of fixtureGroups) {
      for (const source of fixtureGroup.sources) {
        const result = runRule(nextjsNoClientSideRedirect, source, {
          filename: "app/oauth/callback/page.tsx",
        });
        expect(result.parseErrors, fixtureGroup.label).toEqual([]);
        expect(result.diagnostics, `${fixtureGroup.label}: ${source}`).toHaveLength(1);
      }
    }
  });

  it("preserves findings outside an actual callback route entry", () => {
    const source = `useEffect(() => {
  const verifier = sessionStorage.getItem("pkce");
  exchange(verifier).then((response) => {
    if (response.ok) router.replace("/inbox");
  });
}, []);`;
    for (const filename of [
      "src/callback/component.tsx",
      "app/oauth/callback/layout.tsx",
      "app/oauth/callback/details/page.tsx",
    ]) {
      const result = runRule(nextjsNoClientSideRedirect, source, { filename });
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    }
  });
});
