import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, expect, it } from "vite-plus/test";
import { collectGitLinguistIgnoredPathsCooperative } from "../src/utils/collect-git-linguist-ignored-paths.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "rd-linguist-input-"));
const SOURCE_PATH_COUNT = 10_000;

afterAll(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

it("falls back when Git closes a large input pipe in a non-Git directory", async () => {
  fs.writeFileSync(
    path.join(tempRoot, ".gitattributes"),
    "* linguist-vendored\nsrc/kept.tsx -linguist-vendored\n",
  );
  const vendoredPaths = Array.from(
    { length: SOURCE_PATH_COUNT },
    (_, fileIndex) => `src/generated-component-${fileIndex}.tsx`,
  );
  const ignoredPaths = await collectGitLinguistIgnoredPathsCooperative(tempRoot, [
    ...vendoredPaths,
    "src/kept.tsx",
  ]);
  expect([...ignoredPaths]).toEqual(vendoredPaths);
});
