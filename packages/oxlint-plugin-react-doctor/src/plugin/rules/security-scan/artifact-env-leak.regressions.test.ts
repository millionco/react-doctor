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

  it("stays silent on Prisma 7 generated TypeScript client with env refs in JSDoc (#1318)", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "src/generated/prisma/internal/class.ts",
      content: `/**
 * ## Example
 * 
 * \`\`\`ts
 * const prisma = new PrismaClient({
 *   adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL })
 * })
 * \`\`\`
 */
export class PrismaClient {
}
${"a".repeat(60000)}`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("stays silent on any TypeScript source file marked as generated bundle", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "src/__generated__/schema.tsx",
      content: `export const schema = { dbUrl: process.env.DATABASE_URL };`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });
});
