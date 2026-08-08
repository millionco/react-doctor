import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

interface ReactBenchAuditExpectedCounts {
  totalCallsites: number;
  passCallsites: number;
  failCallsites: number;
  uniqueTrials: number;
  uniqueFixtures: number;
}

interface ReactBenchAuditFixture {
  fixture: string;
  verdict: "pass" | "fail";
  rules: string[];
  fixtureSourceSha256: string;
}

interface ReactBenchAuditCallsite {
  suffix: string;
  rule: string;
  filePath: string;
  reportedLine: number;
  snippetSha256: string;
  fixture: string;
  verdict: "pass" | "fail";
}

interface ReactBenchAuditManifest {
  expected: ReactBenchAuditExpectedCounts;
  fixtures: ReactBenchAuditFixture[];
  callsites: ReactBenchAuditCallsite[];
}

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const corpusDirectory = path.join(packageRoot, "corpus");
const manifestPath = path.join(corpusDirectory, "react-bench-0.9.7-audit.json");
const manifest: ReactBenchAuditManifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const fixtureHeaderPattern = /^(?:\/\/[^\n]*\n){4}/;
const sha256 = (value: string): string => crypto.createHash("sha256").update(value).digest("hex");

describe("React Bench 0.9.7 exact audit corpus", () => {
  it("accounts for every audited callsite instance", () => {
    const passCallsites = manifest.callsites.filter((callsite) => callsite.verdict === "pass");
    const failCallsites = manifest.callsites.filter((callsite) => callsite.verdict === "fail");
    const uniqueTrials = new Set(manifest.callsites.map((callsite) => callsite.suffix));

    expect(manifest.callsites).toHaveLength(manifest.expected.totalCallsites);
    expect(passCallsites).toHaveLength(manifest.expected.passCallsites);
    expect(failCallsites).toHaveLength(manifest.expected.failCallsites);
    expect(uniqueTrials.size).toBe(manifest.expected.uniqueTrials);
    expect(manifest.fixtures).toHaveLength(manifest.expected.uniqueFixtures);
  });

  it("contains no duplicate callsite or source fixture", () => {
    const callsiteKeys = manifest.callsites.map((callsite) =>
      [
        callsite.suffix,
        callsite.rule,
        callsite.filePath,
        callsite.reportedLine,
        callsite.snippetSha256,
      ].join(":"),
    );
    const fixturePaths = manifest.fixtures.map((fixture) => fixture.fixture);
    const fixtureSourceHashes = manifest.fixtures.map((fixture) => fixture.fixtureSourceSha256);

    expect(new Set(callsiteKeys).size).toBe(callsiteKeys.length);
    expect(new Set(fixturePaths).size).toBe(fixturePaths.length);
    expect(new Set(fixtureSourceHashes).size).toBe(fixtureSourceHashes.length);
    expect(fixturePaths.length).toBeLessThan(manifest.callsites.length);
  });

  it("maps every callsite to an exact loaded source with its audited verdict", () => {
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
      expect(entry?.verdict, fixture.fixture).toBe(fixture.verdict === "fail" ? "fail" : undefined);
      expect(exactSource, fixture.fixture).toBeDefined();
      expect(sha256(exactSource ?? ""), fixture.fixture).toBe(fixture.fixtureSourceSha256);
    }

    for (const callsite of manifest.callsites) {
      const fixture = fixturesByPath.get(callsite.fixture);
      expect(fixture, callsite.fixture).toBeDefined();
      expect(fixture?.rules, callsite.fixture).toContain(callsite.rule);
      expect(fixture?.verdict, callsite.fixture).toBe(callsite.verdict);
    }
  });
});
