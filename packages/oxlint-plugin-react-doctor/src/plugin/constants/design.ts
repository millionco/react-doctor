// Tightened to 1000 (was 100) — many design systems use a 100-step
// scale (`dropdown: 100`, `modal: 500`, `toast: 900`) which is a
// deliberate token system, not the `z-index: 9999` "escape hatch"
// the rule actually targets. Values above 1000 are almost always the
// "go on top of everything" escalation antipattern.
export const Z_INDEX_ABSURD_THRESHOLD = 1000;

export const INLINE_STYLE_PROPERTY_THRESHOLD = 8;

export const ONE_SECOND_MS = 1000;

export const POSITIVE_TRANSITION_DURATION_EVIDENCE_MS = 1;

export const SIDE_TAB_BORDER_WIDTH_WITHOUT_RADIUS_PX = 3;

export const SIDE_TAB_BORDER_WIDTH_WITH_RADIUS_PX = 1;

export const SIDE_TAB_TAILWIND_WIDTH_WITHOUT_RADIUS = 4;

export const DARK_GLOW_BLUR_THRESHOLD_PX = 4;

export const DARK_BACKGROUND_CHANNEL_MAX = 35;

export const COLOR_CHROMA_THRESHOLD = 30;

export const TINY_TEXT_THRESHOLD_PX = 12;

export const TINY_UPPERCASE_TRACKED_LABEL_MAX_PX = 11;

export const MINIMUM_TARGET_SIZE_PX = 24;

// WCAG 2.1 contrast minimums. Normal text needs 4.5:1; "large" text
// (>=24px regular, or >=18.66px / 14pt bold) and icons need 3:1.
export const WCAG_CONTRAST_NORMAL_MIN = 4.5;
export const WCAG_CONTRAST_LARGE_MIN = 3;
export const LARGE_TEXT_MIN_PX = 24;
export const LARGE_BOLD_TEXT_MIN_PX = 18.66;
export const BOLD_FONT_WEIGHT_MIN = 700;

// Browser default root font size — the px-per-rem divisor for converting
// arbitrary `px` font sizes and `rem` lengths to and from pixels.
export const ROOT_FONT_SIZE_PX = 16;

export const WIDE_TRACKING_THRESHOLD_EM = 0.05;

export const CRUSHED_TRACKING_THRESHOLD_EM = -0.08;

export const TIGHT_LINE_HEIGHT_RATIO = 1.3;

export const DISPLAY_TEXT_MIN_FONT_SIZE_PX = 24;

export const LONG_BODY_TEXT_MIN_CHARACTERS = 48;

export const READABLE_LINE_LENGTH_MAX_CH = 80;

export const LONG_DISPLAY_HEADING_MIN_CHARACTERS = 40;

export const OVERSIZED_DISPLAY_HEADING_MIN_PX = 64;

export const SHORT_DECORATIVE_LABEL_MAX_CHARACTERS = 32;

export const REPEATED_DECORATIVE_LABEL_MIN_COUNT = 3;

export const MIN_BOUNDED_CONTAINER_PADDING_PX = 8;

export const TAILWIND_PADDING_SHORTHAND_SPECIFICITY_RANK = 0;

export const TAILWIND_PADDING_AXIS_SPECIFICITY_RANK = 1;

export const TAILWIND_PADDING_SIDE_SPECIFICITY_RANK = 2;

export const WIDE_SHADOW_BLUR_MIN_PX = 16;

export const COMMON_UI_FONT_FAMILIES = new Set([
  "arial",
  "geist",
  "helvetica",
  "inter",
  "lato",
  "montserrat",
  "open sans",
  "plus jakarta sans",
  "roboto",
  "space grotesk",
]);

export const MIN_PAGE_TYPE_SCALE_RATIO = 2;

export const PAGE_TYPE_SCALE_MIN_STEPS = 3;

export const PAGE_SPACING_MIN_SAMPLES = 12;

export const PAGE_SPACING_DOMINANT_RATIO = 0.67;

export const PAGE_SPACING_MAX_DISTINCT_VALUES = 4;

export const TAILWIND_SPACING_UNIT_PX = 4;

export const MANUFACTURED_COPY_PATTERN_MIN_COUNT = 3;

export const DECORATIVE_GRID_MIN_GRADIENT_LAYERS = 2;

export const DECORATIVE_BLUR_ORB_MIN_BLUR_PX = 24;

