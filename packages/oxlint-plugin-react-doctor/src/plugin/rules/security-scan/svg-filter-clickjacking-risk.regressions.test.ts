import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { svgFilterClickjackingRisk } from "./svg-filter-clickjacking-risk.js";

describe("security-scan/svg-filter-clickjacking-risk — regressions", () => {
  // FP wave 4: a decorative SVG filter applied to a sibling <img> is not a
  // clickjacking primitive — the filter never targets the iframe. Only a
  // filter inside the iframe's own tag is suspicious.
  it("stays silent when the filter styles a sibling element, not the iframe", () => {
    const findings = runScanRule(svgFilterClickjackingRisk, {
      relativePath: "src/embed.tsx",
      content: `const A = () => (<><iframe src="https://x.com/embed/abc" title="v" /><p>A short caption describing the embedded video shown above it here.</p><svg><filter id="shadow"><feGaussianBlur stdDeviation="2" /></filter></svg><img style={{ filter: "url(#shadow)" }} src="/logo.png" alt="logo" /></>);`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a filter inside the iframe's own tag", () => {
    const findings = runScanRule(svgFilterClickjackingRisk, {
      relativePath: "src/embed.tsx",
      content: `const A = ({ x }) => <iframe src={x} style={{ filter: "url(#warp)" }} />;`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
