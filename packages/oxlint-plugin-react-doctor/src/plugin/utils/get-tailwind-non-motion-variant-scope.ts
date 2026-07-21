import { isTailwindMotionSafeVariant } from "./is-tailwind-motion-safe-variant.js";
import { isTailwindReducedMotionVariant } from "./is-tailwind-reduced-motion-variant.js";

export const getTailwindNonMotionVariantScope = (variants: ReadonlyArray<string>): string[] =>
  variants.filter(
    (variant) => !isTailwindReducedMotionVariant(variant) && !isTailwindMotionSafeVariant(variant),
  );
