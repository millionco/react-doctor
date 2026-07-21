export const isTailwindReducedMotionVariant = (variant: string): boolean =>
  variant.split("/")[0] === "motion-reduce";
