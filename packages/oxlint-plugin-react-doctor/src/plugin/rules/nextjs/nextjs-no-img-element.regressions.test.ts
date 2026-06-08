import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { nextjsNoImgElement } from "./nextjs-no-img-element.js";

describe("nextjs/no-img-element regressions", () => {
  describe("Next.js metadata image route files", () => {
    const PLAIN_IMG = `export default function OG() {
      return <div><img src="/bg.png" /></div>;
    }`;

    it("skips opengraph-image.tsx — JSX rasterized via next/og has no DOM", () => {
      const result = runRule(nextjsNoImgElement, PLAIN_IMG, {
        filename: "/proj/app/opengraph-image.tsx",
      });
      expect(result.diagnostics).toEqual([]);
    });

    it("skips opengraph-image with a numeric suffix", () => {
      const result = runRule(nextjsNoImgElement, PLAIN_IMG, {
        filename: "/proj/app/(marketing)/opengraph-image2.tsx",
      });
      expect(result.diagnostics).toEqual([]);
    });

    it("skips twitter-image.tsx", () => {
      const result = runRule(nextjsNoImgElement, PLAIN_IMG, {
        filename: "/proj/app/twitter-image.tsx",
      });
      expect(result.diagnostics).toEqual([]);
    });

    it("skips icon.tsx and apple-icon.tsx", () => {
      const iconResult = runRule(nextjsNoImgElement, PLAIN_IMG, {
        filename: "/proj/app/icon.tsx",
      });
      const appleResult = runRule(nextjsNoImgElement, PLAIN_IMG, {
        filename: "/proj/app/apple-icon0.tsx",
      });
      expect(iconResult.diagnostics).toEqual([]);
      expect(appleResult.diagnostics).toEqual([]);
    });

    it("still flags plain img in ordinary App Router files", () => {
      const result = runRule(nextjsNoImgElement, PLAIN_IMG, {
        filename: "/proj/app/page.tsx",
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("skips helper JSX in files that render through next/og ImageResponse", () => {
      const result = runRule(
        nextjsNoImgElement,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = () => <div><img src="/bg.png" /></div>;

          export const GET = () => new ImageResponse(<HeroImage />);
        `,
        {
          filename: "/proj/app/api/social-card.tsx",
        },
      );

      expect(result.diagnostics).toEqual([]);
    });
  });
});
