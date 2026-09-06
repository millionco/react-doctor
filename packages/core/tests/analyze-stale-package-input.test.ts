import { describe, expect, it } from "vite-plus/test";
import {
  analyzeStalePackageInput,
  type DeclaredDependencyAnalysisInput,
  type StalePackageAnalysisInput,
} from "../src/project-analysis/report/packages.js";

const dependency = (
  name: string,
  isDevDependency: boolean,
  isAlwaysConsideredUsed = false,
): DeclaredDependencyAnalysisInput => ({
  name,
  isDevDependency,
  isAlwaysConsideredUsed,
});

const input = (
  declaredDependencies: DeclaredDependencyAnalysisInput[],
  overrides: Partial<StalePackageAnalysisInput> = {},
): StalePackageAnalysisInput => ({
  declaredDependencies,
  sortedDeclaredDependencyNames: declaredDependencies
    .map((dependency) => dependency.name)
    .sort((leftName, rightName) => leftName.localeCompare(rightName)),
  observedPackageNames: [],
  usedPackageNames: [],
  peerSatisfiedPackageNames: [],
  ambiguousBinaryPackageNames: [],
  sourceFileRescuedPackageNames: [],
  overrideMappings: [],
  finalPeerSatisfiedPackageNames: [],
  isPeerMetadataComplete: true,
  ...overrides,
});

describe("analyzeStalePackageInput", () => {
  it("preserves declaration order, dependency kind, and exact reason text", () => {
    expect(
      analyzeStalePackageInput(
        input([dependency("z-runtime", false), dependency("a-development", true)]),
      ).unusedDependencies,
    ).toEqual([
      {
        name: "z-runtime",
        isDevDependency: false,
        reason:
          '"z-runtime" is declared in dependencies but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused',
      },
      {
        name: "a-development",
        isDevDependency: true,
        reason:
          '"a-development" is declared in devDependencies but is never imported or referenced by any source file, script, or config — remove it from package.json if it is genuinely unused',
      },
    ]);
  });

  it("applies observed, peer, rescue, override, allowlist, ambiguity, and safety evidence", () => {
    const report = analyzeStalePackageInput(
      input(
        [
          dependency("observed", false),
          dependency("peer-satisfied", false),
          dependency("rescued", false),
          dependency("used-source", false),
          dependency("override-middle", false),
          dependency("override-target", false),
          dependency("allowlisted", false, true),
          dependency("ambiguous", true),
          dependency("candidate", true),
        ],
        {
          observedPackageNames: ["observed"],
          usedPackageNames: ["observed", "peer-satisfied", "used-source"],
          peerSatisfiedPackageNames: ["peer-satisfied"],
          ambiguousBinaryPackageNames: ["ambiguous"],
          sourceFileRescuedPackageNames: ["rescued"],
          overrideMappings: [
            { fromPackage: "used-source", toPackage: "override-middle" },
            { fromPackage: "override-middle", toPackage: "override-target" },
          ],
          isPeerMetadataComplete: false,
        },
      ),
    );

    expect(report.unusedDependencies).toEqual([]);
    expect(report.skippedDependencies).toEqual([
      {
        name: "allowlisted",
        isDevDependency: false,
        reasons: ["allowlisted-name"],
      },
      {
        name: "ambiguous",
        isDevDependency: true,
        reasons: ["ambiguous-binary"],
      },
      {
        name: "candidate",
        isDevDependency: true,
        reasons: ["incomplete-peer-metadata"],
      },
    ]);
  });
});
