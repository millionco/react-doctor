const SVG_LAYOUT_TRANSITION_EXEMPT_ELEMENT_NAMES = new Set([
  "svg",
  "g",
  "rect",
  "circle",
  "ellipse",
  "image",
  "line",
  "path",
  "polygon",
  "polyline",
  "text",
  "tspan",
  "textPath",
  "use",
  "marker",
  "mask",
  "pattern",
  "symbol",
  "defs",
  "clipPath",
  "linearGradient",
  "radialGradient",
  "stop",
  "filter",
]);

export const isSvgLayoutTransitionExemptElementName = (elementName: string): boolean =>
  SVG_LAYOUT_TRANSITION_EXEMPT_ELEMENT_NAMES.has(elementName);
