import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { MAX_CORPUS_FILES } from "../src/constants.js";
import { loadFuzzCorpus } from "../src/load-fuzz-corpus.js";

const temporaryDirectories: string[] = [];

const makeCorpusDirectory = (): string => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "react-doctor-fuzz-corpus-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("loadFuzzCorpus", () => {
  it("caps external corpora by default", () => {
    const directory = makeCorpusDirectory();
    for (let fileIndex = 0; fileIndex <= MAX_CORPUS_FILES; fileIndex += 1) {
      fs.writeFileSync(
        path.join(directory, `seed-${fileIndex}.tsx`),
        "export const Seed = <div />;",
      );
    }

    expect(loadFuzzCorpus(directory)).toHaveLength(MAX_CORPUS_FILES);
  });

  it("can load every built-in regression seed", () => {
    const directory = makeCorpusDirectory();
    for (let fileIndex = 0; fileIndex <= MAX_CORPUS_FILES; fileIndex += 1) {
      fs.writeFileSync(
        path.join(directory, `seed-${fileIndex}.tsx`),
        "export const Seed = <div />;",
      );
    }

    expect(loadFuzzCorpus(directory, { maximumFiles: Number.POSITIVE_INFINITY })).toHaveLength(
      MAX_CORPUS_FILES + 1,
    );
  });
});
