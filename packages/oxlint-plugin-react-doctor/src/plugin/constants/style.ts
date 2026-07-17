export const LAYOUT_TRANSITION_PROPERTIES = new Set([
  "width",
  "height",
  "min-width",
  "max-width",
  "min-height",
  "max-height",
  "top",
  "right",
  "bottom",
  "left",
  "padding",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "margin",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "border-width",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "line-height",
  "column-width",
]);

export const LAYOUT_PROPERTIES = new Set([
  "width",
  "height",
  "top",
  "left",
  "right",
  "bottom",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "borderWidth",
  "fontSize",
  "lineHeight",
  "gap",
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
