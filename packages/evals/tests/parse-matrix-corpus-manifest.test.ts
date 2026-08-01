import { describe, expect, it } from "vite-plus/test";

import { parseMatrixCorpusManifest } from "../src/utils/parse-matrix-corpus-manifest.js";

const repositories = [
  { org: "example", name: "first", ref: "a".repeat(40), rootDir: "." },
  { org: "example", name: "second", ref: "b".repeat(40), rootDir: "packages/app" },
];

const serialize = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));

describe("parseMatrixCorpusManifest", () => {
  it("accepts a canonical pinned corpus in any project order", () => {
    expect(parseMatrixCorpusManifest(serialize([...repositories].reverse()))).toEqual([
      repositories[1],
      repositories[0],
    ]);
  });

  it("rejects unpinned projects", () => {
    expect(() =>
      parseMatrixCorpusManifest(serialize([{ ...repositories[0], ref: "HEAD" }])),
    ).toThrow("must pin every repository");
  });

  it("rejects uppercase commit refs", () => {
    expect(() =>
      parseMatrixCorpusManifest(serialize([{ ...repositories[0], ref: "A".repeat(40) }])),
    ).toThrow("lowercase commit");
  });

  it("rejects duplicate project tuples", () => {
    expect(() => parseMatrixCorpusManifest(serialize([repositories[0], repositories[0]]))).toThrow(
      "repository 2 is duplicated",
    );
  });

  it("rejects noncanonical or extended project records", () => {
    expect(() =>
      parseMatrixCorpusManifest(serialize([{ ...repositories[0], rootDir: "packages/../" }])),
    ).toThrow("repository 1 is invalid");
    expect(() =>
      parseMatrixCorpusManifest(serialize([{ ...repositories[0], extra: true }])),
    ).toThrow("repository 1 is invalid");
  });
});
