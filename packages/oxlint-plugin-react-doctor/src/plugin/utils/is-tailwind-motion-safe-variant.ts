export const isTailwindMotionSafeVariant = (variant: string): boolean =>
  variant.split("/")[0] === "motion-safe";
