import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUndeferredThirdParty } from "./no-undeferred-third-party.js";

const expectFail = (code: string): void => {
  const result = runRule(noUndeferredThirdParty, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics.length).toBeGreaterThan(0);
};

const expectPass = (code: string): void => {
  const result = runRule(noUndeferredThirdParty, code);
  expect(result.parseErrors).toEqual([]);
  expect(result.diagnostics).toHaveLength(0);
};

describe("bundle-size/no-undeferred-third-party — regressions", () => {
  it("flags a classic blocking `<script src>`", () => {
    expectFail(`const W = () => <script src="https://cdn.example.com/w.js" />;`);
  });

  it('does not flag a `type="module"` script (deferred by default)', () => {
    expectPass(`const W = () => <script type="module" src="https://cdn.example.com/w.js" />;`);
  });
});
