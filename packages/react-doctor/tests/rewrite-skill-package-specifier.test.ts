import { describe, expect, it } from "vite-plus/test";
import { rewriteSkillPackageSpecifier } from "../src/cli/utils/rewrite-skill-package-specifier.js";

const PREVIEW = "https://pkg.pr.new/react-doctor@abc1234";

describe("rewriteSkillPackageSpecifier", () => {
  it("rewrites the @latest form to the preview specifier", () => {
    expect(rewriteSkillPackageSpecifier("npx react-doctor@latest mcp", PREVIEW)).toBe(
      `npx ${PREVIEW} mcp`,
    );
  });

  it("rewrites bare npx invocations, including subcommands and end of line", () => {
    expect(
      rewriteSkillPackageSpecifier("npx react-doctor browser open http://localhost:3000", PREVIEW),
    ).toBe(`npx ${PREVIEW} browser open http://localhost:3000`);
    expect(rewriteSkillPackageSpecifier("run `npx react-doctor`", PREVIEW)).toBe(
      `run \`npx ${PREVIEW}\``,
    );
  });

  it("does not double-rewrite the URL it produced", () => {
    const once = rewriteSkillPackageSpecifier("npx react-doctor@latest mcp", PREVIEW);
    expect(rewriteSkillPackageSpecifier(once, PREVIEW)).toBe(once);
  });

  it("leaves prose mentions of the command name untouched", () => {
    const prose = "The bundled `react-doctor browser` command attaches to Chrome.";
    expect(rewriteSkillPackageSpecifier(prose, PREVIEW)).toBe(prose);
  });
});
