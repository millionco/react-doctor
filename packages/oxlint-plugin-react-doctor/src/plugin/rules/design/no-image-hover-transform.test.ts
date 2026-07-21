import { describe, expect, it } from "vite-plus/test";
import { runRule } from "../../../test-utils/run-rule.js";
import { noImageHoverTransform } from "./no-image-hover-transform.js";

describe("no-image-hover-transform", () => {
  it("flags intrinsic images that scale on hover", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <img src="/photo.jpg" alt="Landscape" className="transition-transform hover:scale-105" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags group-hover rotation", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <img src="/photo.jpg" alt="Landscape" className="group-hover:rotate-2" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("flags negative hover transforms while allowing negative neutral resets", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <><img className="hover:-rotate-6" /><img className="group-hover:-scale-x-100" /><img className="hover:-rotate-0" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags stacked responsive and color-mode hover variants", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <><img src="/a.jpg" alt="A" className="md:hover:scale-105" /><img src="/b.jpg" alt="B" className="dark:group-hover:rotate-3" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("flags named group and peer hover variants", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <><img src="/a.jpg" alt="A" className="group-hover/card:scale-105" /><img src="/b.jpg" alt="B" className="peer-hover/item:rotate-2" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("accepts opacity and color hover treatments", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <img src="/photo.jpg" alt="Landscape" className="hover:opacity-90" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not treat arbitrary-value fragments as hover transforms", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <img src="/photo.jpg" alt="Landscape" className="[--effect:x group-hover:scale-105 fallback]" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps conflicting hover transform utilities and important neutral resets quiet", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <><img src="/a.jpg" alt="A" className="hover:scale-105 hover:scale-110" /><img src="/b.jpg" alt="B" className="hover:rotate-3 hover:!rotate-0" /></>;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("resolves hover transforms within their exact variant scope", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <img src="/a.jpg" alt="A" className="group-hover/card:scale-105 group-hover/other:!scale-100" />;`,
    );
    expect(result.diagnostics).toHaveLength(1);
  });

  it("does not infer custom Image component behavior", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <Image src="/photo.jpg" alt="Landscape" className="hover:scale-105" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
