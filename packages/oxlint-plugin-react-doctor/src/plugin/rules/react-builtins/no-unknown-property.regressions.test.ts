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

    // fp-review: `tw` is all-lowercase with no known camelCase form, so
    // React renders it verbatim since v16 (and twin.macro consumes it at
    // build time in any file) — no longer flagged anywhere.
    it("does not flag tw in ordinary files either", () => {
      const result = runRule(noUnknownProperty, OG_IMAGE_WITH_TW, {
        filename: "/proj/app/page.tsx",
      });
      expect(result.diagnostics).toHaveLength(0);
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

    it("does not flag tw on ordinary JSX in mixed files that also render generated images", () => {
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

      expect(result.diagnostics).toHaveLength(0);
    });
  });

  // FP wave 4: `transform-origin` is a presentation/CSS attribute valid
  // on every transformable SVG element, not just `<rect>`. fp-review
  // PR991 extended the set with `a` / `defs` / gradients / `stop` — per
  // SVG2 the attribute applies to any SVG element and React renders it.
  describe("transform-origin on transformable SVG elements", () => {
    for (const tag of [
      "g",
      "circle",
      "path",
      "svg",
      "use",
      "a",
      "defs",
      "linearGradient",
      "radialGradient",
      "stop",
    ]) {
      it(`does not flag transform-origin on <${tag}>`, () => {
        const result = runRule(noUnknownProperty, `<${tag} transform-origin="center" />`);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(0);
      });
    }

    it("still flags transform-origin on a plain div", () => {
      const result = runRule(noUnknownProperty, `<div transform-origin="center" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // fp-review: ~85% of the rule's false positives were react-three-fiber
  // scene-graph intrinsics (`<mesh position>`, `<meshStandardMaterial
  // emissive>`, `<boxGeometry args>`, …). These are lowercase JSX tags
  // handled by a custom reconciler, not DOM elements, so DOM-property
  // validation never applies. Same mechanism: Electron's `<webview>`.
  describe("non-HTML/SVG lowercase intrinsics (react-three-fiber, Electron)", () => {
    const R3F_SCENE = `
      <group position={[0, 1, 0]}>
        <mesh position={[0, 0, 0]} rotation={[0, Math.PI, 0]} castShadow>
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial emissive="red" emissiveIntensity={2} transparent roughness={0.5} />
        </mesh>
        <pointLight intensity={1.5} distance={10} decay={2} />
        <primitive object={scene} />
      </group>
    `;

    it("does not flag react-three-fiber scene elements", () => {
      const result = runRule(noUnknownProperty, R3F_SCENE);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag Electron webview props", () => {
      const result = runRule(noUnknownProperty, `<webview partition="persist:design" src={url} />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags unknown camelCase props on a real HTML tag", () => {
      const result = runRule(noUnknownProperty, `<div emissiveIntensity={2} />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // fp-review: since React 16, unknown all-lowercase attributes are
  // rendered to the DOM verbatim — library selector hooks
  // (`frimousse-list`, `cmdk-input-wrapper`, `p-id` in exported SVGs),
  // real-but-unlisted attributes (`credentialless`), and compile-time
  // props consumed by JSX pragmas (theme-ui `sx`, emotion `css`,
  // styled-jsx `<style jsx>`). "React ignores this prop" is false for
  // all of them.
  describe("all-lowercase attributes rendered verbatim since React 16", () => {
    for (const [description, code] of [
      ["library selector hook on a button", `<button frimousse-emoji="" onClick={onPick} />`],
      ["library selector hook on an input", `<input frimousse-search="" value={value} />`],
      ["cmdk wrapper attribute", `<div cmdk-input-wrapper="">{children}</div>`],
      ["p-id on exported svg", `<svg p-id="2347" viewBox="0 0 1024 1024" />`],
      ["credentialless iframe", `<iframe credentialless src={url} />`],
      ["theme-ui sx prop", `<div sx={{ color: "primary" }} />`],
      ["emotion css prop", `<code css={{ display: "block" }} />`],
      ["styled-jsx style tag", `<style jsx global>{\`body { margin: 0; }\`}</style>`],
    ] as const) {
      it(`does not flag ${description}`, () => {
        const result = runRule(noUnknownProperty, code);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(0);
      });
    }

    it("still flags lowercase attrs with a known camelCase form", () => {
      const result = runRule(noUnknownProperty, `<div onclick={handler} class="bar" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    });

    it("still flags invalid aria attributes", () => {
      const result = runRule(noUnknownProperty, `<div aria-fake="true" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags reserved data-xml attributes", () => {
      const result = runRule(noUnknownProperty, `<div data-xml-anything="invalid" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // docs-validation 2026-07: hyphenated SVG presentation attributes on SVG
  // elements (`stroke-width` / `clip-rule` on `<path>` in lobe-ui icons)
  // are the actual SVG attribute names. React sets unknown lowercase
  // attributes via setAttribute, so the icons render correctly — "React
  // ignores this prop" was factually wrong (11/12 sampled FPs).
  describe("hyphenated SVG attributes on SVG elements", () => {
    for (const [attribute, tag] of [
      ["stroke-width", "path"],
      ["clip-rule", "path"],
      ["fill-rule", "path"],
      ["stroke-linecap", "line"],
      ["fill-opacity", "circle"],
      ["stop-color", "stop"],
      ["dominant-baseline", "text"],
    ] as const) {
      it(`does not flag ${attribute} on <${tag}>`, () => {
        const result = runRule(noUnknownProperty, `<${tag} ${attribute}="x" />`);
        expect(result.parseErrors).toEqual([]);
        expect(result.diagnostics).toHaveLength(0);
      });
    }

    it("still flags stroke-width on a non-SVG element", () => {
      const result = runRule(noUnknownProperty, `<div stroke-width="2" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags a camelCase typo on an SVG element", () => {
      const result = runRule(noUnknownProperty, `<path strokeWidht="2" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });

    it("still flags hyphenated HTML attribute spellings on HTML elements", () => {
      const result = runRule(noUnknownProperty, `<meta http-equiv="refresh" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(1);
    });
  });

  // fp-review: React attaches synthetic events to any host element —
  // ant-design's Masonry listens for descendant image load/error events
  // on the container div. The per-tag whitelist only applies to
  // non-event attributes like `download` or `fetchPriority`.
  describe("synthetic event handlers on any host element", () => {
    it("does not flag onLoad/onError on a div", () => {
      const result = runRule(
        noUnknownProperty,
        `<div onLoad={handleImageLoad} onError={handleImageError}>{children}</div>`,
      );
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("does not flag media events on a div", () => {
      const result = runRule(noUnknownProperty, `<div onAbort={abort} onEnded={end} />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(0);
    });

    it("still flags tag-restricted non-event attributes", () => {
      const result = runRule(noUnknownProperty, `<div download="foo" fetchPriority="high" />`);
      expect(result.parseErrors).toEqual([]);
      expect(result.diagnostics).toHaveLength(2);
    });
  });
});
