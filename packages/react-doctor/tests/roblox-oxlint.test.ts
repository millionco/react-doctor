import path from "node:path";
import { describe, expect, it } from "vitest";
import { runOxlint } from "../src/utils/run-oxlint.js";
import { discoverProject } from "../src/utils/discover-project.js";

const FIXTURES_DIRECTORY = path.resolve(import.meta.dirname, "fixtures");

const getRuleNames = (diagnostics: Awaited<ReturnType<typeof runOxlint>>): Set<string> =>
  new Set(diagnostics.map((diagnostic) => `${diagnostic.plugin}/${diagnostic.rule}`));

describe("roblox-ts lint profile", () => {
  it("suppresses react/no-unknown-property in roblox-ts mode while keeping core rules", async () => {
    const fixtureDirectory = path.join(FIXTURES_DIRECTORY, "roblox-react-web-noise");
    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.framework).toBe("roblox-ts");

    const unknownFrameworkDiagnostics = await runOxlint(fixtureDirectory, true, "unknown", false);
    const unknownFrameworkRuleNames = getRuleNames(unknownFrameworkDiagnostics);
    expect(unknownFrameworkRuleNames.has("react/no-unknown-property")).toBe(true);

    const diagnostics = await runOxlint(
      fixtureDirectory,
      projectInfo.hasTypeScript,
      projectInfo.framework,
      projectInfo.hasReactCompiler,
    );
    const diagnosticRuleNames = getRuleNames(diagnostics);

    expect(diagnosticRuleNames.has("react/no-unknown-property")).toBe(false);
    expect(diagnosticRuleNames.has("react-doctor/no-derived-useState")).toBe(true);
    expect(diagnosticRuleNames.has("react-doctor/no-fetch-in-effect")).toBe(true);
  });
});
