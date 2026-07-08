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

  it("still flags a scheme-relative external script", () => {
    expectFail(`const W = () => <script src="//cdn.example.com/w.js" />;`);
  });

  // FP anchor (openflipbook theme-init, hyperdx __ENV, gatsby dev scripts):
  // a first-party path is not a third-party script.
  it("does not flag a first-party root-relative script", () => {
    expectPass(`const L = () => <head><script src="/theme-init.js" /></head>;`);
  });

  it("does not flag a first-party relative script", () => {
    expectPass(`const L = () => <head><script src="./env.js" /></head>;`);
  });

  // FP anchor (gatsby polyfill emission): `noModule` scripts never execute
  // in modern browsers and legacy browsers need them before the bundles.
  it("does not flag a noModule polyfill script", () => {
    expectPass(`const B = ({ path }) => <script key={path} src={path} noModule={true} />;`);
  });
});
