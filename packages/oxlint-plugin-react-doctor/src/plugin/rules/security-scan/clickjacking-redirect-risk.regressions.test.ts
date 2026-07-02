import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { clickjackingRedirectRisk } from "./clickjacking-redirect-risk.js";

describe("security-scan/clickjacking-redirect-risk — regressions", () => {
  it("stays silent when redirect keywords only appear inside string literals", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "app/login/page.tsx",
      content: `return redirect('/login?message=Check email to continue sign in process');\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when the redirect target passes through a safe-redirect helper", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "packages/app-store/zoomvideo/api/callback.ts",
      content: `res.redirect(\n  getSafeRedirectUrl(state?.returnTo) ?? getInstalledAppPath({ variant: "conferencing" })\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when iframe-adjacent comments mention redirects", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "src/scenes/sites/Site.tsx",
      content: `return (\n  <iframe\n    className="Site"\n    title="Site preview"\n    src={launchUrl(decodedUrl)}\n    // allow-same-origin is important here, because otherwise redirect_to_site cannot work\n    sandbox="allow-scripts allow-same-origin"\n  />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags redirects fed directly from search params", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "src/redirect.ts",
      content: `export const GET = (request) => redirect(request.nextUrl.searchParams.get("next"));\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags redirects of a bare next identifier", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "app/auth/confirm/route.ts",
      content: `const next = searchParams.get('next') ?? '/';\nredirect(next);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags wildcard frame-ancestors policies", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "next.config.mjs",
      content: `const csp = "frame-ancestors *";\n`,
    });
    expect(findings).toHaveLength(1);
  });

  // FP wave 4: the ARIA `role` attribute on an iframe is not a redirect
  // query param. `role=` only matters in a URL-query position (`?role=`).
  it("stays silent on an ARIA role attribute on an iframe", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "src/app.tsx",
      content: `export const F = ({ url }) => <iframe role="presentation" src={url} title="x" />;`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a role= query param in an iframe src", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "src/app.tsx",
      content: `export const F = () => <iframe src="/embed?role=admin" />;`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  // FN wave 5: the `\b` before `[?&]role=` demanded a word char before the
  // `?`, so concat-built role URLs (quote precedes `?`) were missed.
  it("flags a concat-built ?role= iframe src", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "src/app.tsx",
      content: `export const F = ({ base, r }) => <iframe src={base + "?role=" + r} />;`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("flags an entity-encoded &amp;role= in an HTML-string iframe src", () => {
    const findings = runScanRule(clickjackingRedirectRisk, {
      relativePath: "src/app.tsx",
      content: `export const html = '<iframe src="/embed?tab=1&amp;role=admin"></iframe>';`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
