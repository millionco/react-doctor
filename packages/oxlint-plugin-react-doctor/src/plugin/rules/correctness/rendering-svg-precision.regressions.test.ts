import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { renderingSvgPrecision } from "./rendering-svg-precision.js";

const CODEPEN_ICON_D =
  "M14.777304,4.75062256 L7.77734505,0.0839936563 C7.60939924,-0.0279665065 7.39060662,-0.0279665065 7.22266081,0.0839936563 L0.222701813,4.75062256 Z";

describe("correctness/rendering-svg-precision — regressions", () => {
  it("fires on a hand-maintained icon path with many over-precise tokens in src", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const CodePenIcon = () => (
        <svg viewBox="0 0 15 15" fill="currentColor">
          <path d="${CODEPEN_ICON_D}" />
        </svg>
      );
      `,
      { filename: "/repo/src/icons/CodePenIcon.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fires on an Inkscape uniform-scale matrix that repeats one over-precise factor", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Exported = () => (
        <svg>
          <g transform="matrix(0.26458333,0,0,0.26458333,0,0)">
            <path d="M 0 0 L 10 10 Z" />
          </g>
        </svg>
      );
      `,
      { filename: "/repo/src/exported.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("fires on a machine-exported path with many distinct over-precise coordinates", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Exported = () => (
        <svg>
          <path d="M 10.293847 20.847362 L 30.192837 40.564738 Z" />
        </svg>
      );
      `,
      { filename: "/repo/src/exported.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on Sketch-export transforms whose decimals are all trailing zeros", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const ArrowLeft = () => (
        <svg viewBox="0 0 44 44">
          <g transform="translate(-495.000000, -71.000000)">
            <g transform="translate(495.000000, 71.000000)">
              <g transform="translate(15.000000, 15.000000) scale(-1, -1) translate(-15.000000, -15.000000)">
                <path d="M 10 10 L 20 20 Z" />
              </g>
            </g>
          </g>
        </svg>
      );
      `,
      { filename: "/repo/src/components/arrow-left.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on tokens whose precision past 2 decimals is only zeros", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Glyph = () => (
        <svg>
          <path d="M 12.500000 24.250000 L 8.750000 16.000000 Z" />
        </svg>
      );
      `,
      { filename: "/repo/src/glyph.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("still fires on a transform with genuine sub-pixel precision", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const CheckMark = () => (
        <svg viewBox="0 0 17 13">
          <g transform="translate(179.177408, 36.687816)">
            <polyline points="34.2767388 22 24.797043 31.4796958 21 27.6826527" />
          </g>
        </svg>
      );
      `,
      { filename: "/repo/src/check-mark.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports once per file even when several attributes are over-precise", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const SpinIcon = () => (
        <svg viewBox="0 0 28 28">
          <path d="${CODEPEN_ICON_D}" />
          <path d="${CODEPEN_ICON_D}" />
          <polyline points="34.2767388 22 24.797043 31.4796958 21 27.6826527" />
        </svg>
      );
      `,
      { filename: "/repo/src/spin-icon.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("stays silent on a single stray over-precise token in a hand-written glyph", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Glyph = () => (
        <svg>
          <path d="M 10 10 L 12.333333 14 L 15 15 Z" />
        </svg>
      );
      `,
      { filename: "/repo/src/glyph.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent under /generated/", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Icon = () => (
        <svg>
          <path d="${CODEPEN_ICON_D}" />
        </svg>
      );
      `,
      { filename: "/repo/src/generated/icon.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent under /__generated__/", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Icon = () => (
        <svg>
          <path d="${CODEPEN_ICON_D}" />
        </svg>
      );
      `,
      { filename: "/repo/src/__generated__/icon.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent on vendored icon paths under a .dumi docs-site directory", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const CodePenIcon = () => (
        <svg viewBox="0 0 15 15" fill="currentColor">
          <path d="${CODEPEN_ICON_D}" />
        </svg>
      );
      `,
      { filename: "/repo/.dumi/theme/icons/CodePenIcon.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("stays silent in a .test.tsx file", () => {
    const result = runRule(
      renderingSvgPrecision,
      `
      const Fixture = () => (
        <svg>
          <path d="${CODEPEN_ICON_D}" />
        </svg>
      );
      `,
      { filename: "/repo/src/icon.test.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });
});
