import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { artifactEnvLeak } from "./artifact-env-leak.js";

describe("security-scan/artifact-env-leak — regressions", () => {
  it("flags secret env names inside a browser artifact", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/assets/index-abc123.js",
      content: `const config = { key: "NEXT_PUBLIC_SERVICE_ROLE_SECRET" };`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on generated API-reference markdown (medusa TypeList shape)", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "www/apps/resources/references/types/CommonTypes/page.mdx",
      content: `<TypeList types={[{"name":"NEXT_PUBLIC_SERVICE_ROLE_SECRET","type":"string","description":"..."}]} />`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on Next.js dev server source maps under .next/dev/server", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: ".next/dev/server/chunks/[root-of-the-server]__auth.js.map",
      content: `{"sources":["webpack://better-auth/env.ts"],"sourcesContent":["const url = process.env.DATABASE_URL;"]}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags the same env dump shape in a browser static chunk", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: ".next/static/chunks/main-app.js.map",
      content: `{"sourcesContent":["const url = process.env.DATABASE_URL;"]}`,
    });
    expect(findings).toHaveLength(1);
  });
});
