import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { altText } from "./alt-text.js";

describe("a11y/alt-text regressions", () => {
  const imageAliasSettings = {
    "react-doctor": {
      altText: {
        img: ["Image"],
      },
    },
  };

  describe("Next.js metadata image route files", () => {
    const IMG_WITHOUT_ALT = `export default function OG() {
      return <div><img src="/bg.png" /></div>;
    }`;

    it("skips opengraph-image.tsx — JSX rasterized via next/og has no DOM", () => {
      const result = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/opengraph-image.tsx",
      });
      expect(result.diagnostics).toEqual([]);
    });

    it("skips opengraph-image with a numeric suffix", () => {
      const result = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/(marketing)/opengraph-image2.tsx",
      });
      expect(result.diagnostics).toEqual([]);
    });

    it("skips twitter-image.tsx", () => {
      const result = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/twitter-image.tsx",
      });
      expect(result.diagnostics).toEqual([]);
    });

    it("skips icon.tsx and apple-icon.tsx", () => {
      const iconResult = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/icon.tsx",
      });
      const appleResult = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/apple-icon0.tsx",
      });
      expect(iconResult.diagnostics).toEqual([]);
      expect(appleResult.diagnostics).toEqual([]);
    });

    it("skips the .jsx / .js / .ts extensions allowed by the convention", () => {
      for (const filename of [
        "/proj/app/opengraph-image.jsx",
        "/proj/app/opengraph-image.js",
        "/proj/app/opengraph-image.ts",
      ]) {
        const result = runRule(altText, IMG_WITHOUT_ALT, { filename });
        expect(result.diagnostics, filename).toEqual([]);
      }
    });

    it("does NOT skip files whose basenames merely embed the convention names", () => {
      const result = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/my-opengraph-image.tsx",
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags missing alt in ordinary App Router files", () => {
      const result = runRule(altText, IMG_WITHOUT_ALT, {
        filename: "/proj/app/page.tsx",
      });
      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });

  describe("generated image renderer calls", () => {
    it("skips helper JSX in files that render through next/og ImageResponse", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = () => <div><img src="/bg.png" /></div>;

          export const GET = () => new ImageResponse(<HeroImage />);
        `,
        {
          filename: "/proj/app/api/og/route.tsx",
        },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("skips helper JSX in files that render through a renamed ImageResponse import", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse as OgImageResponse } from "next/og";

          const HeroImage = () => <div><img src="/bg.png" /></div>;

          export const GET = () => new OgImageResponse(<HeroImage />);
        `,
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("skips helper JSX in files that render through @vercel/og ImageResponse", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "@vercel/og";

          const HeroImage = () => <div><img src="/bg.png" /></div>;

          export const GET = () => new ImageResponse(<HeroImage />);
        `,
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("skips Image aliases in files that render through satori", () => {
      const result = runRule(
        altText,
        `
          import renderImage from "satori";

          const Badge = () => <Image src="/badge.png" />;

          export const render = () => renderImage(<Badge />);
        `,
        {
          filename: "/proj/app/api/social-card.tsx",
          settings: imageAliasSettings,
        },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("still flags img in ordinary page components", () => {
      const result = runRule(
        altText,
        `export const Page = () => <div><img src="/bg.png" /></div>;`,
        {
          filename: "/proj/app/page.tsx",
        },
      );

      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags ordinary /og pages without generated-image renderer calls", () => {
      const result = runRule(
        altText,
        `export const Page = () => <div><img src="/bg.png" /></div>;`,
        {
          filename: "/proj/app/og/page.tsx",
        },
      );

      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("still flags ordinary JSX in mixed files that also render generated images", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = () => <div><img src="/og.png" /></div>;

          export const GET = () => new ImageResponse(<HeroImage />);

          export const Page = () => <main><img src="/page.png" /></main>;
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags shared helper components used by normal UI", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const SharedImage = () => <div><img src="/shared.png" /></div>;

          export const GET = () => new ImageResponse(<SharedImage />);

          export const Page = () => <main><SharedImage /></main>;
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toHaveLength(1);
    });

    it("skips conditional helper JSX returned only through ImageResponse", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = ({ enabled }) => enabled ? <img src="/enabled.png" /> : <img src="/disabled.png" />;

          export const GET = () => new ImageResponse(<HeroImage enabled />);
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("skips logical helper JSX returned only through ImageResponse", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const HeroImage = ({ enabled }) => enabled && <img src="/enabled.png" />;

          export const GET = () => new ImageResponse(<HeroImage enabled />);
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("skips JSX returned by helper calls passed to ImageResponse", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const buildHeroImage = () => <div><img src="/hero.png" /></div>;

          export const GET = () => new ImageResponse(buildHeroImage());
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toEqual([]);
    });

    it("still flags helper calls when the helper is also rendered as normal JSX", () => {
      const result = runRule(
        altText,
        `
          import { ImageResponse } from "next/og";

          const SharedImage = () => <div><img src="/shared.png" /></div>;

          export const GET = () => new ImageResponse(SharedImage());

          export const Page = () => <main><SharedImage /></main>;
        `,
        {
          filename: "/proj/app/social-card.tsx",
        },
      );

      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags Image aliases in ordinary page components", () => {
      const result = runRule(
        altText,
        `
          import Image from "next/image";

          export const Page = () => <Image src="/hero.png" />;
        `,
        {
          filename: "/proj/app/page.tsx",
          settings: imageAliasSettings,
        },
      );

      expect(result.diagnostics.length).toBeGreaterThan(0);
    });

    it("does not trust locally named ImageResponse values", () => {
      const result = runRule(
        altText,
        `
          const ImageResponse = (children) => children;

          export const Page = () => <div><img src="/bg.png" /></div>;

          ImageResponse(<Page />);
        `,
      );

      expect(result.diagnostics.length).toBeGreaterThan(0);
    });
  });
});
