import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defineRule } from "../../oxlint-plugin-react-doctor/src/plugin/utils/define-rule.js";
import { noSpreadAccumulatorInReduce } from "../../oxlint-plugin-react-doctor/src/plugin/rules/js-performance/no-spread-accumulator-in-reduce.js";
import { fuzzRuleWithStats } from "../src/fuzz-rule.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";
import { getFuzzCorpusFilename } from "../src/utils/get-fuzz-corpus-filename.js";

vi.mock("../src/generate-fuzz-program.js", () => ({
  generateStructuredFuzzProgram: () => ({
    code: "const invented = true;",
    sections: ["const invented = true;"],
  }),
}));
vi.mock("../src/snippet-pools.js", () => ({ FUZZ_FILENAME_POOL: ["invented-program.tsx"] }));

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(packageRoot, "../..");
const fixtureRelativePath = "regressions/no-spread-accumulator-in-reduce--frozen-import.tsx";
const providerRelativePath = "regressions/providers/frozen-reduce-labels.ts";
const fixtureSource = fs.readFileSync(
  path.join(packageRoot, "corpus", fixtureRelativePath),
  "utf8",
);
const providerSource = fs.readFileSync(
  path.join(packageRoot, "corpus", providerRelativePath),
  "utf8",
);
let temporaryDirectory: string;

beforeEach(() => {
  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "rd-fuzz-physical-"));
  fs.mkdirSync(path.join(temporaryDirectory, "regressions/providers"), { recursive: true });
  fs.writeFileSync(path.join(temporaryDirectory, fixtureRelativePath), fixtureSource);
  fs.writeFileSync(path.join(temporaryDirectory, providerRelativePath), providerSource);
});

