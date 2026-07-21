import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImgWithoutDimensions } from "./no-img-without-dimensions.js";

describe("no-img-without-dimensions", () => {
  it("respects important Tailwind box sizing over inline dimensions", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Gallery = () => <><img src="a.jpg" className="!w-auto !h-auto" style={{ width: 100, height: 100 }} /><img src="b.jpg" className="!w-10 !h-10" style={{ width: "auto", height: "auto" }} /></>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });
  it("reports an image without reserved space", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Avatar = () => <img src="/avatar.jpg" alt="Ada" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("allows width and height attributes", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Avatar = () => <><img src="/avatar.jpg" alt="Ada" width={96} height={96} /><img src="/photo.jpg" alt="" width="001" height="002" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports dimensions that React or HTML cannot use to reserve a box", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/photo.jpg" alt="" width="" height="auto" />;
       const B = () => <img src="/photo.jpg" alt="" width={null} height={undefined} />;
       const C = () => <img src="/photo.jpg" alt="" width={0} height={0} />;
       const D = () => <img src="/photo.jpg" alt="" width={+Infinity} height={-Infinity} />;
       const E = () => <img src="/photo.jpg" alt="" width={+NaN} height={-NaN} />;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("allows dynamic dimensions because they may reserve a box", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Photo = ({ width, height }) => <img src="/photo.jpg" alt="" width={width} height={height} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows explicit class and inline reservations with a stable axis", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" className="aspect-video w-full" />;
       const B = () => <img src="/avatar.jpg" alt="" className="size-12" />;
       const C = () => <img src="/photo.jpg" alt="" style={{ aspectRatio: "4 / 3", width: "100%" }} />;
       const D = () => <img src="/photo.jpg" alt="" style={{ width: 640, height: 480 }} />;
       const E = () => <img src="/photo.jpg" alt="" className="w-[640px] h-[50vh]" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an image inside a reserved wrapper", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Hero = () => <div className="relative aspect-video"><img className="absolute inset-0" src="/hero.jpg" alt="" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows an image inside a wrapper with an inline reservation", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <div style={{ aspectRatio: "16 / 9" }}><img src="/a.jpg" alt="" /></div>;
       const B = () => <div style={{ height: "12rem" }}><img src="/b.jpg" alt="" /></div>;
       const C = () => <div className="h-48"><img src="/c.jpg" alt="" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer an implicit width for an inline aspect-ratio parent", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Hero = () => <span style={{ aspectRatio: "16 / 9" }}><img src="/hero.jpg" alt="" /></span>;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("uses effective display, positioning, and float when proving a parent ratio box", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <span style={{ display: "block", aspectRatio: "16 / 9" }}><img src="/a.jpg" alt="" /></span>;
       const B = () => <form style={{ aspectRatio: "16 / 9" }}><img src="/b.jpg" alt="" /></form>;
       const C = () => <div style={{ position: "absolute", aspectRatio: "16 / 9" }}><img src="/c.jpg" alt="" /></div>;
       const D = () => <div style={{ display: "inline-block", aspectRatio: "16 / 9" }}><img src="/d.jpg" alt="" /></div>;
       const E = () => <div style={{ float: "left", aspectRatio: "16 / 9" }}><img src="/e.jpg" alt="" /></div>;
       const F = () => <span className="flow-root aspect-video"><img src="/f.jpg" alt="" /></span>;
       const G = () => <div className="inline-block aspect-video"><img src="/g.jpg" alt="" /></div>;
       const H = () => <table style={{ aspectRatio: "16 / 9" }}><img src="/h.jpg" alt="" /></table>;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("reports inline auto sizing because it reserves no preload space", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" style={{ aspectRatio: "auto" }} />;
       const B = () => <img src="/photo.jpg" alt="" style={{ width: "auto", height: "auto" }} />;
       const C = () => <img src="/photo.jpg" alt="" style={{ aspectRatio: "0 / 1" }} />;
       const D = () => <img src="/photo.jpg" alt="" style={{ width: "0px", height: "10px" }} />;
       const E = () => <img src="/photo.jpg" alt="" style={{ width: -1, height: +Infinity }} />;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("requires an image aspect ratio to have one stable axis", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" className="aspect-video" />;
       const B = () => <img src="/photo.jpg" alt="" className="aspect-[0/1] w-full" />;
       const C = () => <img src="/photo.jpg" alt="" style={{ aspectRatio: "4 / 3" }} />;
       const D = () => <img src="/photo.jpg" alt="" className="aspect-[auto] w-full" />;
       const E = () => <img src="/photo.jpg" alt="" className="w-[auto] h-fit" />;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("combines reserved axes across attributes, classes, and inline styles", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" width={640} className="h-80" />;
       const B = () => <img src="/photo.jpg" alt="" height={480} style={{ width: "640px" }} />;
       const C = () => <img src="/photo.jpg" alt="" className="aspect-video" width={640} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("rejects invalid numeric attributes and indefinite percentage heights", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/a.jpg" alt="" width={-1} height={-1} />;
       const B = () => <img src="/b.jpg" alt="" width={NaN} height={Infinity} />;
       const C = () => <img src="/c.jpg" alt="" style={{ width: "100%", height: "100%" }} />;
       const D = () => <img src="/d.jpg" alt="" className="w-full h-full" />;
       const E = () => <img src="/e.jpg" alt="" className="w-1/2 h-1/2" />;`,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("allows positive CSS lengths and fallback aspect ratios", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" style={{ width: "10rem", height: "20px" }} />;
       const B = () => <img src="/photo.jpg" alt="" style={{ aspectRatio: "auto 4 / 3", width: "100%" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("reports Tailwind auto sizing because it reserves no preload space", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" className="aspect-auto" />;
       const B = () => <img src="/photo.jpg" alt="" className="size-auto" />;
       const C = () => <img src="/photo.jpg" alt="" className="w-auto h-auto" />;
       const D = () => <img src="/photo.jpg" alt="" className="aspect-video aspect-auto" />;
       const E = () => <img src="/photo.jpg" alt="" className="w-10 h-10 w-auto" />;
       const F = () => <img src="/photo.jpg" alt="" className="!w-auto w-10 h-10" />;
       const G = () => <img src="/photo.jpg" alt="" className="w-fit h-max" />;
       const H = () => <img src="/photo.jpg" alt="" className="w-min h-[fit-content]" />;
       const I = () => <img src="/photo.jpg" alt="" className="w-[min-content] h-[max-content]" />;
       const J = () => <img src="/photo.jpg" alt="" className="size-[auto]" />;
       const K = () => <img src="/photo.jpg" alt="" className="w-[0px] h-[0rem]" />;`,
    );
    expect(result.diagnostics).toHaveLength(9);
  });

  it("stays conservative for ambiguous Tailwind sizing and accepts important reservations", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" className="aspect-auto aspect-video" />;
       const B = () => <img src="/photo.jpg" alt="" className="w-auto h-auto w-10 h-10" />;
       const C = () => <img src="/photo.jpg" alt="" className="aspect-video aspect-auto" />;
       const D = () => <img src="/photo.jpg" alt="" className="w-10 h-10 w-auto h-auto" />;
       const E = () => <img src="/photo.jpg" alt="" className="!w-10 w-auto h-10" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips display-none images but still checks visibility-hidden layout boxes", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img hidden src="/hero.jpg" alt="" />;
       const B = () => <img className="hidden" src="/photo.jpg" alt="" />;
       const C = () => <img style={{ display: "none" }} src="/photo.jpg" alt="" />;
       const D = () => <img style={{ visibility: "hidden" }} src="/photo.jpg" alt="" />;
       const E = () => <img className="invisible" src="/photo.jpg" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("checks images that become rendered under a Tailwind variant", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img className="hidden md:block" src="/a.jpg" alt="" />;
       const B = () => <img className="hidden hover:inline" src="/b.jpg" alt="" />;
       const C = () => <img className="hidden md:hidden" src="/c.jpg" alt="" />;
       const D = () => <img className="!hidden md:block" src="/d.jpg" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not mistake known non-sizing Tailwind utilities for external CSS boxes", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img className="object-cover rounded-lg" src="/a.jpg" alt="" />;
       const B = () => <img className="block object-contain" src="/b.jpg" alt="" />;
       const C = () => <img className="opacity-50 shadow-lg" src="/c.jpg" alt="" />;
       const D = () => <img className="mx-auto" src="/d.jpg" alt="" />;
       const E = () => <img className="hover:opacity-100 invisible" src="/e.jpg" alt="" />;
       const F = () => <img className="max-w-full h-auto" src="/f.jpg" alt="" />;
       const G = () => <img className="border grayscale" src="/g.jpg" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(7);
  });

  it("keeps opaque custom stylesheet classes conservative in Tailwind projects", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img className="profile-image" src="/a.jpg" alt="" />;
       const B = () => <img className="object-cover profile-image" src="/b.jpg" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("respects effective inline style properties around unknown spreads", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = ({ dimensions }) => <img src="/a.jpg" alt="" style={{ ...dimensions, width: 640, height: 480 }} />;
       const B = ({ dimensions }) => <img src="/b.jpg" alt="" style={{ width: 640, ...dimensions, height: 480 }} />;
       const C = () => <img src="/c.jpg" alt="" style={{ width: 640, height: 480, width: "auto" }} />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("reports empty class values because they cannot supply an external box", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" className="" />;
       const B = () => <img src="/photo.jpg" alt="" className={null} />;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("does not trust a parent reservation that a trailing spread can override", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const Hero = ({ props }) => <div style={{ aspectRatio: "16 / 9" }} {...props}><img src="/hero.jpg" alt="" /></div>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips boxes whose size may come from external or dynamic CSS", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img className="profile-image" src="/photo.jpg" alt="" />;
       const B = () => <div className="hero-frame"><img src="/hero.jpg" alt="" /></div>;
       const C = ({ className, style }) => <img className={className} style={style} src="/photo.jpg" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips spreads and custom image components", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = (props) => <img src="/photo.jpg" alt="" {...props} />;
       const B = () => <Image src="/photo.jpg" alt="" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("skips images rasterized by an imported ImageResponse", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `import { ImageResponse } from "next/og";
       export const GET = () => new ImageResponse(<img src="/logo.png" />);`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
