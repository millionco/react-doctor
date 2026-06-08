import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noUnknownProperty } from "./no-unknown-property.js";

describe("react-builtins/no-unknown-property — regressions", () => {
  // Bugbot review: `onGotPointerCapture` (bubbling handler) was missing
  // from DOM_PROPERTY_NAMES even though `onGotPointerCaptureCapture`
  // was present, producing false positives on the bubbling form.
  it("does not flag onGotPointerCapture", () => {
    const result = runRule(noUnknownProperty, `<div onGotPointerCapture={x} />`);
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  describe("Next.js metadata image route files (tw attribute)", () => {
    const OG_IMAGE_WITH_TW = `<div tw="flex flex-col">Hello</div>`;

    it("does not flag tw in opengraph-image.tsx", () => {
      const result = runRule(noUnknownProperty, OG_IMAGE_WITH_TW, {
        filename: "/proj/app/opengraph-image.tsx",
      });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag tw in twitter-image.tsx", () => {
      const result = runRule(noUnknownProperty, OG_IMAGE_WITH_TW, {
        filename: "/proj/app/twitter-image.tsx",
      });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag tw in opengraph-image with numeric suffix", () => {
      const result = runRule(noUnknownProperty, OG_IMAGE_WITH_TW, {
        filename: "/proj/app/opengraph-image2.tsx",
      });
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags tw in ordinary files", () => {
      const result = runRule(noUnknownProperty, OG_IMAGE_WITH_TW, {
        filename: "/proj/app/page.tsx",
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("does not flag tw in files that render through ImageResponse", () => {
      const result = runRule(
        noUnknownProperty,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = () => <div tw="flex flex-col">Hello</div>;

          export const GET = () => new ImageResponse(<HeroImage />);
        `,
        {
          filename: "/proj/app/api/social-card.tsx",
        },
      );

      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags tw on ordinary JSX in mixed files that also render generated images", () => {
      const result = runRule(
        noUnknownProperty,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = () => <div tw="flex flex-col">Hello</div>;

          export const GET = () => new ImageResponse(<HeroImage />);

          export const Page = () => <main tw="flex">Hello</main>;
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toHaveLength(1);
    });
  });
});
