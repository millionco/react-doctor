import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { lang } from "./lang.js";

describe("a11y/lang regressions", () => {
  for (const code of [
    `<html lang="fil" />`,
    `<html lang="haw" />`,
    `<html lang="yue" />`,
    `<html lang="ceb" />`,
    `<html lang="gsw" />`,
    `<html lang="nan" />`,
    `<html lang="hak" />`,
    `<html lang="wuu" />`,
    `<html lang="cmn" />`,
    `<html lang="lzh" />`,
  ]) {
    it(`accepts the valid three-letter ISO-639-2/3 code in ${code}`, () => {
      expect(runRule(lang, code).diagnostics).toEqual([]);
    });
  }

  it("still flags an unknown three-letter primary subtag", () => {
    expect(runRule(lang, `<html lang="foo" />`).diagnostics).toHaveLength(1);
  });

  it("still flags a reserved primary subtag with a region suffix", () => {
    expect(runRule(lang, `<html lang="zz-LL" />`).diagnostics).toHaveLength(1);
  });

  it("still flags a one-letter primary subtag", () => {
    expect(runRule(lang, `<html lang="n" />`).diagnostics).toHaveLength(1);
  });

  it("still flags `lang={undefined}`", () => {
    expect(runRule(lang, `<html lang={undefined} />`).diagnostics).toHaveLength(1);
  });
});
