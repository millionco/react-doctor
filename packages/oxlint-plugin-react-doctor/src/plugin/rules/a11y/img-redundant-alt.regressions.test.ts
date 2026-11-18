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

  const curatedSettings = { "react-doctor": { portedRuleMode: "curated" } };

  it.each([
    '`Photo${"synthesis"} in a leaf`',
    "`Photo\\\nsynthesis in a leaf`",
    "`Photo\\u0073ynthesis in a leaf`",
    "`Photo${`synthesis`} in a leaf`",
  ])("checks word boundaries in complete cooked template alt text", (alt) => {
    const source = `const Preview = () => <img src="/leaf.png" alt={${alt}} />;`;
    const curated = runRule(imgRedundantAlt, source, { settings: curatedSettings });
    const upstream = runRule(imgRedundantAlt, source, {
      settings: { "react-doctor": { portedRuleMode: "upstream" } },
    });
    expect(curated.parseErrors).toEqual([]);
    expect(curated.diagnostics).toHaveLength(0);
    expect(upstream.parseErrors).toEqual([]);
    expect(upstream.diagnostics).toHaveLength(1);
  });

  it.each([
    '`Photo${""} of a leaf`',
    "`Photo\\u0020of a leaf`",
    '`Photo${" of a leaf"}`',
    "`Photo${name}`",
    '`Photo${"synthesis"} ${name}`',
  ])(
    "keeps raw template findings when rendered text still has a redundant word or is unknown",
    (alt) => {
      const result = runRule(
        imgRedundantAlt,
        `const Preview = ({ name }) => <img src="/leaf.png" alt={${alt}} />;`,
        { settings: curatedSettings },
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    },
  );

  it("leaves missing and empty alt values quiet", () => {
    const result = runRule(
      imgRedundantAlt,
      `const Preview = () => <>
        <img src="/leaf.png" />
        <img src="/leaf.png" alt={\`\`} />
      </>;`,
      { settings: curatedSettings },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not flag redundant words joined by hyphens or underscores", () => {
    const result = runRule(
      imgRedundantAlt,
      `export const Page = () => (
        <div>
          <img src="/a.png" alt="image-left-top" />
          <img src="/b.png" alt="my_image_1" />
        </div>
      );`,
      { filename: "/proj/app/page.tsx" },
    );

    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a redundant word separated by spaces", () => {
    const result = runRule(
      imgRedundantAlt,
      `export const Page = () => <img src="/a.png" alt="image of a cat" />;`,
      { filename: "/proj/app/page.tsx" },
    );

    expect(result.diagnostics).toHaveLength(1);
  });
});
