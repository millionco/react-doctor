import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { artifactBaasAuthoritySurface } from "./artifact-baas-authority-surface.js";

describe("security-scan/artifact-baas-authority-surface — regressions", () => {
  // FP wave 4: the bare `role` token collided with the ubiquitous ARIA
  // `role` attribute that ships in nearly every React+Firebase bundle.
  it("stays silent on an ARIA role attribute in a Firebase bundle", () => {
    const findings = runScanRule(artifactBaasAuthoritySurface, {
      relativePath: "dist/assets/index-abc123.js",
      content: `var firebaseConfig={apiKey:"AIzaSyXXXXXXXXXXXXXXXXXXX",authDomain:"x.firebaseapp.com",projectId:"x"};initializeApp(firebaseConfig);function Btn(){return createElement("button",{role:"button"},"Go")}`,
      isGeneratedBundle: true,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags a real authority field (isAdmin) plus a collection literal", () => {
    const findings = runScanRule(artifactBaasAuthoritySurface, {
      relativePath: "dist/assets/index-def456.js",
      content: `var firebaseConfig={apiKey:"AIzaSyXXXXXXXXXXXXXXXXXXX",authDomain:"x.firebaseapp.com",projectId:"x"};initializeApp(firebaseConfig);collection("users");var u={isAdmin:true};`,
      isGeneratedBundle: true,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
