// rule: window-open-without-noopener
// weakness: opaque-feature-interpolation
export const openWithAmbiguousFeatures = (destination: string, middle: string) => {
  window.open(destination, "_blank", `no${middle}opener`);
};
