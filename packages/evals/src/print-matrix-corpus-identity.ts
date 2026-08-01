import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { hashMatrixCorpusProjectSet } from "./matrix-treatment-descriptor.js";
import { parseMatrixCorpusManifest } from "./utils/parse-matrix-corpus-manifest.js";

const [corpusManifestPath] = process.argv.slice(2);
if (!corpusManifestPath || !isAbsolute(corpusManifestPath)) {
  throw new Error("Usage: nr matrix-corpus-identity <absolute-corpus-manifest-path>");
}
const contents = await readFile(corpusManifestPath);
const repositories = parseMatrixCorpusManifest(contents);
process.stdout.write(
  `${JSON.stringify(
    {
      manifestSha256: createHash("sha256").update(contents).digest("hex"),
      projectSetSha256: hashMatrixCorpusProjectSet(repositories),
      projectCount: repositories.length,
    },
    null,
    2,
  )}\n`,
);
