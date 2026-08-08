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

  it("loads declared rule IDs and verdicts", () => {
    const directory = makeCorpusDirectory();
    fs.writeFileSync(
      path.join(directory, "declared.tsx"),
      "// rule: first-rule, second-rule\r\n// verdict: pass\r\nexport const Seed = <div />;",
    );

    expect(loadFuzzCorpus(directory)).toEqual([
      {
        relativePath: "declared.tsx",
        code: "// rule: first-rule, second-rule\r\n// verdict: pass\r\nexport const Seed = <div />;",
        ruleIds: ["first-rule", "second-rule"],
        verdict: "pass",
      },
    ]);
  });

  it.each(["tsx", "ts", "jsx", "js"])("loads .%s source files", (extension) => {
    const directory = makeCorpusDirectory();
    fs.writeFileSync(path.join(directory, `declared.${extension}`), "export const value = 1;");

    expect(loadFuzzCorpus(directory).map((entry) => entry.relativePath)).toEqual([
      `declared.${extension}`,
    ]);
  });

  it("ignores non-source files", () => {
    const directory = makeCorpusDirectory();
    fs.writeFileSync(path.join(directory, "manifest.json"), "{}");

    expect(loadFuzzCorpus(directory)).toEqual([]);
  });

  it("ignores TypeScript declaration files", () => {
    const directory = makeCorpusDirectory();
    const nestedDirectory = path.join(directory, "nested");
    fs.mkdirSync(nestedDirectory);
    fs.writeFileSync(path.join(directory, "root.d.ts"), "declare const rootValue: string;");
    fs.writeFileSync(
      path.join(nestedDirectory, "nested.d.ts"),
      "declare const nestedValue: string;",
    );

    expect(loadFuzzCorpus(directory)).toEqual([]);
  });

  it("returns portable relative paths for nested seeds", () => {
    const directory = makeCorpusDirectory();
    const nestedDirectory = path.join(directory, "nested", "deeper");
    fs.mkdirSync(nestedDirectory, { recursive: true });
    fs.writeFileSync(path.join(nestedDirectory, "declared.tsx"), "export const value = 1;");

    expect(loadFuzzCorpus(directory).map((entry) => entry.relativePath)).toEqual([
      "nested/deeper/declared.tsx",
    ]);
  });
});
