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

  it("keeps neutral arbitrary-value hover transforms quiet", () => {
    const result = runRule(
      noImageHoverTransform,
      `const Card = () => <><img className="hover:scale-[1]" /><img className="hover:scale-[100%]" /><img className="hover:rotate-[0deg]" /></>;`,
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

  it("flags import-proven Motion images with static hover scale or rotation", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import { motion } from "framer-motion";
        import { m as animated } from "motion/react";

        const Gallery = () => (
          <>
            <motion.img src="/a.jpg" whileHover={{ scale: 1.05 }} />
            <animated.img src="/b.jpg" whileHover={{ rotateZ: -2 }} />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(2);
  });

  it("supports proven Motion image namespaces, tag imports, and factory aliases", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import * as Motion from "motion/react";
        import * as MotionTags from "motion/react-m";
        import { img as ImportedMotionImage } from "framer-motion/m";

        const MemberMotionImage = Motion.motion.img;
        const CreatedMotionImage = Motion.motion.create("img");
        const Examples = () => (
          <>
            <Motion.motion.img whileHover={{ scaleX: 1.1 }} />
            <MotionTags.img whileHover={{ rotate: 1 }} />
            <ImportedMotionImage whileHover={{ scaleY: 0.95 }} />
            <MemberMotionImage whileHover={{ rotateY: 3 }} />
            <CreatedMotionImage whileHover={{ scale: 1.2 }} />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(5);
  });

  it("accepts neutral, dynamic, and finite keyframe Motion transforms", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import { motion } from "motion/react";

        const Examples = ({ hover, scale }) => (
          <>
            <motion.img whileHover={{ scale: 1, rotate: 0 }} />
            <motion.img whileHover={{ scale, rotate: getRotation() }} />
            <motion.img whileHover={hover} />
            <motion.img whileHover={{ scale: [1, 1.1, 1], rotate: [0, 2, 0] }} />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("accepts product zoom, gallery, crop, and drag contexts with source evidence", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import { motion } from "framer-motion";

        const Examples = () => (
          <>
            <motion.img data-product-zoom whileHover={{ scale: 1.5 }} />
            <section aria-label="Product image gallery">
              <motion.img whileHover={{ scale: 1.1 }} />
            </section>
            <ImageCropper>
              <motion.img whileHover={{ rotate: 2 }} />
            </ImageCropper>
            <motion.img drag="x" whileHover={{ scale: 1.05 }} />
            <motion.img drag={false} draggable={isDraggable} whileHover={{ scale: 1.05 }} />
            <motion.img onDrag={handleDrag} whileHover={{ rotate: 2 }} />
            <ProductGallery>
              <img className="hover:scale-105" />
            </ProductGallery>
            <img data-product-zoom className="hover:rotate-2" />
            <img onDrag={handleDrag} className="hover:scale-105" />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("does not infer a drag or gallery context from inactive or unrelated evidence", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import { motion } from "motion/react";

        const Examples = () => (
          <>
            <motion.img drag={false} whileHover={{ scale: 1.05 }} />
            <motion.img draggable="false" whileHover={{ scale: 1.05 }} />
            <motion.img data-product-zoom={false} whileHover={{ scale: 1.05 }} />
            <motion.img onDrag={undefined} whileHover={{ scale: 1.05 }} />
            <figure className="photography">
              <motion.img whileHover={{ rotate: 2 }} />
            </figure>
            <img data-product-zoom={false} className="hover:scale-105" />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(6);
  });

  it("accepts non-image Motion elements and unresolved lookalikes", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import { motion } from "motion/react";
        import { motion as localMotion } from "./animation";
        import { img as LocalMotionImage } from "./motion-tags";

        const Examples = () => (
          <>
            <motion.div whileHover={{ scale: 1.05 }} />
            <motion.picture whileHover={{ rotate: 2 }} />
            <localMotion.img whileHover={{ scale: 1.05 }} />
            <LocalMotionImage whileHover={{ rotate: 2 }} />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });

  it("keeps Motion hover objects with unresolved effective values quiet", () => {
    const result = runRule(
      noImageHoverTransform,
      `
        import { motion } from "motion/react";

        const Examples = ({ hover, props }) => (
          <>
            <motion.img whileHover={{ scale: 1.05, ...hover }} />
            <motion.img whileHover={{ rotate: 2 }} {...props} />
          </>
        );
      `,
    );
    expect(result.diagnostics).toHaveLength(0);
  });
});
