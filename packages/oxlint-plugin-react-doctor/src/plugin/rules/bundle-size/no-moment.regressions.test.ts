import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noMoment } from "./no-moment.js";

const expectFail = (code: string): void => {
  const result = runRule(noMoment, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noMoment, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("bundle-size/no-moment — regressions", () => {
  it("flags a runtime default import of moment", () => {
    expectFail(`import moment from "moment";`);
  });

  it("does not flag a type-only import from moment", () => {
    expectPass(`import type { Moment } from "moment";`);
  });
});
