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
}`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags executable env access in generated TypeScript source", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "src/__generated__/schema.tsx",
      content: `export const schema = { dbUrl: process.env.DATABASE_URL };`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(1);
  });

  it.each(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"])(
    "ignores env access that exists only in a %s comment",
    (extension) => {
      const findings = runScanRule(artifactEnvLeak, {
        relativePath: `dist/generated/client.${extension}`,
        content: `const client = {};
// process.env.DATABASE_URL
/* import.meta.env.SESSION_SECRET */`,
        isGeneratedBundle: true,
      });
      expect(findings).toHaveLength(0);
    },
  );

  it("preserves source offsets when a comment precedes executable env access", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "src/generated/client.ts",
      content: `/* process.env.DATABASE_URL */
export const databaseUrl = process.env.DATABASE_URL;`,
      isGeneratedBundle: true,
    });
    expect(findings).toEqual([
      expect.objectContaining({
        line: 2,
        column: 40,
      }),
    ]);
  });

  it("does not combine executable context with a secret name that exists only in a comment", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "src/generated/client.ts",
      content: `const environment = process.env;
// DATABASE_URL`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("does not combine a commented context with an executable secret-name string", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "src/generated/client.ts",
      content: `// process.env
export const environmentName = "DATABASE_URL";`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("keeps conservative raw matching when generated source cannot be parsed", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.ts",
      content: `process.env.DATABASE_URL ???`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(1);
  });

  it("keeps conservative raw matching for comment-trivia access when parsing fails", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.ts",
      content: `process/* keep */.env.DATABASE_URL ???`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(1);
  });

  it("ignores env access that exists only in a hashbang", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content: `#!/usr/bin/env -S node process.env.DATABASE_URL
export const client = {};`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it.each([
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
  ])("keeps executable env access after a hashbang %s", (_label, separator) => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content: `#!/usr/bin/env node${separator}export const databaseUrl = process.env.DATABASE_URL;`,
      isGeneratedBundle: true,
    });
    expect(findings).toEqual([
      expect.objectContaining({
        line: 2,
        column: 40,
      }),
    ]);
  });

  it.each([
    ["line separator", "\u2028"],
    ["paragraph separator", "\u2029"],
  ])("ignores hashbang-only env access before a %s", (_label, separator) => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content: `#!/usr/bin/env node process.env.DATABASE_URL${separator}export const client = {};`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it.each([
    ["opening", `<!-- process.env.DATABASE_URL\nvar client = {};`],
    ["closing", `var client = {};\n  --> process.env.DATABASE_URL\nclient.ready = true;`],
  ])("ignores env access inside an Annex-B HTML %s comment", (_label, content) => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("keeps executable env access live next to a postfix decrement comparison", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content: `var isPositive = value-->0;\nvar databaseUrl = process.env.DATABASE_URL;`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(1);
  });

  it.each([
    "process/* keep */.env.DATABASE_URL",
    "process./* keep */env.DATABASE_URL",
    "process// keep\n.env.DATABASE_URL",
    "import/* keep */.meta.env.DATABASE_URL",
    "import./* keep */meta.env.DATABASE_URL",
    "process . env.DATABASE_URL",
    "import . meta . env.DATABASE_URL",
  ])("keeps executable env access live across JavaScript trivia: %s", (expression) => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content: `export const databaseUrl = ${expression};`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(1);
  });

  it.each(["process/* keep */.env.DATABASE_URL", "import/* keep */.meta.env.DATABASE_URL"])(
    "ignores comment-only trivia-separated env examples: %s",
    (expression) => {
      const findings = runScanRule(artifactEnvLeak, {
        relativePath: "src/generated/client.ts",
        content: `// Example: ${expression}\nexport const client = {};`,
        isGeneratedBundle: true,
      });
      expect(findings).toHaveLength(0);
    },
  );

  it("does not turn unrelated context and secret-name tokens into a finding", () => {
    const findings = runScanRule(artifactEnvLeak, {
      relativePath: "dist/generated/client.js",
      content: `export const processName = "process";\nexport const keyName = "DATABASE_URL";`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });
});
