import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as Os from "node:os";
import * as Path from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";

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

describe("loadCorpusRepositories", () => {
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

  it("prefers pinned corpus projects over matching default-branch entries", async () => {
    const directory = await makeTemporaryDirectory();
    const jsonPath = Path.join(directory, "pinned.json");
    const textPath = Path.join(directory, "repositories.txt");
    await writeFile(
      jsonPath,
      JSON.stringify([{ org: "example", name: "app", ref: "abc123", rootDir: "web" }]),
    );
    await writeFile(textPath, "example/app\nexample/other\n");

    await expect(loadCorpusRepositories([textPath, jsonPath])).resolves.toEqual([
      { org: "example", name: "other", ref: "HEAD", rootDir: "." },
      { org: "example", name: "app", ref: "abc123", rootDir: "web" },
    ]);
  });

  it("loads resolved repositories from evaluation NDJSON", async () => {
    const directory = await makeTemporaryDirectory();
    const resultsPath = Path.join(directory, "baseline.ndjson");
    await writeFile(
      resultsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        repository: { org: "example", name: "app", ref: "abc123", rootDir: "." },
        report: {},
      })}\n`,
    );

    await expect(loadCorpusRepositories([resultsPath])).resolves.toEqual([
      { org: "example", name: "app", ref: "abc123", rootDir: "." },
    ]);
  });
});
