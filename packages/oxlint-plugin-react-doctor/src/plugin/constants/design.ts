export const Z_INDEX_ABSURD_THRESHOLD = 100;

export const INLINE_STYLE_PROPERTY_THRESHOLD = 8;

export const SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX = 3;

export const SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX = 1;

export const SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS = 4;

export const DARK_GLOW_BLUR_THRESHOLD_PX = 4;

export const DARK_BACKGROUND_CHANNEL_MAX = 35;

export const COLOR_CHROMA_THRESHOLD = 30;

export const TINY_TEXT_THRESHOLD_PX = 12;

export const WIDE_TRACKING_THRESHOLD_EM = 0.05;

export const LONG_TRANSITION_DURATION_THRESHOLD_MS = 1000;

export const HEAVY_HEADING_FONT_WEIGHT_MIN = 700;

export const HEADING_TAG_NAMES = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export const HEAVY_HEADING_TAILWIND_WEIGHTS = new Set([
  "font-bold",
  "font-extrabold",
  "font-black",
]);

export const TAILWIND_DEFAULT_PALETTE_NAMES = ["indigo", "gray", "slate"];

// HACK: the canonical Tailwind v3/v4 numeric color stops. Anchoring the
// `design-no-default-tailwind-palette` regex to this exact set (rather
// than `\d{2,3}`) avoids false-positiving on Radix Colors integrations
// that map non-Tailwind stops onto Tailwind utilities (`text-gray-11`,
// `text-gray-12`, `text-gray-10` are Radix scale numbers, not Tailwind
// defaults — flagging them as "the Tailwind template default" is wrong).
export const TAILWIND_DEFAULT_PALETTE_STOPS = [
  "50",
  "100",
  "200",
  "300",
  "400",
  "500",
  "600",
  "700",
  "800",
  "900",
  "950",
];

export const TAILWIND_PALETTE_UTILITY_PREFIXES = [
  "text",
  "bg",
  "border",
  "ring",
  "fill",
  "stroke",
  "from",
  "to",
  "via",
  "decoration",
  "divide",
  "outline",
  "placeholder",
  "caret",
  "accent",
  "shadow",
];

export const VAGUE_BUTTON_LABELS = new Set([
  "continue",
  "submit",
  "ok",
  "okay",
  "click here",
  "here",
  "yes",
  "no",
  "go",
  "done",
]);

export const ELLIPSIS_EXCLUDED_TAG_NAMES = new Set(["code", "pre", "kbd", "samp", "var", "tt"]);

// HACK: trailing boundary uses a LOOKAHEAD `(?=...)` so the whitespace
// between Tailwind tokens isn't consumed. With a consuming `(?:$|\s|:)`
// trailing group, `matchAll` over `"px-4 px-6"` would catch `px-4` plus
// the trailing space, then fail to find a leading `\s` boundary for
// `px-6` because we just ate it — silently skipping the second token.
export const PADDING_HORIZONTAL_AXIS_PATTERN =
  /(?:^|\s)(-?)px-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const PADDING_VERTICAL_AXIS_PATTERN =
  /(?:^|\s)(-?)py-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const SIZE_WIDTH_AXIS_PATTERN = /(?:^|\s)(-?)w-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const SIZE_HEIGHT_AXIS_PATTERN = /(?:^|\s)(-?)h-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/g;

export const FLEX_OR_GRID_DISPLAY_TOKENS = new Set(["flex", "inline-flex", "grid", "inline-grid"]);

export const SPACE_AXIS_PATTERN = /(?:^|\s)(?:-)?space-(x|y)-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/;

export const TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN = /[A-Za-z]\.\.\./;
