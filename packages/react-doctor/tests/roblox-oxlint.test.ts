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

  it("detects Roblox-specific anti-patterns in roblox-ts mode", async () => {
    const fixtureDirectory = path.join(FIXTURES_DIRECTORY, "roblox-react-issues");
    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.framework).toBe("roblox-ts");

    const diagnostics = await runOxlint(
      fixtureDirectory,
      projectInfo.hasTypeScript,
      projectInfo.framework,
      projectInfo.hasReactCompiler,
    );
    const diagnosticRuleNames = getRuleNames(diagnostics);

    expect(diagnosticRuleNames.has("react-doctor/rbx-no-uncleaned-connection")).toBe(true);
    expect(diagnosticRuleNames.has("react-doctor/rbx-no-print")).toBe(true);
    expect(diagnosticRuleNames.has("react-doctor/rbx-no-direct-instance-mutation")).toBe(true);
    expect(diagnosticRuleNames.has("react-doctor/rbx-no-unstored-connection")).toBe(true);
  });

  it("does not fire Roblox-specific rules on clean fixture", async () => {
    const fixtureDirectory = path.join(FIXTURES_DIRECTORY, "roblox-react-clean");
    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.framework).toBe("roblox-ts");

    const diagnostics = await runOxlint(
      fixtureDirectory,
      projectInfo.hasTypeScript,
      projectInfo.framework,
      projectInfo.hasReactCompiler,
    );
    const diagnosticRuleNames = getRuleNames(diagnostics);

    expect(diagnosticRuleNames.has("react-doctor/rbx-no-uncleaned-connection")).toBe(false);
    expect(diagnosticRuleNames.has("react-doctor/rbx-no-print")).toBe(false);
    expect(diagnosticRuleNames.has("react-doctor/rbx-no-direct-instance-mutation")).toBe(false);
    expect(diagnosticRuleNames.has("react-doctor/rbx-no-unstored-connection")).toBe(false);
  });

  it("suppresses prefer-dynamic-import in roblox-ts mode", async () => {
    const fixtureDirectory = path.join(FIXTURES_DIRECTORY, "roblox-react-web-noise");
    const projectInfo = discoverProject(fixtureDirectory);
    expect(projectInfo.framework).toBe("roblox-ts");

    const unknownFrameworkDiagnostics = await runOxlint(fixtureDirectory, true, "unknown", false);
    const unknownFrameworkRuleNames = getRuleNames(unknownFrameworkDiagnostics);

    const diagnostics = await runOxlint(
      fixtureDirectory,
      projectInfo.hasTypeScript,
      projectInfo.framework,
      projectInfo.hasReactCompiler,
    );
    const diagnosticRuleNames = getRuleNames(diagnostics);

    expect(diagnosticRuleNames.has("react-doctor/prefer-dynamic-import")).toBe(false);
  });
});
