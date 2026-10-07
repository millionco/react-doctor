import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

import { DEFAULT_CORPUS_REPOSITORY_COUNT } from "../src/constants.js";
import { loadCorpusRepositories } from "../src/load-corpus-repositories.js";

const temporaryDirectories: Array<string> = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

const makeTemporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(Path.join(Os.tmpdir(), "react-doctor-evals-"));
  temporaryDirectories.push(directory);
  return directory;
};

const buildCompleteLegacyReport = (diagnosticCount = 0) => {
  const diagnostics = Array.from({ length: diagnosticCount }, (_, diagnosticIndex) => ({
    filePath: `src/file-${diagnosticIndex}.tsx`,
    line: diagnosticIndex + 1,
    column: 1,
    plugin: "react-doctor",
    rule: "example",
    severity: "warning",
    message: "Example diagnostic",
    help: "Fix the example.",
    category: "Correctness",
  }));
  return {
    schemaVersion: 1,
    version: "0.8.1",
    ok: true,
    directory: "/workspace/target",
    mode: "full",
    diff: null,
    projects: [
      {
        directory: "/workspace/target",
        project: {},
        diagnostics,
        score: null,
        skippedChecks: [],
        elapsedMilliseconds: 1,
      },
    ],
    diagnostics,
    summary: {
      errorCount: 0,
      warningCount: diagnosticCount,
      affectedFileCount: diagnosticCount,
      totalDiagnosticCount: diagnosticCount,
      score: null,
      scoreLabel: null,
    },
    elapsedMilliseconds: 1,
    error: null,
  };
};

describe("loadCorpusRepositories", () => {
  it("keeps the default corpus at the selected repository count", async () => {
    const repositories = await loadCorpusRepositories(["./repositories.json"]);
    const repositoryNames = new Set(
      repositories.map((repository) => `${repository.org}/${repository.name}`.toLowerCase()),
    );

    expect(repositoryNames.size).toBe(DEFAULT_CORPUS_REPOSITORY_COUNT);
  });

  it("loads and deduplicates repository lists from a directory", async () => {
    const directory = await makeTemporaryDirectory();
    await writeFile(
      Path.join(directory, "first.txt"),
      "# repositories\nExample/App\nhttps://github.com/example/Other.git\n",
    );
    await writeFile(Path.join(directory, "second.txt"), "example/app\n");

    await expect(loadCorpusRepositories([directory])).resolves.toEqual([
      { org: "Example", name: "App", ref: "HEAD", rootDir: "." },
      { org: "example", name: "Other", ref: "HEAD", rootDir: "." },
    ]);
  });

  it("rejects an empty corpus", async () => {
    const directory = await makeTemporaryDirectory();
    const repositoriesPath = Path.join(directory, "repositories.txt");
    await writeFile(repositoriesPath, "# no repositories\n");

    await expect(loadCorpusRepositories([repositoriesPath])).rejects.toThrow(
      "Corpus contains no repositories",
    );
  });

  it("prefers pinned corpus projects over matching default-branch entries", async () => {
    const directory = await makeTemporaryDirectory();
    const jsonPath = Path.join(directory, "pinned.json");
    const textPath = Path.join(directory, "repositories.txt");
    await writeFile(
      jsonPath,
      JSON.stringify([
        {
          org: "example",
          name: "app",
          ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          rootDir: "web",
        },
      ]),
    );
    await writeFile(textPath, "example/app\nexample/other\n");

    await expect(loadCorpusRepositories([textPath, jsonPath])).resolves.toEqual([
      { org: "example", name: "other", ref: "HEAD", rootDir: "." },
      {
        org: "example",
        name: "app",
        ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        rootDir: "web",
      },
    ]);
  });

  it("normalizes root directories before deduplication", async () => {
    const directory = await makeTemporaryDirectory();
    const repositoriesPath = Path.join(directory, "repositories.json");
    await writeFile(
      repositoriesPath,
      JSON.stringify([
        { org: "example", name: "app", ref: "HEAD", rootDir: "packages/app" },
        { org: "example", name: "app", ref: "HEAD", rootDir: "packages/web/../app" },
        { org: "example", name: "app", ref: "HEAD", rootDir: "packages/app/" },
      ]),
    );

    await expect(loadCorpusRepositories([repositoriesPath])).resolves.toEqual([
      { org: "example", name: "app", ref: "HEAD", rootDir: "packages/app" },
    ]);
  });

  it("rejects unsafe corpus fields", async () => {
    const directory = await makeTemporaryDirectory();
    const repositoriesPath = Path.join(directory, "repositories.json");
    await writeFile(
      repositoriesPath,
      JSON.stringify([
        { org: "example", name: "app", ref: "HEAD", rootDir: "$(touch compromised)" },
      ]),
    );

    await expect(loadCorpusRepositories([repositoriesPath])).rejects.toThrow(
      "must be an array of { org, name, ref, rootDir } records",
    );
  });

  it("loads resolved repositories from evaluation NDJSON", async () => {
    const directory = await makeTemporaryDirectory();
    const resultsPath = Path.join(directory, "baseline.ndjson");
    await writeFile(
      resultsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "app",
          ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          rootDir: ".",
        },
        report: buildCompleteLegacyReport(),
      })}\n`,
    );

    await expect(loadCorpusRepositories([resultsPath])).resolves.toEqual([
      {
        org: "example",
        name: "app",
        ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        rootDir: ".",
      },
    ]);
  });

  it("streams multiple resolved repositories from evaluation NDJSON", async () => {
    const directory = await makeTemporaryDirectory();
    const resultsPath = Path.join(directory, "baseline.ndjson");
    const records = [
      {
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "app",
          ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          rootDir: ".",
        },
        report: buildCompleteLegacyReport(1_000),
      },
      {
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "other",
          ref: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          rootDir: "packages/web",
        },
        report: buildCompleteLegacyReport(),
      },
    ];
    await writeFile(resultsPath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);

    await expect(loadCorpusRepositories([resultsPath])).resolves.toEqual(
      records.map((record) => record.repository),
    );
  });

  it("rejects unpinned repositories from evaluation NDJSON", async () => {
    const directory = await makeTemporaryDirectory();
    const resultsPath = Path.join(directory, "baseline.ndjson");
    await writeFile(
      resultsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repository: { org: "example", name: "app", ref: "HEAD", rootDir: "." },
        error: "Sandbox failed",
      })}\n`,
    );

    await expect(loadCorpusRepositories([resultsPath])).rejects.toThrow(
      "contains an unpinned eval result",
    );
  });

  it("rejects incomplete reports from evaluation NDJSON", async () => {
    const directory = await makeTemporaryDirectory();
    const resultsPath = Path.join(directory, "baseline.ndjson");
    const completeReport = buildCompleteLegacyReport();
    const report = {
      ...completeReport,
      projects: [{ ...completeReport.projects[0], skippedChecks: ["lint"] }],
    };
    await writeFile(
      resultsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repository: {
          org: "example",
          name: "app",
          ref: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          rootDir: ".",
        },
        report,
      })}\n`,
    );

    await expect(loadCorpusRepositories([resultsPath])).rejects.toThrow(
      "contains an incomplete or invalid eval result",
    );
  });
});
