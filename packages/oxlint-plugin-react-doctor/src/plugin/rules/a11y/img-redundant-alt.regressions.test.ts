import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { imgRedundantAlt } from "./img-redundant-alt.js";

describe("a11y/img-redundant-alt regressions", () => {
  const imageAliasSettings = {
    "react-doctor": {
      imgRedundantAlt: {
        components: ["Image"],
      },
    },
  };

  it("skips redundant alt wording in Next.js metadata image route files", () => {
    const result = runRule(
      imgRedundantAlt,
      `export default function OG() {
        return <div><img src="/bg.png" alt="Image of a product card" /></div>;
      }`,
      {
        filename: "/proj/app/opengraph-image.tsx",
      },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips helper JSX in files that render through next/og ImageResponse", () => {
    const result = runRule(
      imgRedundantAlt,
      `
        import * as NextOg from "next/og";

        const HeroImage = () => <img src="/bg.png" alt="Image of a product card" />;

        export const GET = () => new NextOg.ImageResponse(<HeroImage />);
      `,
      {
        filename: "/proj/app/api/social-card.tsx",
      },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("skips Image aliases in files that render through satori", () => {
    const result = runRule(
      imgRedundantAlt,
      `
        import satori from "satori";

        const Badge = () => <Image src="/badge.png" alt="Photo of a badge" />;

        export const render = () => satori(<Badge />);
      `,
      {
        filename: "/proj/app/api/social-card.tsx",
        settings: imageAliasSettings,
      },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still flags redundant img alt wording in ordinary page components", () => {
    const result = runRule(
      imgRedundantAlt,
      `export const Page = () => <img src="/bg.png" alt="Image of a product card" />;`,
      {
        filename: "/proj/app/page.tsx",
      },
    );

    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("still flags redundant Image alt wording in ordinary page components", () => {
    const result = runRule(
      imgRedundantAlt,
      `
        import Image from "next/image";

        export const Page = () => <Image src="/hero.png" alt="Photo of the hero" />;
      `,
      {
        filename: "/proj/app/page.tsx",
        settings: imageAliasSettings,
      },
    );

    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
