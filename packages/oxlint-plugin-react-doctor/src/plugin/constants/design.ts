// Tightened to 1000 (was 100) — many design systems use a 100-step
// scale (`dropdown: 100`, `modal: 500`, `toast: 900`) which is a
// deliberate token system, not the `z-index: 9999` "escape hatch"
// the rule actually targets. Values above 1000 are almost always the
// "go on top of everything" escalation antipattern.
export const Z_INDEX_ABSURD_THRESHOLD = 1000;

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

export const SPACE_AXIS_PATTERN = /(?:^|\s)(?:-)?space-(x|y)-(\d+(?:\.\d+)?|\[[^\]]+\])(?=$|[\s:])/;

export const TRAILING_THREE_PERIOD_ELLIPSIS_PATTERN = /[A-Za-z]\.\.\./;
