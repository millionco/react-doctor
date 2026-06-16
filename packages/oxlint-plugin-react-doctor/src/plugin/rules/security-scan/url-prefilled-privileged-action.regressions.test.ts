import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { urlPrefilledPrivilegedAction } from "./url-prefilled-privileged-action.js";

describe("security-scan/url-prefilled-privileged-action — regressions", () => {
  it("stays silent when searchParams merely coexists with next/* imports and user words", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/app/bookings/page.tsx",
      content: `import { useSearchParams } from "next/navigation";\nimport { useUser } from "@/hooks/use-user";\n\nexport default function Page({ searchParams }: PageProps) {\n  return buildMetadata(searchParams);\n}\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags reading a privileged role parameter from the URL", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/app/invite/page.tsx",
      content: `const searchParams = useSearchParams();\nconst invitedRole = searchParams.get("role");\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("flags a privileged property read off Next.js searchParams", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/app/team/page.tsx",
      content: `export default function Page({ searchParams }: PageProps) {\n  prefillInvite(searchParams.userstoinvite);\n  return null;\n}\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when the read is wrapped in a validating helper (posthog getRelativeNextPath shape)", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/scenes/organization/confirmOrganizationLogic.ts",
      content: `const nextUrl = getRelativeNextPath(new URLSearchParams(location.search).get('next'), location);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when a member-access read is wrapped in an infix-named validator (resolveSafe…)", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/app/login/page.tsx",
      content: `url.searchParams.set("callbackURL",\n  resolveSafeAuthCallbackURL(url.searchParams.get("callbackURL")));\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent when an aliased sanitiz*-named validator wraps a member-access read", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/app/login/page.tsx",
      content: `import { resolveSafeAuthCallbackURL as sanitizeAuthCallbackURL } from "~/lib/auth-callback";\nconst safe = sanitizeAuthCallbackURL(url.searchParams.get("callbackURL"));\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags an unvalidated callbackUrl read passed through a non-validating call", () => {
    const findings = runScanRule(urlPrefilledPrivilegedAction, {
      relativePath: "src/app/login/page.tsx",
      content: `const callback = decodeURIComponent(url.searchParams.get("callbackUrl"));\n`,
    });
    expect(findings).toHaveLength(1);
  });
});
