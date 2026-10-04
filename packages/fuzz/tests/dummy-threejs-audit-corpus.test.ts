import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

interface DummyAuditExpectedCounts {
  auditedProjects: number;
  totalCallsites: number;
  passCallsites: number;
  failCallsites: number;
  uniqueCallsiteFiles: number;
  uniqueFixtures: number;
}

interface DummyAuditFixture {
  fixture: string;
  filePath: string;
  verdict: "pass" | "fail";
  rules: string[];
  fixtureSourceSha256: string;
}

interface DummyAuditCallsite {
  project: string;
  rule: string;
  filePath: string;
  reportedLine: number;
  reportedColumn: number;
  sourceSha256: string;
  sourceLineSha256: string;
  fixture: string;
  verdict: "pass" | "fail";
}

interface DummyAuditManifest {
  sourceArtifacts: {
    beforeDiagnosticsSha256: string;
    afterDiagnosticsSha256: string;
    selectedRootsSha256: string;
  };
  expected: DummyAuditExpectedCounts;
  auditedProjectIds: string[];
  fixtures: DummyAuditFixture[];
  callsites: DummyAuditCallsite[];
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusDirectory = path.join(packageRoot, "corpus");
const manifestPath = path.join(corpusDirectory, "dummy-threejs-v14-audit.json");
const manifest: DummyAuditManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const expectedSourceArtifacts = {
  beforeDiagnosticsSha256: "3cd4d20888f07c351c1962e35464e22c079fd64c9dc83ac0c88849e5af361e53",
  afterDiagnosticsSha256: "5d6db17e776eb4ae65a217026ca46c73ad97568df3019cd71e61ea2d45fe356a",
  selectedRootsSha256: "e93beb5e45e8ac83d99d4e417715bb0812d624fc46b878ba9edd60f167184bfe",
};
const expectedAuditCounts = {
  auditedProjects: 207,
  totalCallsites: 164,
  passCallsites: 163,
  failCallsites: 1,
  uniqueCallsiteFiles: 105,
  uniqueFixtures: 106,
};
const fixtureHeaderPattern = /^(?:\/\/[^\n]*\n){5}/;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

describe("Dummy 3D exact audit corpus", () => {
  it("accounts for every audited project and diagnostic delta", () => {
    const passCallsites = manifest.callsites.filter((callsite) => callsite.verdict === "pass");
    const failCallsites = manifest.callsites.filter((callsite) => callsite.verdict === "fail");
    const uniqueCallsiteFiles = new Set(
      manifest.callsites.map((callsite) => `${callsite.project}:${callsite.filePath}`),
    );

    expect(manifest.sourceArtifacts).toEqual(expectedSourceArtifacts);
    expect(manifest.expected).toMatchObject(expectedAuditCounts);
    expect(manifest.auditedProjectIds).toHaveLength(manifest.expected.auditedProjects);
    expect(new Set(manifest.auditedProjectIds).size).toBe(manifest.expected.auditedProjects);
    expect(manifest.callsites).toHaveLength(manifest.expected.totalCallsites);
    expect(passCallsites).toHaveLength(manifest.expected.passCallsites);
    expect(failCallsites).toHaveLength(manifest.expected.failCallsites);
    expect(uniqueCallsiteFiles.size).toBe(manifest.expected.uniqueCallsiteFiles);
    expect(manifest.fixtures).toHaveLength(manifest.expected.uniqueFixtures);
  });

  it("contains no duplicate callsite or source fixture", () => {
    const callsiteKeys = manifest.callsites.map((callsite) =>
      [
        callsite.project,
        callsite.rule,
        callsite.filePath,
        callsite.reportedLine,
        callsite.reportedColumn,
        callsite.verdict,
      ].join(":"),
    );
    const fixturePaths = manifest.fixtures.map((fixture) => fixture.fixture);
    const fixtureSourceVerdicts = manifest.fixtures.map(
      (fixture) => `${fixture.verdict}:${fixture.fixtureSourceSha256}`,
    );

    expect(new Set(callsiteKeys).size).toBe(callsiteKeys.length);
    expect(new Set(fixturePaths).size).toBe(fixturePaths.length);
    expect(new Set(fixtureSourceVerdicts).size).toBe(fixtureSourceVerdicts.length);
  });

  it("maps every callsite to exact source with its audited verdict", () => {
    const loadedCorpus = loadFuzzCorpus(corpusDirectory, {
      maximumFiles: Number.POSITIVE_INFINITY,
    });
    const entriesByPath = new Map(loadedCorpus.map((entry) => [entry.relativePath, entry]));
    const fixturesByPath = new Map(manifest.fixtures.map((fixture) => [fixture.fixture, fixture]));

    for (const fixture of manifest.fixtures) {
      const entry = entriesByPath.get(fixture.fixture);
      const exactSource = entry?.code.replace(fixtureHeaderPattern, "");
      expect(entry, fixture.fixture).toBeDefined();
      expect(entry?.ruleIds, fixture.fixture).toEqual(fixture.rules);
      expect(entry?.sourcePath, fixture.fixture).toBe(fixture.filePath);
      expect(entry?.verdict, fixture.fixture).toBe(fixture.verdict === "fail" ? "fail" : undefined);
      expect(sha256(exactSource ?? ""), fixture.fixture).toBe(fixture.fixtureSourceSha256);
    }

    for (const callsite of manifest.callsites) {
      const fixture = fixturesByPath.get(callsite.fixture);
      const entry = entriesByPath.get(callsite.fixture);
      const exactSource = entry?.code.replace(fixtureHeaderPattern, "");
      const sourceLine = exactSource?.split("\n")[callsite.reportedLine - 1];
      expect(fixture, callsite.fixture).toBeDefined();
      expect(fixture?.rules, callsite.fixture).toContain(callsite.rule);
      expect(fixture?.verdict, callsite.fixture).toBe(callsite.verdict);
      expect(fixture?.fixtureSourceSha256, callsite.fixture).toBe(callsite.sourceSha256);
      expect(sha256(sourceLine ?? ""), callsite.fixture).toBe(callsite.sourceLineSha256);
    }
  });
});
