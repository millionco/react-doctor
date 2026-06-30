import { defineRule } from "../../utils/define-rule.js";
import { isProductionSourcePath } from "./utils/is-production-source-path.js";
import { scanByPattern } from "./utils/scan-by-pattern.js";

export const svgFilterClickjackingRisk = defineRule({
  id: "svg-filter-clickjacking-risk",
  title: "SVG-filtered iframe clickjacking primitive",
  severity: "warn",
  recommendation:
    "Avoid filtering cross-origin iframes. Use `frame-ancestors` on sensitive pages and keep SVG filters away from embedded privileged UI.",
  scan: scanByPattern({
    shouldScan: (file) => isProductionSourcePath(file.relativePath),
    // A regex can't prove an external/sibling filter targets the iframe,
    // so require the `filter:url(#…)` to live inside the iframe's OWN tag
    // (`<iframe … style={{ filter: "url(#warp)" }} />`). The `<fe…>`
    // SVG-primitive alternative keeps a small proximity window. A
    // decorative `filter:url(#shadow)` on a sibling `<img>` no longer fires.
    pattern:
      /<iframe\b[^>]{0,300}\bfilter\s*:\s*["']?url\(#|<fe(?:DisplacementMap|ColorMatrix|Composite|Tile|Morphology)\b[\s\S]{0,160}<iframe\b/i,
    message:
      "An iframe is rendered through an SVG/CSS filter, which can support advanced clickjacking or visual exfiltration tricks.",
  }),
});
