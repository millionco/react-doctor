import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vite-plus/test";

export { collectRuleHits, setupReactProject } from "../_helpers.js";

export const createScopedTempRoot = (suffix: string): string => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), `rd-state-rules-${suffix}-`));
  afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });
  return tempRoot;
};
