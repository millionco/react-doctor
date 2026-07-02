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
    pattern:
      /<iframe\b[\s\S]{0,700}\bfilter\s*:\s*["']?url\(#|filter\s*:\s*url\(#[\s\S]{0,700}<iframe\b|<fe(?:DisplacementMap|ColorMatrix|Composite|Tile|Morphology)\b[\s\S]{0,700}<iframe\b/i,
    message:
      "An iframe is rendered through an SVG/CSS filter, which can support advanced clickjacking or visual exfiltration tricks.",
  }),
});
