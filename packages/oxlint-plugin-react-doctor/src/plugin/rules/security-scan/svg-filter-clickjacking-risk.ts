import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const svgFilterClickjackingRisk = defineRule({
  id: "svg-filter-clickjacking-risk",
  title: "SVG-filtered iframe clickjacking primitive",
  severity: "warn",
  recommendation:
    "Avoid filtering cross-origin iframes. Use `frame-ancestors` on sensitive pages and keep SVG filters away from embedded privileged UI.",
  // The middle branch's window starts right after `url(#` — an extra `.*`
  // there overlapped the `[\s\S]{0,700}` window and made no-match scans
  // quadratic on long single-line files (seconds at the 2 MB cap).
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    // Three attack shapes: (1) `filter:url(#…)` inside the iframe's OWN tag
    // (`(?:=>|[^>])` keeps the window inside the tag while tolerating arrow
    // props like `onLoad={() => …}`); (2) an unquoted CSS `filter:url(#…)`
    // BEFORE the iframe — a wrapper/ancestor filter genuinely applies to the
    // child iframe; (3) an `<fe…>` distortion primitive shortly before the
    // iframe. A decorative `filter:url(#shadow)` on a sibling AFTER the
    // iframe matches none of these, so the mined sibling FP stays silent.
    pattern:
      /<iframe\b(?:=>|[^>]){0,300}\bfilter\s*:\s*["']?url\(#|filter\s*:\s*url\(#[\s\S]{0,700}<iframe\b|<fe(?:DisplacementMap|ColorMatrix|Composite|Tile|Morphology)\b[\s\S]{0,700}<iframe\b/i,
    message:
      "An iframe is rendered through an SVG/CSS filter, which can support advanced clickjacking or visual exfiltration tricks.",
  }),
});
