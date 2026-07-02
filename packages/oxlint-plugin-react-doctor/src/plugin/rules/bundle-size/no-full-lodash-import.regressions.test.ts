import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noFullLodashImport } from "./no-full-lodash-import.js";

const expectFail = (code: string): void => {
  const result = runRule(noFullLodashImport, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noFullLodashImport, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("bundle-size/no-full-lodash-import — regressions", () => {
  it("flags a runtime default import of lodash", () => {
    expectFail(`import _ from "lodash";`);
  });

  it("does not flag a type-only import from lodash", () => {
    expectPass(`import type { Dictionary } from "lodash";`);
  });
});