afterEach(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

const loadNewFixture = () => {
  const entry = loadFuzzCorpus(temporaryDirectory).find(
    (candidate) => candidate.relativePath === fixtureRelativePath,
  );
  if (!entry) throw new Error("Expected the independently invented frozen-import fixture");
  return entry;
};

describe("physical fuzz fixture filenames", () => {
  it.each([
    {
      scenario: "repository cwd",
      workingDirectory: repositoryRoot,
      corpusDirectoryName: "",
      boundaryData: null,
    },
    {
      scenario: "package cwd",
      workingDirectory: packageRoot,
      corpusDirectoryName: "",
      boundaryData: null,
    },
    {
      scenario: "argv path/data boundary",
      workingDirectory: repositoryRoot,
      corpusDirectoryName: "backtick` corpus",
      boundaryData: 'quote" backtick` line\nbreak',
    },
  ])(
    "resolves the new fixture provider through normal verdict dispatch: $scenario",
    ({ workingDirectory, corpusDirectoryName, boundaryData }) => {
      const corpusDirectory = path.join(temporaryDirectory, corpusDirectoryName);
      if (corpusDirectoryName) {
        fs.mkdirSync(path.join(corpusDirectory, "regressions/providers"), { recursive: true });
        fs.writeFileSync(path.join(corpusDirectory, fixtureRelativePath), fixtureSource);
        fs.writeFileSync(path.join(corpusDirectory, providerRelativePath), providerSource);
      }
      const loaderPath = path.join(packageRoot, "src/load-fuzz-corpus.ts");
      const filenameHelperPath = path.join(packageRoot, "src/utils/get-fuzz-corpus-filename.ts");
      const rulePath = path.join(
        repositoryRoot,
        "packages/oxlint-plugin-react-doctor/src/plugin/rules/js-performance/no-spread-accumulator-in-reduce.ts",
      );
      const runnerPath = path.join(
        repositoryRoot,
        "packages/oxlint-plugin-react-doctor/src/test-utils/run-rule.ts",
      );
      const childSource = `
      import { pathToFileURL } from "node:url";
      const configuration = JSON.parse(process.argv[1]);
      const { loadFuzzCorpus } = await import(pathToFileURL(configuration.loaderPath).href);
      const { getFuzzCorpusFilename } = await import(pathToFileURL(configuration.filenameHelperPath).href);
      const { noSpreadAccumulatorInReduce } = await import(pathToFileURL(configuration.rulePath).href);
      const { runRule } = await import(pathToFileURL(configuration.runnerPath).href);
      const entry = loadFuzzCorpus(configuration.corpusDirectory).find((candidate) => candidate.relativePath === configuration.fixtureRelativePath);
      if (!entry) throw new Error("Expected new fixture");
      const before = runRule(noSpreadAccumulatorInReduce, entry.code, { filename: entry.sourcePath ?? entry.relativePath, forceJsx: true });
      const after = runRule(noSpreadAccumulatorInReduce, entry.code, { filename: getFuzzCorpusFilename(entry, false), forceJsx: true });
      console.log(JSON.stringify({ relativePath: entry.relativePath, fixtureFilename: entry.fixtureFilename, sourcePath: entry.sourcePath ?? null, before: before.diagnostics.length, after: after.diagnostics.length, parseErrors: after.parseErrors, boundaryData: configuration.boundaryData }));
    `;
      const childConfiguration = {
        loaderPath,
        filenameHelperPath,
        rulePath,
        runnerPath,
        corpusDirectory: path.relative(workingDirectory, corpusDirectory),
        fixtureRelativePath,
        boundaryData,
      };
      const child = spawnSync(
        process.execPath,
        [
          "--import",
          pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href,
          "--input-type=module",
          "--eval",
          childSource,
          JSON.stringify(childConfiguration),
        ],
        {
          cwd: workingDirectory,
          encoding: "utf8",
          env: { ...process.env, REACT_DOCTOR_NO_TELEMETRY: "1" },
        },
      );
      expect(child.status, child.stderr).toBe(0);
      expect(JSON.parse(child.stdout)).toEqual({
        relativePath: fixtureRelativePath,
        fixtureFilename: path.join(corpusDirectory, fixtureRelativePath),
        sourcePath: null,
        before: 1,
        after: 0,
        parseErrors: [],
        boundaryData,
      });
    },
  );

  it.each([
    { lineEndingName: "LF", lineEnding: "\n" },
    { lineEndingName: "CRLF", lineEnding: "\r\n" },
  ])(
    "preserves legacy relative dispatch without the directive: $lineEndingName",
    ({ lineEnding }) => {
      const legacyFixtureSource = fixtureSource
        .replace(/\r?\n/g, lineEnding)
        .replace(/^\/\/ fixture-context: physical\r?\n/m, "");
      fs.writeFileSync(path.join(temporaryDirectory, fixtureRelativePath), legacyFixtureSource);
      const entry = loadNewFixture();
      expect(entry).not.toHaveProperty("fixtureFilename");
      expect(getFuzzCorpusFilename(entry, false)).toBe(fixtureRelativePath);
      const result = fuzzRuleWithStats(
        noSpreadAccumulatorInReduce.id,
        noSpreadAccumulatorInReduce,
        {
          iterations: 0,
          corpus: [entry],
        },
      );
      expect(result.stats.firedProgramCount).toBe(1);
      expect(result.findings).toMatchObject([
        {
          kind: "verdict-mismatch",
          detail: `${fixtureRelativePath} declared pass but produced 1 diagnostics`,
        },
      ]);
    },
  );

  it("preserves default liveness filenames even when an explicit source path is present", () => {
    const filenames: Array<string | undefined> = [];
    const rule = defineRule({
      id: "physical-context-liveness",
      severity: "warn",
      create: (context) => {
        filenames.push(context.filename);
        return {};
      },
    });
    const relativePath = `targets/${rule.id}--invented.tsx`;
    const result = fuzzRuleWithStats(rule.id, rule, {
      iterations: 1,
      corpus: [
        { relativePath, sourcePath: "src/invented-override.tsx", code: "const invented = true;" },
      ],
    });
    expect(result.findings).toEqual([]);
    expect(filenames).toEqual([relativePath]);
  });

  it("uses opt-in liveness context without changing scan liveness filenames", () => {
    const filenames: Array<string | undefined> = [];
    const rule = defineRule({
      id: "physical-context-liveness",
      severity: "warn",
      create: (context) => {
        filenames.push(context.filename);
        return {};
      },
    });
    const entry = {
      ...loadNewFixture(),
      relativePath: `targets/${rule.id}--invented.tsx`,
      ruleIds: undefined,
      verdict: undefined,
      sourcePath: "src/invented-override.tsx",
    };
    expect(fuzzRuleWithStats(rule.id, rule, { iterations: 1, corpus: [entry] }).findings).toEqual(
      [],
    );
    expect(filenames).toEqual([entry.sourcePath]);
    const scanFilenames: string[] = [];
    const scanRule = defineRule({
      id: rule.id,
      severity: "warn",
      scan: (file) => {
        scanFilenames.push(file.relativePath);
        return [];
      },
    });
    expect(
      fuzzRuleWithStats(scanRule.id, scanRule, { iterations: 1, corpus: [entry] }).findings,
    ).toEqual([]);
    expect(scanFilenames).toEqual([entry.relativePath]);
  });

  it("uses the physical filename for deterministic declared-verdict replay", () => {
    const entry = loadNewFixture();
    expect(entry.sourcePath).toBeUndefined();
    expect(entry.relativePath).toBe(fixtureRelativePath);
    expect(entry.fixtureFilename).toBe(path.join(temporaryDirectory, fixtureRelativePath));
    const result = fuzzRuleWithStats(noSpreadAccumulatorInReduce.id, noSpreadAccumulatorInReduce, {
      iterations: 0,
      corpus: [entry],
    });
    expect(result.findings).toEqual([]);
    expect(result.stats.executedProgramCount).toBe(1);
    expect(result.stats.firedProgramCount).toBe(0);
  });

  it("keeps explicit source overrides and reporting provenance distinct from the physical fixture", () => {
    const overrideDirectory = path.join(temporaryDirectory, "override");
    fs.mkdirSync(path.join(overrideDirectory, "providers"), { recursive: true });
    fs.writeFileSync(
      path.join(overrideDirectory, "providers/frozen-reduce-labels.ts"),
      "export let labels = loadLabels();",
    );
    const sourcePath = path.join(overrideDirectory, "consumer.tsx");
    fs.writeFileSync(
      path.join(temporaryDirectory, fixtureRelativePath),
      `// file-path: ${sourcePath}\n${fixtureSource}`,
    );
    const entry = loadNewFixture();
    expect(entry.sourcePath).toBe(sourcePath);
    expect(entry.fixtureFilename).toBe(path.join(temporaryDirectory, fixtureRelativePath));
    expect(getFuzzCorpusFilename(entry, false)).toBe(sourcePath);
    const result = fuzzRuleWithStats(noSpreadAccumulatorInReduce.id, noSpreadAccumulatorInReduce, {
      iterations: 0,
      corpus: [entry],
    });
    expect(result.stats.firedProgramCount).toBe(1);
    expect(result.findings).toMatchObject([
      {
        kind: "verdict-mismatch",
        detail: `${fixtureRelativePath} declared pass but produced 1 diagnostics`,
      },
    ]);
    expect(result.findings[0].detail).not.toContain(sourcePath);
  });

  it("preserves relative scan paths and explicit scan overrides", () => {
    const filenames: string[] = [];
    const scanRule = defineRule({
      id: "physical-filename-scan",
      severity: "warn",
      scan: (file) => {
        filenames.push(file.relativePath);
        return [];
      },
    });
    const entry = { ...loadNewFixture(), ruleIds: [scanRule.id] };
    const ordinary = fuzzRuleWithStats(scanRule.id, scanRule, { iterations: 0, corpus: [entry] });
    const overridden = fuzzRuleWithStats(scanRule.id, scanRule, {
      iterations: 0,
      corpus: [{ ...entry, sourcePath: "src/invented-scan.tsx" }],
    });
    expect(ordinary.findings).toEqual([]);
    expect(overridden.findings).toEqual([]);
    expect(filenames).toEqual([fixtureRelativePath, "src/invented-scan.tsx"]);
  });

  it("preserves manually constructed relative entries and explicit empty overrides", () => {
    const entry = { relativePath: "invented.tsx", code: "const invented = true;" };
    expect(getFuzzCorpusFilename(entry, false)).toBe("invented.tsx");
    expect(getFuzzCorpusFilename({ ...entry, sourcePath: "" }, false)).toBe("");
  });
});
