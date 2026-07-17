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

  it("accepts opacity and color hover treatments", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <img src="/photo.jpg" alt="Landscape" className="hover:opacity-90" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer custom Image component behavior", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <Image src="/photo.jpg" alt="Landscape" className="hover:scale-105" />;`,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
