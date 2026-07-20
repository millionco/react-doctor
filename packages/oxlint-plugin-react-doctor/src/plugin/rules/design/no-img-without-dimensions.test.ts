import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImgWithoutDimensions } from "./no-img-without-dimensions.js";

describe("no-img-without-dimensions", () => {
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
      `const Avatar = () => <img src="/avatar.jpg" alt="Ada" width={96} height={96} />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("allows explicit class and inline reservations", () => {
    const result = runRule(
      noImgWithoutDimensions,
      `const A = () => <img src="/hero.jpg" alt="" className="aspect-video w-full" />;
       const B = () => <img src="/avatar.jpg" alt="" className="size-12" />;
       const C = () => <img src="/photo.jpg" alt="" style={{ aspectRatio: "4 / 3", width: "100%" }} />;
       const D = () => <img src="/photo.jpg" alt="" style={{ width: 640, height: 480 }} />;`,
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
});
