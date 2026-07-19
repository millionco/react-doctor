import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { mdxSsrExecutionRisk } from "./mdx-ssr-execution-risk.js";

describe("security-scan/mdx-ssr-execution-risk — regressions", () => {
  it("stays silent on page.evaluate / webpack compile shapes without MDX", () => {
    const findings = runScanRule(mdxSsrExecutionRisk, {
      relativePath: "src/server/render-preview.ts",
      content: `const html = await page.evaluate(() => document.body.outerHTML);\nconst compiled = compiler.compile(entrySource);\nawait cache.set(cacheKey, compiled);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags server-side MDX compilation of tenant content", () => {
    const findings = runScanRule(mdxSsrExecutionRisk, {
      relativePath: "src/app/docs/page.tsx",
      content: `import { compileMDX } from "next-mdx-remote/rsc";\n\nconst { content } = await compileMDX({ source: tenantDocumentSource });\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent on docs sites rendering their own MDX content", () => {
    const findings = runScanRule(mdxSsrExecutionRisk, {
      relativePath: "components/mdx-content/index.tsx",
      content: `import { MDXRemote } from "next-mdx-remote/rsc";\nimport MDXComponents from "../mdx-components";\n\nexport const MDXContent = ({ children }: { children: string }) => (\n  <MDXRemote source={children} components={MDXComponents} />\n);\n`,
    });
    expect(findings).toHaveLength(0);
  });

  it("flags MDX rendering with raw HTML enabled", () => {
    const findings = runScanRule(mdxSsrExecutionRisk, {
      relativePath: "components/mdx-content/index.tsx",
      content: `import { MDXRemote } from "next-mdx-remote/rsc";\n\nexport const MDXContent = ({ children }) => (\n  <MDXRemote source={children} options={{ mdxOptions: { rehypePlugins: [rehypeRaw] } }} />\n);\n`,
    });
    expect(findings).toHaveLength(1);
  });

  it("stays silent when an unrelated reporter identifier follows the MDX import", () => {
    const findings = runScanRule(mdxSsrExecutionRisk, {
      relativePath: "packages/node-loader/lib/index.js",
      content: `import { createFormatAwareProcessors } from "@mdx-js/mdx/internal-create-format-aware-processors";
import { reporter } from "vfile-reporter";

export const load = async (url) => reporter(await createFormatAwareProcessors().process(url));
`,
    });
    expect(findings).toHaveLength(0);
  });
});
