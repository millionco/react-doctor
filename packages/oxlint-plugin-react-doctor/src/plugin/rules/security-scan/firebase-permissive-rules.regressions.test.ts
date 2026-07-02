import { describe, expect, it } from "vite-plus/test";
import { runScanRule } from "../../../test-utils/run-scan-rule.js";
import { firebasePermissiveRules } from "./firebase-permissive-rules.js";

describe("security-scan/firebase-permissive-rules — regressions", () => {
  // FP wave 4: a cautionary commented-out `allow … if true` is never
  // executed; comments must be stripped from `.rules` files before scanning.
  it("stays silent when the permissive rule is inside a comment", () => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `// counter-example, never do this: allow read, write: if true;\nmatch /users/{uid} {\n  allow read, write: if request.auth.uid == uid;\n}`,
    });
    expect(findings).toHaveLength(0);
  });

  it("still flags an uncommented permissive rule", () => {
    const findings = runScanRule(firebasePermissiveRules, {
      relativePath: "firestore.rules",
      content: `match /users/{uid} {\n  allow read, write: if true;\n}`,
    });
    expect(findings.length).toBeGreaterThan(0);
  });
});
