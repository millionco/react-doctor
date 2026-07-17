const CSS_LAYOUT_PROPERTIES = [
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "inline-size",
  "min-inline-size",
  "max-inline-size",
  "block-size",
  "min-block-size",
  "max-block-size",
  "top",
  "left",
  "right",
  "bottom",
  "inset",
  "inset-block",
  "inset-inline",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "padding-block",
  "padding-inline",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "margin-block",
  "margin-inline",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-block-width",
  "border-inline-width",
  "font-size",
  "line-height",
  "gap",
  "row-gap",
  "column-gap",
  "column-width",
];

export const LAYOUT_PROPERTIES = new Set([
  ...CSS_LAYOUT_PROPERTIES,
  ...CSS_LAYOUT_PROPERTIES.map((propertyName) =>
    propertyName.replace(/-([a-z])/g, (_hyphenatedLetter, letter) => letter.toUpperCase()),
  ),
]);

export const MOTION_ANIMATE_PROPS = new Set([
  "animate",
  "initial",
  "exit",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileDrag",
  "whileInView",
]);

export const LARGE_BLUR_THRESHOLD_PX = 10;
export const BLUR_VALUE_PATTERN = /blur\((\d+(?:\.\d+)?)px\)/;
export const ANIMATION_CALLBACK_NAMES = new Set(["requestAnimationFrame", "setInterval"]);
export const MOTION_LIBRARY_PACKAGES = new Set(["framer-motion", "motion"]);

export const BOUNCE_ANIMATION_NAMES = new Set(["bounce", "elastic", "wobble", "jiggle", "spring"]);
