import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noInlineExhaustiveStyle } from "./no-inline-exhaustive-style.js";

describe("design/no-inline-exhaustive-style regressions", () => {
  // OG components style everything inline because Satori (next/og,
  // @vercel/og) supports no other styling channel and rasterizes the JSX
  // to a static image — so the "rebuilds every render" cost never applies.
  const EXHAUSTIVE_OG_STYLE = `export default function OG() {
    return (
      <div
        style={{
          display: "flex",
          width: "100%",
          height: "100%",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          backgroundColor: "white",
          fontSize: 64,
          color: "black",
        }}
      >
        Hello
      </div>
    );
  }`;

  it("skips opengraph-image.tsx — exhaustive inline styles are required by Satori", () => {
    const result = runRule(noInlineExhaustiveStyle, EXHAUSTIVE_OG_STYLE, {
      filename: "/proj/app/opengraph-image.tsx",
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("skips twitter-image.tsx and icon.tsx metadata routes", () => {
    const twitter = runRule(noInlineExhaustiveStyle, EXHAUSTIVE_OG_STYLE, {
      filename: "/proj/app/twitter-image.tsx",
    });
    const icon = runRule(noInlineExhaustiveStyle, EXHAUSTIVE_OG_STYLE, {
      filename: "/proj/app/icon.tsx",
    });
    expect(twitter.diagnostics).toEqual([]);
    expect(icon.diagnostics).toEqual([]);
  });

  it("skips helper JSX in files that render through next/og ImageResponse", () => {
    const result = runRule(
      noInlineExhaustiveStyle,
      `
        import { ImageResponse } from "next/og";

        const Card = () => (
          <div
            style={{
              display: "flex",
              width: 1200,
              height: 630,
              alignItems: "center",
              justifyContent: "center",
              flexDirection: "column",
              backgroundColor: "white",
              fontSize: 64,
            }}
          >
            Card
          </div>
        );

        export const GET = () => new ImageResponse(<Card />);
      `,
      { filename: "/proj/app/api/social-card.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips inline JSX passed directly to satori()", () => {
    const result = runRule(
      noInlineExhaustiveStyle,
      `
        import satori from "satori";

        export const render = () =>
          satori(
            <div
              style={{
                display: "flex",
                width: 1200,
                height: 630,
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                backgroundColor: "black",
                color: "white",
              }}
            >
              Hi
            </div>,
            { width: 1200, height: 630 },
          );
      `,
      { filename: "/proj/lib/og.tsx" },
    );
    expect(result.diagnostics).toEqual([]);
  });

  it("skips a floating-ui positioning style dominated by runtime coordinates", () => {
    const result = runRule(
      noInlineExhaustiveStyle,
      `
        const Menu = ({ floatingProps }) => (
          <div
            style={{
              position: floatingProps.strategy,
              top: floatingProps.y ?? 0,
              left: floatingProps.x ?? 0,
              minWidth: 120,
              width: "max-content",
              maxWidth: 320,
              zIndex: 1,
              pointerEvents: "auto",
            }}
          />
        );
      `,
      { filename: "/proj/src/menu.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("skips an editor style whose values are computed from props and state", () => {
    const result = runRule(
      noInlineExhaustiveStyle,
      `
        const Editor = ({ style, fontSize, lineHeight, paddingTop, paddingBottom, wrap }) => (
          <pre
            style={{
              ...style,
              background: "transparent",
              fontFamily: MONO_FONT_FAMILY,
              fontSize,
              lineHeight: \`\${lineHeight}px\`,
              margin: 0,
              minHeight: "100%",
              padding: \`\${paddingTop}px 16px \${paddingBottom}px 16px\`,
              whiteSpace: wrap ? "pre-wrap" : "pre",
              wordBreak: wrap ? "break-word" : "normal",
            }}
          />
        );
      `,
      { filename: "/proj/src/editor.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toEqual([]);
  });

  it("still flags a big static style even when it uses negative and template values", () => {
    const result = runRule(
      noInlineExhaustiveStyle,
      `
        const Overlay = () => (
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: "50%",
              marginLeft: -20,
              width: 3,
              background: "rgba(255,255,255,0.9)",
              boxShadow: \`0 0 4px rgba(0,0,0,0.5)\`,
              transform: "translateX(-50%)",
              pointerEvents: "none",
            }}
          />
        );
      `,
      { filename: "/proj/src/overlay.tsx" },
    );
    expect(result.parseErrors).toEqual([]);
    expect(result.diagnostics).toHaveLength(1);
  });

  it("still flags an exhaustive inline style in an ordinary component file", () => {
    const result = runRule(noInlineExhaustiveStyle, EXHAUSTIVE_OG_STYLE, {
      filename: "/proj/app/page.tsx",
    });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain("inline style");
  });
});
