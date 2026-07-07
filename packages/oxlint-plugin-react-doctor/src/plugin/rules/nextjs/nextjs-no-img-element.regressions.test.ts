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

  describe("srcs next/image cannot optimize", () => {
    it("skips a literal blob: src", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Thumb = () => <img src="blob:https://app/123" alt="" />;`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a literal data: src", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Pixel = () => <img src="data:image/png;base64,AAAA" alt="" />;`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a static .svg src (next/image does not optimize SVGs)", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Logo = () => <img src="/app-icon.svg" alt="logo" />;`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a .svg src with a query string", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Logo = () => <img src="/brand/logo.svg?v=2" alt="logo" />;`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a static template-literal .svg src", () => {
      const result = runRule(
        nextjsNoImgElement,
        'export const Logo = () => <img src={`/brand/logo.svg`} alt="logo" />;',
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a template-literal data: src (AI-generated base64 image)", () => {
      const result = runRule(
        nextjsNoImgElement,
        'export const Generated = ({ mediaType, base64 }: { mediaType: string; base64: string }) => <img src={`data:${mediaType};base64,${base64}`} alt="" />;',
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a template-literal src ending in .svg", () => {
      const result = runRule(
        nextjsNoImgElement,
        "export const ProviderLogo = ({ provider }: { provider: string }) => <img src={`https://models.dev/logos/${provider}.svg`} alt={provider} />;",
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips an img without src whose frames are streamed through a ref", () => {
      const result = runRule(
        nextjsNoImgElement,
        `import { useRef } from "react";

        export const Screencast = () => {
          const imgRef = useRef<HTMLImageElement>(null);
          return <img ref={imgRef} alt="agent browser screen" />;
        };`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a static raster src", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Hero = () => <img src="/hero.png" alt="hero" />;`,
      );
      expect(result.diagnostics.length).toBe(1);
    });
  });

  describe("locally generated data/object URL bindings", () => {
    it("skips an identifier src named like a data URL (QR code)", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const TotpSetup = ({ qrDataUrl }: { qrDataUrl: string }) =>
          <img src={qrDataUrl} alt="TOTP QR code" />;`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a member src named like a data URL (streamed thumbnails)", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Tray = ({ frames }: { frames: Array<{ imageDataUrl: string }> }) => (
          <div>{frames.map((frame) => <img key={frame.imageDataUrl} src={frame.imageDataUrl} alt="" />)}</div>
        );`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a dynamic src when the file creates object URLs", () => {
      const result = runRule(
        nextjsNoImgElement,
        `import { useState } from "react";

        export const UploadPreview = ({ file }: { file: File }) => {
          const [previewUrl] = useState(() => URL.createObjectURL(file));
          return <img src={previewUrl} alt="" />;
        };`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips a dynamic src when the file only revokes object URLs in cleanup", () => {
      const result = runRule(
        nextjsNoImgElement,
        `import { useEffect } from "react";

        export const ImagePreview = ({ imageUrl }: { imageUrl: string }) => {
          useEffect(() => () => URL.revokeObjectURL(imageUrl), [imageUrl]);
          return <img src={imageUrl} alt="preview" />;
        };`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags a dynamic remote src in a file without object-URL usage", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Avatar = ({ user }: { user: { avatarUrl: string } }) =>
          <img src={user.avatarUrl} alt="avatar" />;`,
      );
      expect(result.diagnostics.length).toBe(1);
    });
  });

  describe("markdown renderer component overrides", () => {
    it("skips an img override inside a ReactMarkdown components map", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Note = ({ note }) => (
          <ReactMarkdown
            components={{
              img: props => (
                <img {...props} referrerPolicy="no-referrer" loading="lazy" />
              ),
            }}
          >
            {note}
          </ReactMarkdown>
        );`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an img inside an unrelated attribute object", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Card = () => (
          <Widget slots={{ img: () => <img src="/hero.png" alt="" /> }} />
        );`,
      );
      expect(result.diagnostics.length).toBe(1);
    });
  });

  describe("tracking pixels", () => {
    it("skips a scarf.sh analytics pixel", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Nav = () => (
          <img
            referrerPolicy="no-referrer-when-downgrade"
            src="https://static.scarf.sh/a.png?x-pxid=bbc99c42"
          />
        );`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("still flags an ordinary remote photo", () => {
      const result = runRule(
        nextjsNoImgElement,
        `export const Hero = () => <img src="https://cdn.example.com/hero.jpg" alt="hero" />;`,
      );
      expect(result.diagnostics.length).toBe(1);
    });
  });

  describe("email template files", () => {
    it("skips img inside MJML email components", () => {
      const result = runRule(
        nextjsNoImgElement,
        `import { MjmlColumn, MjmlText } from "@faire/mjml-react";

        export default function Footer() {
          return (
            <MjmlColumn>
              <MjmlText><img height={12} width={16} src="https://mailing.run/discord.png" alt="" /></MjmlText>
            </MjmlColumn>
          );
        }`,
      );
      expect(result.diagnostics).toEqual([]);
    });

    it("skips img inside react-email components", () => {
      const result = runRule(
        nextjsNoImgElement,
        `import { Section } from "@react-email/components";

        export const Header = () => (
          <Section><img src="https://cdn.example.com/logo.png" alt="logo" /></Section>
        );`,
      );
      expect(result.diagnostics).toEqual([]);
    });
  });
});
