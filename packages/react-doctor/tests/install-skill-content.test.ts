import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// HACK: the website's /install-skill/route.ts inlines SKILL.md and AGENTS.md
// content as TS template literals (it can't fs.readFileSync canonical files
// at runtime on Vercel deploys without bundling tweaks). This test guards
// that the embedded content stays in sync with the canonical
// skills/react-doctor/{SKILL,AGENTS}.md.

const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const ROUTE_PATH = path.join(REPO_ROOT, "packages/website/src/app/install-skill/route.ts");
const SKILL_MD_PATH = path.join(REPO_ROOT, "skills/react-doctor/SKILL.md");
const AGENTS_MD_PATH = path.join(REPO_ROOT, "skills/react-doctor/AGENTS.md");

const extractEmbeddedContent = (routeFileText: string, variableName: string): string => {
  const headerPattern = new RegExp(`const\\s+${variableName}\\s*=\\s*\``, "m");
  const startMatch = routeFileText.match(headerPattern);
  if (!startMatch || startMatch.index === undefined) {
    throw new Error(`Could not locate const ${variableName} in route.ts`);
  }
  const literalStart = startMatch.index + startMatch[0].length;
  const literalEnd = routeFileText.indexOf("`;", literalStart);
  if (literalEnd === -1) {
    throw new Error(`Could not locate end of ${variableName} template literal`);
  }
  // Reverse the TS template-literal escaping so we can compare against the
  // raw markdown file. We only handle the escape sequences route.ts uses:
  //   \\\` → \`  (preserves the existing "literal backslash + backtick"
  //              encoding that the install script writes verbatim into the
  //              installed SKILL.md / AGENTS.md files).
  // The downstream "mangled markdown" issue is pre-existing and out of
  // scope for this drift test — we just make sure the two embedded copies
  // match the canonical markdown source.
  return routeFileText
    .slice(literalStart, literalEnd)
    .replaceAll("\\\\\\`", "\\`")
    .replaceAll("\\${", "${")
    .replaceAll("\\\\", "\\");
};

const normalizeMarkdown = (text: string): string => text.replaceAll("`", "\\`").trimEnd();

describe("install-skill route content sync", () => {
  it("SKILL_MD_CONTENT in route.ts matches skills/react-doctor/SKILL.md", () => {
    const routeText = readFileSync(ROUTE_PATH, "utf-8");
    const embedded = extractEmbeddedContent(routeText, "SKILL_MD_CONTENT").trim();
    const canonical = normalizeMarkdown(readFileSync(SKILL_MD_PATH, "utf-8"));
    expect(embedded).toBe(canonical);
  });

  it("AGENTS_MD_CONTENT in route.ts matches skills/react-doctor/AGENTS.md", () => {
    const routeText = readFileSync(ROUTE_PATH, "utf-8");
    const embedded = extractEmbeddedContent(routeText, "AGENTS_MD_CONTENT").trim();
    const canonical = normalizeMarkdown(readFileSync(AGENTS_MD_PATH, "utf-8"));
    expect(embedded).toBe(canonical);
  });
});