export const REPEATED_GLASS_SURFACE_MIN_COUNT = 3;

export const EXCESSIVE_PILL_TREATMENT_MIN_COUNT = 5;

export const UNIFORM_FEATURE_CARD_MIN_COUNT = 3;

export const CENTERED_COPY_MIN_COUNT = 3;

export const CENTERED_COPY_MIN_CHARACTERS = 48;

export const REPEATED_EMOJI_TILE_MIN_COUNT = 3;

export const GENERIC_ICON_GRADIENT_MAX_SIZE_SPACING_UNITS = 16;

export const EXCESSIVE_MOTION_STAGGER_SECONDS = 0.08;

export const CENTERED_HERO_MAX_STATIC_ELEMENTS = 12;

export const EXCESSIVE_CARD_SURFACE_MIN_COUNT = 6;

export const REPEATED_SECTION_SHELL_MIN_COUNT = 3;

export const OVERLOADED_HOVER_PROPERTY_MIN_COUNT = 3;

export const REPEATED_HOVER_SCALE_MIN_COUNT = 3;

export const LONG_ALL_CAPS_HEADING_MIN_CHARACTERS = 24;

export const EXCESSIVE_FONT_FAMILY_MIN_COUNT = 4;

export const MIXED_ICON_LIBRARY_MIN_FAMILY_COUNT = 2;

export const CSS_TRANSITION_SHORTHAND_MAX_TIME_VALUE_COUNT = 2;

export const TAILWIND_TEXT_SIZE_PX = new Map([
  ["text-xs", 12],
  ["text-sm", 14],
  ["text-base", 16],
  ["text-lg", 18],
  ["text-xl", 20],
  ["text-2xl", 24],
  ["text-3xl", 30],
  ["text-4xl", 36],
  ["text-5xl", 48],
  ["text-6xl", 60],
  ["text-7xl", 72],
  ["text-8xl", 96],
  ["text-9xl", 128],
]);

export const GENERIC_MARKETING_PHRASES = new Set([
  "cutting-edge",
  "future-proof",
  "next-generation",
  "seamless experience",
  "supercharge your workflow",
  "transform your business",
  "unlock your potential",
  "world-class",
]);

export const LONG_TRANSITION_DURATION_THRESHOLD_MS = 1000;

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

export const TYPOGRAPHY_PUNCTUATION_EXCLUDED_TAG_NAMES = new Set([
  // Raw code / monospace HTML primitives — em-dashes / ellipses are
  // syntactic content there, not prose.
  "code",
  "pre",
  "kbd",
  "samp",
  "var",
  "tt",
  // Markdown / prose-rendering components — they round-trip user
  // content (or vendor docstrings / CHANGELOG snippets / sample LLM
  // output) which legitimately contains em-dashes and ellipses. These
  // are conventional component names used across the ecosystem
  // (`<Markdown>`, `<Md>`, `<MDX>`, `<MDXContent>`, `<Prose>`,
  // `<Article>`, `<RichText>`, `<Body>` for body copy, `<Description>`
  // for documentation snippets, `<MarkdownContent>`, `<MarkdownText>`,
  // `<MarkdownRenderer>`, `<MarkdownBlock>`, etc.). Lowercase form is
  // matched because `tagName.toLowerCase()` is the comparison key.
  "markdown",
  "markdownblock",
  "markdowncontent",
  "markdownrenderer",
  "markdowntext",
  "markdownview",
  "mdx",
  "mdxcontent",
  "mdxremote",
  "md",
  "prose",
  "richtext",
  "article",
  "blockquote",
  "quote",
  "trans",
  // Internationalised / translated strings — em-dashes / ellipses in
  // upstream translations are out of the engineer's control.
  "translation",
  "translated",
  "fbt",
  "fbs",
]);

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

export const TAILWIND_DISPLAY_TOKENS = new Set([
  "block",
  "inline-block",
  "inline",
  "flex",
  "inline-flex",
  "table",
  "inline-table",
  "table-caption",
  "table-cell",
  "table-column",
  "table-column-group",
  "table-footer-group",
  "table-header-group",
  "table-row-group",
  "table-row",
  "flow-root",
  "grid",
  "inline-grid",
  "contents",
  "list-item",
  "hidden",
]);

export const SPACE_AXIS_PATTERN = /(?:^|\s)(?:-)?space-(x|y)-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/;

export const TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN = /[\p{L}\p{N}]\.\.\./u;
