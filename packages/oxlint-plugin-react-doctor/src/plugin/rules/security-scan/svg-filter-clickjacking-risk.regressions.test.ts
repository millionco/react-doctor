import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { svgFilterClickjackingRisk } from "./svg-filter-clickjacking-risk.js";

describe("security-scan/svg-filter-clickjacking-risk — regressions", () => {
  // FP wave 4: a decorative SVG filter applied to a sibling AFTER the iframe
  // never targets the iframe, so it stays exempt. Ancestor filters BEFORE the
  // iframe are the actual clickjacking primitive and still fire.
  it("stays silent when the filter styles a sibling element after the iframe", () => {
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

  it("flags a styled-components ancestor wrapper filtering the iframe (PR #993 FN-A)", () => {
    const findings = runScanRule(svgFilterClickjackingRisk, {
      relativePath: "src/pay.tsx",
      content: [
        "const WarpedOverlay = styled.div`filter: url(#warp); opacity: 0.4;`;",
        'const Pay = ({ src }) => (<WarpedOverlay><iframe src={src} title="payment" /></WarpedOverlay>);',
      ].join("\n"),
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("flags a filter in the iframe's own tag even when an arrow prop precedes style (PR #993 FN-B)", () => {
    const findings = runScanRule(svgFilterClickjackingRisk, {
      relativePath: "src/pay.tsx",
      content: `const Pay = ({ src }) => <iframe src={src} onLoad={() => setReady(true)} style={{ filter: "url(#warp)" }} title="payment" />;`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });

  it("flags a feDisplacementMap filter defined ~200 chars before a className-styled iframe (PR #993 FN-C)", () => {
    const findings = runScanRule(svgFilterClickjackingRisk, {
      relativePath: "src/pay.tsx",
      content: `const Pay = () => (<div><svg aria-hidden="true" width="0" height="0"><filter id="warp"><feDisplacementMap in="SourceGraphic" in2="turbulence" scale="30" xChannelSelector="R" yChannelSelector="G" /></filter></svg><div className="payment-frame-shell rounded-lg border border-neutral-200 shadow-sm"><iframe className="warped-frame" src="https://bank.example.com/transfer" title="payment" /></div></div>);`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
