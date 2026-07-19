import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const mdxSsrExecutionRisk = defineRule({
  id: "mdx-ssr-execution-risk",
  title: "Server-rendered MDX can execute code",
  severity: "warn",
  recommendation:
    "Use a constrained compiler for untrusted content, disable expressions/raw HTML, sandbox renderers, and avoid caching attacker-controlled output across tenants.",
  // Bare `evaluate`/`compile` triggers match webpack compiles, page.evaluate,
  // moduleRef.compile, etc. — the trigger must name an MDX library surface.
  // Generic words (content/source/body/mdx) match every docs site rendering
  // its own MDX; require an untrusted-shaped source or a dangerous flag.
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    pattern:
      /(?:@mdx-js\/mdx|next-mdx-remote|\b(?:MDXRemote|compileMDX|evaluateMdx)\b)[\s\S]{0,700}\b(?:repo\b|customer|tenant|user[-_]?(?:content|markdown|mdx|input|provided|generated|submitted)|untrusted|searchParams|req\.|request\.|fetch\s*\(|prisma\.|db\.|database|rehypeRaw|allowDangerousHtml)/i,
    message:
      "MDX/markdown rendering code may evaluate user or repository content during SSR or static generation.",
  }),
});
