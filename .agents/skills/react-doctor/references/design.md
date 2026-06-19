# Reviewing and improving UI

Improve interfaces with measured evidence from the rendered page, not taste alone. Use this when the user wants to build, polish, or review a UI: "looks off", "make this nicer", or a pasted screenshot.

The value here is what a screenshot and the live DOM let you measure that reading code cannot: contrast ratios, line length, the spacing scale, and tap-target size. Lead with those, then apply craft.

## Review against the live page

```bash
npx react-doctor browser open http://localhost:3000
npx react-doctor browser screenshot --out review.png   # what the user actually sees
npx react-doctor browser audit                          # axe-core: contrast, names, landmarks
```

Review responsive breakpoints with `--viewport WIDTHxHEIGHT` (for example `--viewport 390x844` for a phone) on `screenshot`, `snapshot`, `audit`, or `perf`. It emulates the size for that one command via a CDP override, so it never resizes your real browser window:

```bash
npx react-doctor browser screenshot --viewport 390x844 --out mobile.png
```

Look at the screenshot, then measure specifics with `eval` (computed styles, bounding boxes, color values) to get objective numbers rather than opinions:

```bash
npx react-doctor browser eval 'page.evaluate(() => getComputedStyle(document.querySelector("button")).fontSize)'
```

`browser audit` runs axe-core against the live page and reports accessibility violations (color contrast, missing button or SVG names, heading order, landmarks) with the failing selectors. If [Chrome DevTools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp) (`chrome-devtools`) is in your tools, its `lighthouse_audit` adds performance and best-practice findings on top. Lead with the measured issues; a smarter model cannot dismiss them as opinion.

## What to check

Measured, in priority order:

1. **Contrast**: body text at least 4.5:1, large text at least 3:1. Report the actual ratio.
2. **Tap targets**: interactive elements at least 24 × 24 px (ideally 44 × 44 on touch).
3. **Line length**: body copy roughly 45 to 75 characters per line.
4. **Spacing**: spacing values come from one consistent scale, not ad-hoc px.

Then craft, drawing on the bundled design rules:

5. **Type**: one clear hierarchy; avoid default system-only stacks for brand surfaces; consistent line-height.
6. **Color**: a committed palette, not arbitrary hexes; check both light and dark.
7. **Layout**: alignment, rhythm, and a deliberate focal point.
8. **State**: hover, focus-visible, disabled, loading, and empty states exist.

## The loop

Build or fix, screenshot, re-audit, compare. Confirm the measured issue you targeted actually moved (the ratio crossed the threshold, the target grew) and that the screenshot looks right before and after.

## Working rules

- Always look at the screenshot; do not review UI from JSX alone.
- Report measured findings with their numbers; keep taste suggestions short and clearly separate from the measured ones.
